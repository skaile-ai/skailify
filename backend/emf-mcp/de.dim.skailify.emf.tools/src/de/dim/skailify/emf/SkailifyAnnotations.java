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
package de.dim.skailify.emf;

import org.eclipse.emf.ecore.EClassifier;
import org.eclipse.emf.ecore.EModelElement;
import org.eclipse.emf.ecore.EReference;
import org.eclipse.emf.ecore.EStructuralFeature;
import org.eclipse.emf.ecore.util.EcoreUtil;

/**
 * Reads what a model says to Skailify, in EAnnotations with source {@value #SOURCE}:
 *
 * <pre>
 * &lt;eAnnotations source="https://data-in-motion.biz/skailify"&gt;
 *   &lt;details key="expose" value="false"/&gt;
 * &lt;/eAnnotations&gt;
 * </pre>
 *
 * <table>
 * <tr><th>key</th><th>on</th><th>meaning</th></tr>
 * <tr><td>{@value #EXPOSE}</td><td>class, feature</td><td>{@code false} hides it from agents: the
 * tools neither show nor accept it, a reference to a hidden class is hidden too</td></tr>
 * <tr><td>{@value #DESCRIPTION}</td><td>package, class, feature</td><td>what an agent should know,
 * in place of the GenModel documentation</td></tr>
 * <tr><td>{@value #EFFECT_CLASS}</td><td>package, class</td><td>{@code routine}, {@code external} or
 * {@code privileged}: the consent class of a change to its objects (the write tools' {@code effect})</td></tr>
 * <tr><td>{@value #RISK}</td><td>package, class</td><td>{@code low}, {@code medium} or {@code high}:
 * how much harm a wrong change to its objects can do (the write tools' {@code risk})</td></tr>
 * <tr><td>{@value #READ_RISK}</td><td>package</td><td>the {@code risk} of reading the model's
 * objects ({@code query}, {@code get}); default {@code low}</td></tr>
 * <tr><td>{@value #DISCLOSURE}</td><td>package</td><td>{@code session-visible} or
 * {@code owner-private}: who may see what {@code query} and {@code get} answer; default
 * {@code owner-private}</td></tr>
 * <tr><td>{@value #MIN_TIER}</td><td>package</td><td>{@code Viewer}, {@code User} or {@code Owner}:
 * the role the app's own access check needs for the tools</td></tr>
 * </table>
 *
 * How the tools' Skaile action metadata ({@code _meta["ai.skaile/action"]}) is derived from these
 * keys is described on {@code de.dim.skailify.emf.tools.ModelTools}.
 */
public final class SkailifyAnnotations {

	/** The annotation source */
	public static final String SOURCE = "https://data-in-motion.biz/skailify";

	public static final String EXPOSE = "expose";
	public static final String DESCRIPTION = "description";
	public static final String EFFECT_CLASS = "effectClass";
	public static final String RISK = "risk";
	public static final String READ_RISK = "readRisk";
	public static final String DISCLOSURE = "disclosure";
	public static final String MIN_TIER = "minTier";

	private SkailifyAnnotations() {
	}

	/** The value of the key, or null */
	public static String get(EModelElement element, String key) {
		String value = element == null ? null : EcoreUtil.getAnnotation(element, SOURCE, key);
		return value == null || value.isBlank() ? null : value.strip();
	}

	/** Whether the class is hidden from agents */
	public static boolean hidden(EClassifier classifier) {
		return "false".equalsIgnoreCase(get(classifier, EXPOSE));
	}

	/** Whether the feature is hidden: by its own annotation, or because it refers to a hidden class */
	public static boolean hidden(EStructuralFeature feature) {
		if ("false".equalsIgnoreCase(get(feature, EXPOSE))) {
			return true;
		}
		return feature instanceof EReference reference && hidden(reference.getEReferenceType());
	}

	/** What an agent should know about the element: the Skailify description, else the documentation */
	public static String description(EModelElement element) {
		String description = get(element, DESCRIPTION);
		return description != null ? description : EcoreUtil.getDocumentation(element);
	}
}
