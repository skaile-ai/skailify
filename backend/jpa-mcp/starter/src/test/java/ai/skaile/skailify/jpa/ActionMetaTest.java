// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ai.skaile.skailify.jpa.SkaileAction.Effect;
import ai.skaile.skailify.jpa.SkaileAction.Risk;
import ai.skaile.skailify.jpa.internal.ActionMeta;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ActionMetaTest {

    @SkaileAction(effect = Effect.EXTERNAL)
    static class External {}

    @SkaileAction(idempotent = false)
    static class NotIdempotent {}

    @SkaileAction(risk = Risk.HIGH)
    static class HighRisk {}

    private static SkaileAction of(Class<?> type) {
        return type.getAnnotation(SkaileAction.class);
    }

    @Test
    void defaultsToALowRiskOwnerPrivateRead() {
        assertThat(ActionMeta.forReads(null, "x").toToolMeta())
                .isEqualTo(Map.of("ai.skaile/action", Map.of(
                        "effect", "routine", "risk", "low", "idempotent", true, "disclosure", "owner-private")));
    }

    @Test
    void takesTheAnnotationsValues() {
        assertThat(ActionMeta.forReads(of(HighRisk.class), "x").risk()).isEqualTo(Risk.HIGH);
    }

    @Test
    void refusesMetadataThatContradictsARead() {
        assertThatThrownBy(() -> ActionMeta.forReads(of(External.class), "Shop"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Shop")
                .hasMessageContaining("EXTERNAL");
        assertThatThrownBy(() -> ActionMeta.forReads(of(NotIdempotent.class), "Shop"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("idempotent");
    }
}
