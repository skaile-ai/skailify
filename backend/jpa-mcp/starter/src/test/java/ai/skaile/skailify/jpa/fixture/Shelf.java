// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.fixture;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;

/** Not exposed: neither it nor references to it are served. */
@Entity
public class Shelf {
    @Id
    Long id;

    String location;

    protected Shelf() {}

    public Shelf(Long id, String location) {
        this.id = id;
        this.location = location;
    }
}
