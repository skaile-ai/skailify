/**
 * Copyright (c) 2026 Data In Motion and others.
 * All rights reserved.
 *
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 */
package de.dim.skailify.mcp;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The Skaile action metadata of a tool, served in the tool list at
 * {@code _meta["ai.skaile/action"]}. The object is strict: it has exactly these fields, and a
 * value outside the vocabulary is refused here rather than served.
 *
 * @param effect {@value #ROUTINE}, {@value #EXTERNAL} or {@value #PRIVILEGED}: the consent class;
 *            every read is routine
 * @param risk {@value #LOW}, {@value #MEDIUM} or {@value #HIGH}: how much harm a wrong call can do
 * @param idempotent whether calling it twice with the same input has the effect of calling it once
 * @param minTier {@code Viewer}, {@code User} or {@code Owner}, or null: the role the tool's own
 *            access check needs
 * @param disclosure {@value #SESSION_VISIBLE} or {@value #OWNER_PRIVATE}, or null: who may see a
 *            result; set it on every read
 */
public record ActionMeta(String effect, String risk, boolean idempotent, String minTier, String disclosure) {

	/** The {@code _meta} key the metadata is served under */
	public static final String KEY = "ai.skaile/action";

	public static final String ROUTINE = "routine";
	public static final String EXTERNAL = "external";
	public static final String PRIVILEGED = "privileged";
	/** Weakest first */
	public static final List<String> EFFECTS = List.of(ROUTINE, EXTERNAL, PRIVILEGED);

	public static final String LOW = "low";
	public static final String MEDIUM = "medium";
	public static final String HIGH = "high";
	/** Lowest first */
	public static final List<String> RISKS = List.of(LOW, MEDIUM, HIGH);

	public static final List<String> TIERS = List.of("Viewer", "User", "Owner");

	public static final String SESSION_VISIBLE = "session-visible";
	public static final String OWNER_PRIVATE = "owner-private";
	public static final List<String> DISCLOSURES = List.of(SESSION_VISIBLE, OWNER_PRIVATE);

	public ActionMeta {
		check(effect, EFFECTS, "effect");
		check(risk, RISKS, "risk");
		if (minTier != null) {
			check(minTier, TIERS, "minTier");
		}
		if (disclosure != null) {
			check(disclosure, DISCLOSURES, "disclosure");
		}
	}

	/** The metadata of a read: routine and idempotent */
	public static ActionMeta read(String risk, String minTier, String disclosure) {
		return new ActionMeta(ROUTINE, risk, true, minTier, disclosure);
	}

	/** The value served at {@code _meta["ai.skaile/action"]} */
	public Map<String, Object> toMap() {
		Map<String, Object> map = new LinkedHashMap<>();
		map.put("effect", effect);
		map.put("risk", risk);
		map.put("idempotent", idempotent);
		if (minTier != null) {
			map.put("minTier", minTier);
		}
		if (disclosure != null) {
			map.put("disclosure", disclosure);
		}
		return map;
	}

	/** The {@code _meta} of a tool definition carrying this metadata */
	public Map<String, Object> toToolMeta() {
		return Map.of(KEY, toMap());
	}

	/** The stronger of two values of an ordered vocabulary ({@link #EFFECTS}, {@link #RISKS}) */
	public static String max(List<String> order, String a, String b) {
		return order.indexOf(a) >= order.indexOf(b) ? a : b;
	}

	private static void check(String value, List<String> allowed, String what) {
		if (!allowed.contains(value)) {
			throw new IllegalArgumentException(what + " must be one of " + allowed + ": " + value);
		}
	}
}
