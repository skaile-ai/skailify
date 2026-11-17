// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.internal;

import ai.skaile.skailify.jpa.SkaileAction;
import ai.skaile.skailify.jpa.SkaileAction.Disclosure;
import ai.skaile.skailify.jpa.SkaileAction.Effect;
import ai.skaile.skailify.jpa.SkaileAction.MinTier;
import ai.skaile.skailify.jpa.SkaileAction.Risk;
import java.util.LinkedHashMap;
import java.util.Map;

/** The {@code _meta["ai.skaile/action"]} value of one tool. */
public record ActionMeta(Effect effect, Risk risk, boolean idempotent, MinTier minTier, Disclosure disclosure) {

    /** The {@code _meta} key the metadata lives under. */
    public static final String META_KEY = "ai.skaile/action";

    /** What an entity's tools get when it has no {@link SkaileAction}. */
    public static final ActionMeta READ_DEFAULT =
            new ActionMeta(Effect.ROUTINE, Risk.LOW, true, MinTier.UNSET, Disclosure.OWNER_PRIVATE);

    /** {@code describe_model}: the model's structure only, which any reader of the session may see. */
    public static final ActionMeta DESCRIBE =
            new ActionMeta(Effect.ROUTINE, Risk.LOW, true, MinTier.UNSET, Disclosure.SESSION_VISIBLE);

    /**
     * The metadata for an entity's read tools.
     *
     * @throws IllegalStateException when the annotation contradicts a read tool
     */
    public static ActionMeta forReads(SkaileAction action, String where) {
        if (action == null) {
            return READ_DEFAULT;
        }
        if (action.effect() != Effect.ROUTINE) {
            throw new IllegalStateException(where + ": @SkaileAction(effect = " + action.effect()
                    + ") on a read-only entity; a read is always ROUTINE (only read tools are served)");
        }
        if (!action.idempotent()) {
            throw new IllegalStateException(where
                    + ": @SkaileAction(idempotent = false) on a read-only entity; a read is always idempotent");
        }
        return new ActionMeta(action.effect(), action.risk(), true, action.minTier(), action.disclosure());
    }

    /** The {@code _meta} map of a tool: one key, {@value #META_KEY}. */
    public Map<String, Object> toToolMeta() {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("effect", effect.wire());
        value.put("risk", risk.wire());
        value.put("idempotent", idempotent);
        if (minTier.wire() != null) {
            value.put("minTier", minTier.wire());
        }
        value.put("disclosure", disclosure.wire());
        return Map.of(META_KEY, value);
    }
}
