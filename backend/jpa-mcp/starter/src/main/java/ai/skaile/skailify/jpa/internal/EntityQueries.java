// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.internal;

import ai.skaile.skailify.jpa.SkailifyReadFilter;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityManagerFactory;
import jakarta.persistence.Tuple;
import jakarta.persistence.TypedQuery;
import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.Expression;
import jakarta.persistence.criteria.Join;
import jakarta.persistence.criteria.JoinType;
import jakarta.persistence.criteria.Path;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import jakarta.persistence.criteria.Selection;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Runs the read tools. Every call builds a criteria query that selects the served attributes
 * only, in its own entity manager: nothing is loaded as a managed entity, nothing is written,
 * and the app's own persistence context is never touched.
 */
public final class EntityQueries {

    /** The filter operators, and which kinds of attribute take them. */
    public static final List<String> EQUALITY_OPS = List.of("eq", "ne", "in", "isNull");
    public static final List<String> ORDER_OPS = List.of("lt", "lte", "gt", "gte");
    public static final List<String> TEXT_OPS = List.of("contains", "startsWith");
    public static final int MAX_IN_VALUES = 100;

    private static final Set<String> PAGE_ARGS = Set.of("limit", "offset", "orderBy", "direction");

    private final EntityManagerFactory emf;
    private final List<SkailifyReadFilter> filters;
    private final int defaultLimit;
    private final int maxLimit;
    private final int queryTimeoutMs;

    public EntityQueries(
            EntityManagerFactory emf,
            List<SkailifyReadFilter> filters,
            int defaultLimit,
            int maxLimit,
            int queryTimeoutMs) {
        if (defaultLimit < 1 || maxLimit < defaultLimit) {
            throw new IllegalArgumentException("need 1 <= default-limit <= max-limit, got " + defaultLimit + " and "
                    + maxLimit);
        }
        this.emf = emf;
        this.filters = List.copyOf(filters);
        this.defaultLimit = defaultLimit;
        this.maxLimit = maxLimit;
        this.queryTimeoutMs = queryTimeoutMs;
    }

    public int defaultLimit() {
        return defaultLimit;
    }

    public int maxLimit() {
        return maxLimit;
    }

    /** {@code list_<name>}: a page of records. */
    public Map<String, Object> list(ExposedEntity entity, Map<String, Object> args) {
        rejectUnknown(args, PAGE_ARGS);
        return page(entity, args, Map.of());
    }

