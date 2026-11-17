// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.fixture;

import ai.skaile.skailify.jpa.SkailifyReadFilter;
import jakarta.persistence.EntityManagerFactory;
import jakarta.servlet.Filter;
import java.time.LocalDate;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

/** A small app for the tests: authors and books on H2, with a per-request tenant. */
@SpringBootApplication
public class FixtureApp {

    /** The tenant of the current request, set by {@link #tenantFilter()}. */
    public static final ThreadLocal<String> TENANT = new ThreadLocal<>();

    @Bean
    Filter tenantFilter() {
        return (request, response, chain) -> {
            String tenant = ((jakarta.servlet.http.HttpServletRequest) request).getHeader("X-Tenant");
            TENANT.set(tenant);
            try {
                chain.doFilter(request, response);
            } finally {
                TENANT.remove();
            }
        };
    }

    /** Books only of the request's tenant, when it names one. */
    @Bean
    SkailifyReadFilter tenantReadFilter() {
        return (entityClass, root, cb) -> {
            String tenant = TENANT.get();
            if (entityClass != Book.class || tenant == null) return null;
            return cb.equal(root.get("tenant"), tenant);
        };
    }

    @Bean
    ApplicationRunner seed(EntityManagerFactory emf) {
        return args -> {
            var em = emf.createEntityManager();
            em.getTransaction().begin();
            Author ann = new Author(1L, "Ann Example", "ann@example.org");
            Author bo = new Author(2L, "Bo 100% Real_Name", "bo@example.org");
            Shelf shelf = new Shelf(1L, "A1");
            em.persist(ann);
            em.persist(bo);
            em.persist(shelf);
            Publisher house = new Publisher("REG-0001", "House");
            em.persist(house);
            em.persist(new Book(1L, "The First Novel", Book.Genre.NOVEL, "12.50", LocalDate.of(2020, 1, 15), "t1", ann, shelf).publishedBy(house));
            em.persist(new Book(2L, "Second Thoughts", Book.Genre.ESSAY, "8.00", LocalDate.of(2021, 6, 1), "t1", ann, null));
            em.persist(new Book(3L, "Poems", Book.Genre.POETRY, "15.00", LocalDate.of(2022, 3, 10), "t2", bo, null));
            em.persist(new Book(4L, "Untitled", Book.Genre.NOVEL, null, null, "t2", null, null));
            em.getTransaction().commit();
            em.close();
        };
    }
}
