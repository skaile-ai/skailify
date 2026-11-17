// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.internal;

import java.util.List;
import java.util.Optional;

/**
 * An entity served as tools.
 *
 * @param name the name in its tool names
 * @param description what one record is
 * @param entityClass the JPA entity class
 * @param action the action metadata of its tools
 * @param attributes what an agent sees, the id first
 * @param id its single id attribute, or {@code null} when it has a composite id (no get tool then)
 */
public record ExposedEntity(
        String name,
        String description,
        Class<?> entityClass,
        ActionMeta action,
        List<ExposedAttribute> attributes,
        ExposedAttribute id) {

    public Optional<ExposedAttribute> attribute(String attributeName) {
        return attributes.stream().filter(a -> a.name().equals(attributeName)).findFirst();
    }

    public List<ExposedAttribute> sortable() {
        return attributes.stream().filter(ExposedAttribute::sortable).toList();
    }

    public String listTool() {
        return "list_" + name;
    }

    public String getTool() {
        return "get_" + name;
    }

    public String queryTool() {
        return "query_" + name;
    }
}
