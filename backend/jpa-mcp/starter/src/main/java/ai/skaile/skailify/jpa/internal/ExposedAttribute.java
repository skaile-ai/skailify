// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.internal;

import ai.skaile.skailify.jpa.internal.ValueCodec.Kind;

/**
 * One attribute an agent sees: a basic value, or a to-one reference to another exposed entity,
 * served as that entity's id.
 *
 * @param name the JPA attribute name
 * @param valueType the Java type of the value (for a reference, of the target's id)
 * @param kind how the value appears in JSON
 * @param id whether this is the entity's id
 * @param referenceTo the exposed name of the referenced entity, or {@code null} for a basic value
 * @param referenceIdName the JPA id attribute of the referenced entity, or {@code null}
 */
public record ExposedAttribute(
        String name, Class<?> valueType, Kind kind, boolean id, String referenceTo, String referenceIdName) {

    public boolean reference() {
        return referenceTo != null;
    }

    /** Whether results can be sorted on it. */
    public boolean sortable() {
        return !reference() && kind.ordered();
    }
}
