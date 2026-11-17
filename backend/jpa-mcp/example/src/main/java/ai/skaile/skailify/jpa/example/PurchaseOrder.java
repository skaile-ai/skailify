// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.example;

import ai.skaile.skailify.jpa.SkaileAction;
import ai.skaile.skailify.jpa.SkaileAction.MinTier;
import ai.skaile.skailify.jpa.SkaileAction.Risk;
import ai.skaile.skailify.jpa.SkailifyEntity;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.LocalDate;

/** Served as {@code order}: {@code list_order}, {@code get_order}, {@code query_order}. */
@Entity
@Table(name = "purchase_order")
@SkailifyEntity(name = "order", description = "A customer's order: its status, total in euros and the day it was placed.")
@SkaileAction(risk = Risk.MEDIUM, minTier = MinTier.USER)
public class PurchaseOrder {

    public enum Status {
        OPEN,
        SHIPPED,
        CANCELLED
    }

    @Id
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    private Customer customer;

    @Enumerated(EnumType.STRING)
    private Status status;

    private BigDecimal totalEur;

    private LocalDate placedOn;

    protected PurchaseOrder() {}
}
