// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.fixture;

import ai.skaile.skailify.jpa.SkailifyEntity;
import ai.skaile.skailify.jpa.SkailifyHidden;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;

/** Exposed with a hidden id: no get tool, and references to it are not served. */
@Entity
@SkailifyEntity
public class Publisher {
    @Id
    @SkailifyHidden
    String registrationNumber;

    String name;

    protected Publisher() {}

    public Publisher(String registrationNumber, String name) {
        this.registrationNumber = registrationNumber;
        this.name = name;
    }
}
