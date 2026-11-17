// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.example;

import ai.skaile.skailify.jpa.SkaileAction;
import ai.skaile.skailify.jpa.SkaileAction.Disclosure;
import ai.skaile.skailify.jpa.SkailifyEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import java.math.BigDecimal;

/** The public catalogue: anyone in the session may see it. */
@Entity
@SkailifyEntity(description = "A product in the shop's catalogue, with its price in euros.")
@SkaileAction(disclosure = Disclosure.SESSION_VISIBLE)
public class Product {

    @Id
    private Long id;

    @Column(unique = true)
    private String sku;

    private String name;

    private BigDecimal priceEur;

    private boolean active;

    protected Product() {}
}
