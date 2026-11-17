// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa;

import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;

/**
 * Restricts which rows the tools read, for example to the caller's tenant. Every bean of this
 * type is applied, joined with AND, to every {@code list}, {@code get} and {@code query} call.
 *
 * <p>Tool calls run on the request's thread, so a filter can read the caller from the app's
 * security context. Authorization against the app's data stays the app's job: the action
 * metadata does not grant or deny anything.
 */
@FunctionalInterface
public interface SkailifyReadFilter {

    /**
     * @param entityClass the exposed entity being read
     * @param root the query root for that entity
     * @param cb the criteria builder of the query
     * @return a predicate rows must satisfy, or {@code null} for no restriction on this entity
     */
    Predicate restrict(Class<?> entityClass, Root<?> root, CriteriaBuilder cb);
}
