// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.internal;

import ai.skaile.skailify.jpa.SkaileAction;
import ai.skaile.skailify.jpa.SkailifyEntity;
import ai.skaile.skailify.jpa.SkailifyHidden;
import ai.skaile.skailify.jpa.internal.ValueCodec.Kind;
import jakarta.persistence.metamodel.Attribute;
import jakarta.persistence.metamodel.Attribute.PersistentAttributeType;
import jakarta.persistence.metamodel.EntityType;
import jakarta.persistence.metamodel.Metamodel;
import jakarta.persistence.metamodel.SingularAttribute;
import java.lang.reflect.AnnotatedElement;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Reads the exposed entities out of the JPA metamodel. */
public final class EntityCatalog {

    private static final Logger log = LoggerFactory.getLogger(EntityCatalog.class);
    private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9_]{0,39}");

    private final List<ExposedEntity> entities;

    private EntityCatalog(List<ExposedEntity> entities) {
        this.entities = List.copyOf(entities);
    }

    public List<ExposedEntity> entities() {
        return entities;
    }

    /**
     * Collects every entity annotated with {@link SkailifyEntity}.
     *
     * @throws IllegalStateException when an annotation is invalid or two entities share a name
     */
    public static EntityCatalog from(Metamodel metamodel) {
        Map<Class<?>, String> names = new LinkedHashMap<>();
        Map<String, Class<?>> byName = new LinkedHashMap<>();
        List<EntityType<?>> chosen = new ArrayList<>();
        List<EntityType<?>> all = new ArrayList<>(metamodel.getEntities());
        all.sort(Comparator.comparing(EntityType::getName));
        for (EntityType<?> type : all) {
            Class<?> javaType = type.getJavaType();
            SkailifyEntity marker = javaType == null ? null : javaType.getAnnotation(SkailifyEntity.class);
            if (marker == null) continue;
            String name = marker.name().isEmpty() ? ValueCodec.snakeCase(type.getName()) : marker.name();
            if (!NAME.matcher(name).matches()) {
                throw new IllegalStateException(javaType.getName() + ": @SkailifyEntity name \"" + name
                        + "\" must match [a-z][a-z0-9_]* and have at most 40 characters");
            }
            Class<?> clash = byName.putIfAbsent(name, javaType);
            if (clash != null) {
                throw new IllegalStateException("@SkailifyEntity name \"" + name + "\" is used by both "
                        + clash.getName() + " and " + javaType.getName() + "; set name() on one of them");
            }
            names.put(javaType, name);
            chosen.add(type);
        }

        List<ExposedEntity> result = new ArrayList<>();
        for (EntityType<?> type : chosen) {
            result.add(expose(type, names));
        }
        return new EntityCatalog(result);
    }

    private static ExposedEntity expose(EntityType<?> type, Map<Class<?>, String> names) {
        Class<?> javaType = type.getJavaType();
        String name = names.get(javaType);
        SkailifyEntity marker = javaType.getAnnotation(SkailifyEntity.class);
        ActionMeta action = ActionMeta.forReads(javaType.getAnnotation(SkaileAction.class), javaType.getName());
        String description = marker.description().isEmpty()
                ? "A " + type.getName() + " record of the app."
                : marker.description();

        ExposedAttribute id = null;
        List<ExposedAttribute> attributes = new ArrayList<>();
        List<String> skipped = new ArrayList<>();
        List<Attribute<?, ?>> declared = new ArrayList<>(type.getAttributes());
        declared.sort(Comparator.comparing(Attribute::getName));
        for (Attribute<?, ?> attribute : declared) {
            if (hidden(javaType, attribute)) continue;
            if (!(attribute instanceof SingularAttribute<?, ?> singular)) {
                skipped.add(attribute.getName() + " (collection)");
                continue;
            }
            PersistentAttributeType persistentType = singular.getPersistentAttributeType();
            ExposedAttribute exposed = null;
            if (persistentType == PersistentAttributeType.BASIC) {
                Kind kind = ValueCodec.kindOf(singular.getJavaType());
                if (kind != null) {
                    exposed = new ExposedAttribute(
                            singular.getName(), singular.getJavaType(), kind, singular.isId(), null, null);
                } else {
                    skipped.add(singular.getName() + " (type " + singular.getJavaType().getSimpleName() + ")");
                }
            } else if (persistentType == PersistentAttributeType.MANY_TO_ONE
                    || persistentType == PersistentAttributeType.ONE_TO_ONE) {
                exposed = reference(singular, names, skipped);
            } else {
                skipped.add(singular.getName() + " (" + persistentType.name().toLowerCase() + ")");
            }
            if (exposed == null) continue;
            if (exposed.id()) {
                id = exposed;
            } else {
                attributes.add(exposed);
            }
        }
        boolean singleId = type.hasSingleIdAttribute() && id != null;
        if (id != null) attributes.add(0, id);
        if (!singleId) {
            log.warn("{}: no single served id attribute, so it gets no {} tool", javaType.getName(), "get_" + name);
        }
        if (!skipped.isEmpty()) {
            log.info("{}: not served: {}", javaType.getName(), String.join(", ", skipped));
        }
        return new ExposedEntity(name, description, javaType, action, attributes, singleId ? id : null);
    }

    private static ExposedAttribute reference(
            SingularAttribute<?, ?> attribute, Map<Class<?>, String> names, List<String> skipped) {
        if (!(attribute.getType() instanceof EntityType<?> target)) {
            skipped.add(attribute.getName() + " (reference)");
            return null;
        }
        String targetName = names.get(target.getJavaType());
        if (targetName == null) {
            skipped.add(attribute.getName() + " (references " + target.getName() + ", which is not exposed)");
            return null;
        }
        if (!target.hasSingleIdAttribute()) {
            skipped.add(attribute.getName() + " (references " + target.getName() + ", which has a composite id)");
            return null;
        }
        SingularAttribute<?, ?> targetId = target.getId(target.getIdType().getJavaType());
        Kind kind = ValueCodec.kindOf(targetId.getJavaType());
        if (kind == null) {
            skipped.add(attribute.getName() + " (references an id of an unsupported type)");
            return null;
        }
        return new ExposedAttribute(
                attribute.getName(), targetId.getJavaType(), kind, attribute.isId(), targetName, targetId.getName());
    }

    /** Hidden on the member JPA uses, or on the field or getter of the same name. */
    private static boolean hidden(Class<?> entityClass, Attribute<?, ?> attribute) {
        if (attribute.getJavaMember() instanceof AnnotatedElement member
                && member.isAnnotationPresent(SkailifyHidden.class)) {
            return true;
        }
        String name = attribute.getName();
        String capitalized = Character.toUpperCase(name.charAt(0)) + name.substring(1);
        for (Class<?> c = entityClass; c != null && c != Object.class; c = c.getSuperclass()) {
            for (Field field : c.getDeclaredFields()) {
                if (field.getName().equals(name) && field.isAnnotationPresent(SkailifyHidden.class)) return true;
            }
            for (Method method : c.getDeclaredMethods()) {
                String m = method.getName();
                if (method.getParameterCount() == 0
                        && (m.equals("get" + capitalized) || m.equals("is" + capitalized))
                        && method.isAnnotationPresent(SkailifyHidden.class)) {
                    return true;
                }
            }
        }
        return false;
    }
}
