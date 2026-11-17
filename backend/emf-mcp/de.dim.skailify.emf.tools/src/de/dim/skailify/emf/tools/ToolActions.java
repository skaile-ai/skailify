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
package de.dim.skailify.emf.tools;

import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;

import org.eclipse.emf.ecore.EClass;
import org.eclipse.emf.ecore.EClassifier;
import org.eclipse.emf.ecore.EModelElement;
import org.eclipse.emf.ecore.EPackage;

import de.dim.skailify.emf.SkailifyAnnotations;
import de.dim.skailify.mcp.ActionMeta;

/**
 * The Skaile action metadata of the model tools, derived from the {@code skailify} EAnnotation of
 * the EPackage and its classes ({@link SkailifyAnnotations}):
 * <ul>
 * <li><b>describe_model</b>: routine, low risk, idempotent, {@code session-visible} (it shows the
 * model's structure only, no stored data).</li>
 * <li><b>query</b>, <b>get</b>: routine, idempotent; {@code risk} from the package's
 * {@code readRisk} (default low), {@code disclosure} from the package's {@code disclosure}
 * (default {@code owner-private}).</li>
 * <li><b>create</b>, <b>update</b>, <b>delete</b>: {@code effect} is the strongest
 * {@code effectClass} of the package and its visible classes (default routine); {@code risk} the
 * highest {@code risk} of the package and its visible classes, at least medium (high for
 * delete). A class counts with what its supertypes say, too, hidden ones included: the strongest
 * value wins. update and delete may destroy data, so their effect is at least privileged: a
 * destructive tool is never routine.</li>
 * <li>Every tool: {@code minTier} from the package's {@code minTier}, when given.</li>
 * </ul>
 * A value outside the vocabulary (a typo, the wrong case) fails safe, with a warning: it counts as
 * the strongest value of its key ({@code privileged}, {@code high}, {@code Owner},
 * {@code owner-private}), never as the weakest.
 */
final class ToolActions {

	private static final Logger LOG = Logger.getLogger(ToolActions.class.getName());

	private final String minTier;
	private final String readRisk;
	private final String disclosure;
	private final String writeEffect;
	private final String writeRisk;

	ToolActions(EPackage ePackage) {
		minTier = value(ePackage, SkailifyAnnotations.MIN_TIER, ActionMeta.TIERS, null, "Owner");
		readRisk = value(ePackage, SkailifyAnnotations.READ_RISK, ActionMeta.RISKS, ActionMeta.LOW, ActionMeta.HIGH);
		disclosure = value(ePackage, SkailifyAnnotations.DISCLOSURE, ActionMeta.DISCLOSURES, ActionMeta.OWNER_PRIVATE,
				ActionMeta.OWNER_PRIVATE);
		String effect = ActionMeta.ROUTINE;
		String risk = ActionMeta.LOW;
		List<EModelElement> elements = new ArrayList<>();
		elements.add(ePackage);
		classes(ePackage, elements);
		for (EModelElement element : elements) {
			effect = ActionMeta.max(ActionMeta.EFFECTS, effect, value(element, SkailifyAnnotations.EFFECT_CLASS,
					ActionMeta.EFFECTS, ActionMeta.ROUTINE, ActionMeta.PRIVILEGED));
			risk = ActionMeta.max(ActionMeta.RISKS, risk,
					value(element, SkailifyAnnotations.RISK, ActionMeta.RISKS, ActionMeta.LOW, ActionMeta.HIGH));
		}
		writeEffect = effect;
		writeRisk = risk;
	}

	/** describe_model: the model's structure, no stored data */
	ActionMeta describe() {
		return ActionMeta.read(ActionMeta.LOW, minTier, ActionMeta.SESSION_VISIBLE);
	}

	/** query and get: stored objects */
	ActionMeta read() {
		return ActionMeta.read(readRisk, minTier, disclosure);
	}

	/**
	 * A tool that changes stored objects
	 *
	 * @param destructive whether it may destroy or overwrite data
	 * @param idempotent whether a second identical call has no further effect
	 * @param risk the least risk of the tool itself
	 */
	ActionMeta write(boolean destructive, boolean idempotent, String risk) {
		String effect = destructive ? ActionMeta.max(ActionMeta.EFFECTS, writeEffect, ActionMeta.PRIVILEGED) : writeEffect;
		return new ActionMeta(effect, ActionMeta.max(ActionMeta.RISKS, writeRisk, risk), idempotent, minTier, null);
	}

	private static void classes(EPackage ePackage, List<EModelElement> result) {
		for (EClassifier classifier : ePackage.getEClassifiers()) {
			if (classifier instanceof EClass eClass && !SkailifyAnnotations.hidden(eClass)) {
				result.add(eClass);
				// what a supertype says holds for its subclasses, whether the supertype is visible or not
				result.addAll(eClass.getEAllSuperTypes());
			}
		}
		ePackage.getESubpackages().forEach(sub -> classes(sub, result));
	}

	/**
	 * The annotated value; {@code absent} when there is none, {@code strongest} (with a warning)
	 * when it is outside the vocabulary
	 */
	private static String value(EModelElement element, String key, List<String> allowed, String absent, String strongest) {
		String value = SkailifyAnnotations.get(element, key);
		if (value == null) {
			return absent;
		}
		if (!allowed.contains(value)) {
			LOG.warning(() -> "skailify annotation " + key + "=" + value + " is not one of " + allowed + "; taken as "
					+ strongest);
			return strongest;
		}
		return value;
	}
}
