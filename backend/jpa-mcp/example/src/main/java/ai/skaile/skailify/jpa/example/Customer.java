// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.example;

import ai.skaile.skailify.jpa.SkailifyEntity;
import ai.skaile.skailify.jpa.SkailifyHidden;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import java.time.Instant;

/** No {@code @SkaileAction}: its tools get the default, a low-risk read only the session's owner sees. */
@Entity
@SkailifyEntity(description = "A customer of the shop: name, contact and city.")
public class Customer {

    @Id
    private Long id;

    private String name;

    private String email;

    private String city;

    private Instant createdAt;

    /** Staff notes; never shown to an agent. */
    @SkailifyHidden
    private String internalNote;

    protected Customer() {}

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }
}
