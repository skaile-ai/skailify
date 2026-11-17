// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.fixture;

import ai.skaile.skailify.jpa.SkaileAction;
import ai.skaile.skailify.jpa.SkaileAction.Disclosure;
import ai.skaile.skailify.jpa.SkailifyEntity;
import ai.skaile.skailify.jpa.SkailifyHidden;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;

@Entity
@SkailifyEntity(description = "A person who wrote books.")
@SkaileAction(disclosure = Disclosure.SESSION_VISIBLE)
public class Author {
    @Id
    Long id;

    String name;

    @SkailifyHidden
    String email;

    protected Author() {}

    public Author(Long id, String name, String email) {
        this.id = id;
        this.name = name;
        this.email = email;
    }
}
