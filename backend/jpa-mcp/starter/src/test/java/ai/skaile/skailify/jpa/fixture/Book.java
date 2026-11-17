// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.fixture;

import ai.skaile.skailify.jpa.SkaileAction;
import ai.skaile.skailify.jpa.SkaileAction.MinTier;
import ai.skaile.skailify.jpa.SkaileAction.Risk;
import ai.skaile.skailify.jpa.SkailifyEntity;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

@Entity
@SkailifyEntity(name = "book")
@SkaileAction(risk = Risk.MEDIUM, minTier = MinTier.USER)
public class Book {
    public enum Genre {
        NOVEL,
        ESSAY,
        POETRY
    }

    @Id
    Long id;

    String title;

    @Enumerated(EnumType.STRING)
    Genre genre;

    BigDecimal price;

    LocalDate published;

    String tenant;

    byte[] cover;

    @ManyToOne
    Author author;

    @ManyToOne
    Shelf shelf;

    @OneToMany
    List<Book> related;

    protected Book() {}

    public Book(Long id, String title, Genre genre, String price, LocalDate published, String tenant, Author author, Shelf shelf) {
        this.id = id;
        this.title = title;
        this.genre = genre;
        this.price = price == null ? null : new BigDecimal(price);
        this.published = published;
        this.tenant = tenant;
        this.author = author;
        this.shelf = shelf;
    }
}
