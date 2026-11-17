// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Keeps an attribute of an exposed entity away from agents: it is left out of results, of
 * {@code describe_model}, and of the attributes a query can filter or sort on. Put it on the
 * field, or on the getter when the entity uses property access.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.FIELD, ElementType.METHOD})
public @interface SkailifyHidden {}
