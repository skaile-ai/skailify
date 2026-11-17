// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Skaile action metadata for the tools an exposed entity gets. It is served on each tool at
 * {@code _meta["ai.skaile/action"]}, the field names and values match the platform's own agent
 * actions, and {@code skailify-check-mcp} checks it.
 *
 * <p>Put it on a class that carries {@link SkailifyEntity}. Without it the entity's tools get the
 * defaults below, which suit an ordinary read whose results only the session's owner should see.
 *
 * <p>This version serves read tools only, and a read is always {@link Effect#ROUTINE} and
 * idempotent: any other {@link #effect()} or {@code idempotent = false} stops the application
 * at startup, naming the entity. The metadata describes the tools; it grants and denies nothing.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface SkaileAction {

    /** The consent class. Reads are {@link Effect#ROUTINE}. */
    Effect effect() default Effect.ROUTINE;

    /** How much harm a wrong call can do. */
    Risk risk() default Risk.LOW;

    /** Whether calling a tool twice with the same input has the effect of calling it once. */
    boolean idempotent() default true;

    /** The role the app's own access check needs; {@link MinTier#UNSET} leaves it out. */
    MinTier minTier() default MinTier.UNSET;

    /**
     * Who may see a result. {@link Disclosure#SESSION_VISIBLE} only when the results hold nothing
     * that any reader of the session may not see.
     */
    Disclosure disclosure() default Disclosure.OWNER_PRIVATE;

    /** The consent class of a tool. */
    enum Effect {
        /** Ordinary work inside the app, and every read. */
        ROUTINE("routine"),
        /** Reaches outside the app. */
        EXTERNAL("external"),
        /** Administrative, such as changing who may do what. */
        PRIVILEGED("privileged");

        private final String wire;

        Effect(String wire) {
            this.wire = wire;
        }

        /** The value served in {@code _meta}. */
        public String wire() {
            return wire;
        }
    }

    /** How much harm a wrong call can do. */
    enum Risk {
        LOW("low"),
        MEDIUM("medium"),
        HIGH("high");

        private final String wire;

        Risk(String wire) {
            this.wire = wire;
        }

        /** The value served in {@code _meta}. */
        public String wire() {
            return wire;
        }
    }

    /** The role the app's own access check needs. */
    enum MinTier {
        /** No {@code minTier} is served. */
        UNSET(null),
        VIEWER("Viewer"),
        USER("User"),
        OWNER("Owner");

        private final String wire;

        MinTier(String wire) {
            this.wire = wire;
        }

        /** The value served in {@code _meta}, or {@code null} for {@link #UNSET}. */
        public String wire() {
            return wire;
        }
    }

    /** Who may see a tool's result. */
    enum Disclosure {
        SESSION_VISIBLE("session-visible"),
        OWNER_PRIVATE("owner-private");

        private final String wire;

        Disclosure(String wire) {
            this.wire = wire;
        }

        /** The value served in {@code _meta}. */
        public String wire() {
            return wire;
        }
    }
}
