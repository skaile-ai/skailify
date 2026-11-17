// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Exposes a JPA entity to agents as read-only MCP tools: {@code list_<name>},
 * {@code get_<name>} and {@code query_<name>}, plus its entry in {@code describe_model}.
 * Entities without it are not served, and neither are references to them.
 *
 * <p>Add {@link SkaileAction} next to it to set the tools' action metadata, and
 * {@link SkailifyHidden} on attributes the agent must not see.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface SkailifyEntity {

    /**
     * The name in the tool names, lower snake case ({@code [a-z][a-z0-9_]*}, at most 40
     * characters). Default: the JPA entity name in snake case ({@code OrderLine} becomes
     * {@code order_line}).
     */
    String name() default "";

    /** What one record is, for the agent. Default: a sentence naming the entity. */
    String description() default "";
}