    /** {@code query_<name>}: a page of the records matching {@code where}. */
    public Map<String, Object> query(ExposedEntity entity, Map<String, Object> args) {
        Set<String> allowed = new java.util.HashSet<>(PAGE_ARGS);
        allowed.add("where");
        rejectUnknown(args, allowed);
        Object where = args.get("where");
        if (where != null && !(where instanceof Map<?, ?>)) {
            throw new ToolInputException("where: expected an object of attribute filters");
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> conditions = where == null ? Map.of() : (Map<String, Object>) where;
        return page(entity, args, conditions);
    }

    /** {@code get_<name>}: one record by id, or {@code null} when there is none the caller may read. */
    public Map<String, Object> get(ExposedEntity entity, Map<String, Object> args) {
        rejectUnknown(args, Set.of("id"));
        if (!args.containsKey("id")) throw new ToolInputException("id is required");
        ExposedAttribute id = entity.id();
        Object value = ValueCodec.fromJson(args.get("id"), id.valueType(), "id");
        try (EntityManager em = emf.createEntityManager()) {
            Built built = build(em, entity);
            List<Predicate> predicates = new ArrayList<>(built.restrictions);
            predicates.add(built.cb.equal(built.paths.get(id.name()), value));
            built.query.where(predicates.toArray(Predicate[]::new));
            List<Tuple> rows = run(em, built.query, 0, 2);
            return rows.isEmpty() ? null : row(entity, rows.get(0));
        }
    }

    private Map<String, Object> page(ExposedEntity entity, Map<String, Object> args, Map<String, Object> where) {
        int limit = intArg(args, "limit", defaultLimit, 1, maxLimit);
        int offset = intArg(args, "offset", 0, 0, Integer.MAX_VALUE - maxLimit - 1);
        ExposedAttribute orderBy = orderBy(entity, args.get("orderBy"));
        boolean descending = direction(args.get("direction"));

        try (EntityManager em = emf.createEntityManager()) {
            Built built = build(em, entity);
            List<Predicate> predicates = new ArrayList<>(built.restrictions);
            for (Map.Entry<String, Object> condition : where.entrySet()) {
                ExposedAttribute attribute = entity.attribute(condition.getKey())
                        .orElseThrow(() -> new ToolInputException("where." + condition.getKey()
                                + ": no such attribute; describe_model lists them"));
                predicates.addAll(conditions(built.cb, built.paths.get(attribute.name()), attribute, condition.getValue()));
            }
            built.query.where(predicates.toArray(Predicate[]::new));
            List<jakarta.persistence.criteria.Order> order = new ArrayList<>();
            if (orderBy != null) {
                Path<?> path = built.paths.get(orderBy.name());
                order.add(descending ? built.cb.desc(path) : built.cb.asc(path));
            }
            // The id breaks ties, so paging with offset neither skips nor repeats records.
            ExposedAttribute id = entity.id();
            if (id != null && (orderBy == null || !orderBy.id())) order.add(built.cb.asc(built.paths.get(id.name())));
            if (!order.isEmpty()) built.query.orderBy(order);
            List<Tuple> rows = run(em, built.query, offset, limit + 1);
            List<Map<String, Object>> items = new ArrayList<>();
            for (int i = 0; i < Math.min(limit, rows.size()); i++) items.add(row(entity, rows.get(i)));
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("entity", entity.name());
            result.put("items", items);
            result.put("offset", offset);
            result.put("limit", limit);
            result.put("hasMore", rows.size() > limit);
            return result;
        }
    }

    private record Built(CriteriaBuilder cb, CriteriaQuery<Tuple> query, Map<String, Path<?>> paths, List<Predicate> restrictions) {}

    private Built build(EntityManager em, ExposedEntity entity) {
        CriteriaBuilder cb = em.getCriteriaBuilder();
        CriteriaQuery<Tuple> query = cb.createTupleQuery();
        Root<?> root = query.from(entity.entityClass());
        Map<String, Path<?>> paths = new HashMap<>();
        List<Selection<?>> selections = new ArrayList<>();
        for (ExposedAttribute attribute : entity.attributes()) {
            Path<?> path;
            if (attribute.reference()) {
                // A left join, so a record whose reference is empty is still found.
                Join<?, ?> join = root.join(attribute.name(), JoinType.LEFT);
                path = join.get(attribute.referenceIdName());
            } else {
                path = root.get(attribute.name());
            }
            paths.put(attribute.name(), path);
            selections.add(path);
        }
        query.multiselect(selections);
        List<Predicate> restrictions = new ArrayList<>();
        for (SkailifyReadFilter filter : filters) {
            Predicate predicate = filter.restrict(entity.entityClass(), root, cb);
            if (predicate != null) restrictions.add(predicate);
        }
        return new Built(cb, query, paths, restrictions);
    }

    private List<Tuple> run(EntityManager em, CriteriaQuery<Tuple> query, int offset, int max) {
        TypedQuery<Tuple> typed = em.createQuery(query);
        typed.setFirstResult(offset);
        typed.setMaxResults(max);
        if (queryTimeoutMs > 0) typed.setHint("jakarta.persistence.query.timeout", queryTimeoutMs);
        return typed.getResultList();
    }

    private static Map<String, Object> row(ExposedEntity entity, Tuple tuple) {
        Map<String, Object> row = new LinkedHashMap<>();
        List<ExposedAttribute> attributes = entity.attributes();
        for (int i = 0; i < attributes.size(); i++) {
            ExposedAttribute attribute = attributes.get(i);
            Object value = ValueCodec.toJson(tuple.get(i));
            if (attribute.reference() && value != null) {
                Map<String, Object> ref = new LinkedHashMap<>();
                ref.put("entity", attribute.referenceTo());
                ref.put("id", value);
                value = ref;
            }
            row.put(attribute.name(), value);
        }
        return row;
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static List<Predicate> conditions(
            CriteriaBuilder cb, Path<?> path, ExposedAttribute attribute, Object spec) {
        String what = "where." + attribute.name();
        if (!(spec instanceof Map<?, ?> ops)) {
            return List.of(cb.equal(path, ValueCodec.fromJson(spec, attribute.valueType(), what)));
        }
        if (ops.isEmpty()) throw new ToolInputException(what + ": give at least one operator");
        List<Predicate> predicates = new ArrayList<>();
        for (Map.Entry<?, ?> entry : ops.entrySet()) {
            String op = String.valueOf(entry.getKey());
            Object operand = entry.getValue();
            String opWhat = what + "." + op;
            if (ORDER_OPS.contains(op) && !attribute.sortable()) {
                throw new ToolInputException(opWhat + ": " + attribute.name() + " is not ordered");
            }
            if (TEXT_OPS.contains(op) && (attribute.reference() || !attribute.kind().text())) {
                throw new ToolInputException(opWhat + ": " + attribute.name() + " is not text");
            }
            Expression comparable = path;
            switch (op) {
                case "eq" -> predicates.add(cb.equal(path, ValueCodec.fromJson(operand, attribute.valueType(), opWhat)));
                case "ne" -> predicates.add(cb.notEqual(path, ValueCodec.fromJson(operand, attribute.valueType(), opWhat)));
                case "in" -> {
                    if (!(operand instanceof List<?> values) || values.isEmpty() || values.size() > MAX_IN_VALUES) {
                        throw new ToolInputException(opWhat + ": expected a list of 1 to " + MAX_IN_VALUES + " values");
                    }
                    CriteriaBuilder.In<Object> in = cb.in((Expression<Object>) path);
                    for (Object v : values) in.value(ValueCodec.fromJson(v, attribute.valueType(), opWhat));
                    predicates.add(in);
                }
                case "isNull" -> {
                    if (!(operand instanceof Boolean b)) throw new ToolInputException(opWhat + ": expected true or false");
                    predicates.add(b ? cb.isNull(path) : cb.isNotNull(path));
                }
                case "lt" -> predicates.add(cb.lessThan(comparable, (Comparable) ValueCodec.fromJson(operand, attribute.valueType(), opWhat)));
                case "lte" -> predicates.add(cb.lessThanOrEqualTo(comparable, (Comparable) ValueCodec.fromJson(operand, attribute.valueType(), opWhat)));
                case "gt" -> predicates.add(cb.greaterThan(comparable, (Comparable) ValueCodec.fromJson(operand, attribute.valueType(), opWhat)));
                case "gte" -> predicates.add(cb.greaterThanOrEqualTo(comparable, (Comparable) ValueCodec.fromJson(operand, attribute.valueType(), opWhat)));
                case "contains", "startsWith" -> {
                    if (!(operand instanceof String text)) throw new ToolInputException(opWhat + ": expected a string");
                    String pattern = escapeLike(text.toLowerCase(Locale.ROOT));
                    pattern = op.equals("contains") ? "%" + pattern + "%" : pattern + "%";
                    predicates.add(cb.like(cb.lower((Expression<String>) path), pattern, '\\'));
                }
                default -> throw new ToolInputException(opWhat + ": unknown operator; use one of "
                        + String.join(", ", operators(attribute)));
            }
        }
        return predicates;
    }

    /** The operators an attribute takes. */
    public static List<String> operators(ExposedAttribute attribute) {
        List<String> ops = new ArrayList<>(EQUALITY_OPS);
        if (attribute.sortable()) ops.addAll(ORDER_OPS);
        if (!attribute.reference() && attribute.kind().text()) ops.addAll(TEXT_OPS);
        return ops;
    }

    private static String escapeLike(String text) {
        return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    private static ExposedAttribute orderBy(ExposedEntity entity, Object value) {
        if (value == null) return null;
        if (!(value instanceof String name)) throw new ToolInputException("orderBy: expected an attribute name");
        return entity.sortable().stream()
                .filter(a -> a.name().equals(name))
                .findFirst()
                .orElseThrow(() -> new ToolInputException("orderBy: \"" + name + "\" is not a sortable attribute; use one of "
                        + entity.sortable().stream().map(ExposedAttribute::name).toList()));
    }

    private static boolean direction(Object value) {
        if (value == null || "asc".equals(value)) return false;
        if ("desc".equals(value)) return true;
        throw new ToolInputException("direction: expected \"asc\" or \"desc\"");
    }

    private static int intArg(Map<String, Object> args, String name, int fallback, int min, int max) {
        Object value = args.get(name);
        if (value == null) return fallback;
        if (!(value instanceof Number n) || n.doubleValue() != Math.floor(n.doubleValue())) {
            throw new ToolInputException(name + ": expected a whole number");
        }
        long l = n.longValue();
        if (l < min || l > max) throw new ToolInputException(name + ": must be between " + min + " and " + max);
        return (int) l;
    }

    private static void rejectUnknown(Map<String, Object> args, Set<String> allowed) {
        for (String key : args.keySet()) {
            if (!allowed.contains(key)) {
                throw new ToolInputException("unknown argument \"" + key + "\"; this tool takes " + allowed);
            }
        }
    }
}
