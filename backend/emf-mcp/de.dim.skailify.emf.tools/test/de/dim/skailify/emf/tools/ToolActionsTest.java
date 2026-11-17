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

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.eclipse.emf.ecore.EClass;
import org.eclipse.emf.ecore.EModelElement;
import org.eclipse.emf.ecore.EPackage;
import org.eclipse.emf.ecore.EcoreFactory;
import org.eclipse.emf.ecore.util.EcoreUtil;
import org.junit.jupiter.api.Test;

import de.dim.skailify.emf.SkailifyAnnotations;
import de.dim.skailify.mcp.ActionMeta;

/** The Skaile action metadata of the model tools, from the model's skailify annotations. */
class ToolActionsTest {

	@Test
	void anUnannotatedModelGivesRoutineReadsThatStayWithTheOwner() {
		ToolActions actions = new ToolActions(pkg());

		assertThat(actions.describe().toMap()).isEqualTo(
				Map.of("effect", "routine", "risk", "low", "idempotent", true, "disclosure", "session-visible"));
		assertThat(actions.read().toMap()).isEqualTo(
				Map.of("effect", "routine", "risk", "low", "idempotent", true, "disclosure", "owner-private"));
		assertThat(actions.write(false, false, ActionMeta.MEDIUM).toMap())
				.isEqualTo(Map.of("effect", "routine", "risk", "medium", "idempotent", false));
		// a tool that may destroy data is never routine
		assertThat(actions.write(true, true, ActionMeta.HIGH).toMap())
				.isEqualTo(Map.of("effect", "privileged", "risk", "high", "idempotent", true));
	}

	@Test
	void thePackageAndItsVisibleClassesSetTheWeight() {
		EPackage pkg = pkg();
		annotate(pkg, "readRisk", "medium", "disclosure", "session-visible", "minTier", "User", "effectClass", "routine");
		EClass mail = eClass(pkg, "Mail");
		annotate(mail, "effectClass", "external", "risk", "medium");
		EClass hidden = eClass(pkg, "Admin");
		annotate(hidden, "expose", "false", "effectClass", "privileged", "risk", "high");

		ToolActions actions = new ToolActions(pkg);

		assertThat(actions.read()).isEqualTo(new ActionMeta("routine", "medium", true, "User", "session-visible"));
		// the strongest visible class wins; a hidden class with no visible subclass does not count
		assertThat(actions.write(false, false, ActionMeta.MEDIUM))
				.isEqualTo(new ActionMeta("external", "medium", false, "User", null));
		assertThat(actions.write(true, true, ActionMeta.MEDIUM))
				.isEqualTo(new ActionMeta("privileged", "medium", true, "User", null));
	}

	@Test
	void aClassInheritsWhatItsSupertypesSayEvenAHiddenOne() {
		EPackage pkg = pkg();
		EClass base = eClass(pkg, "Base");
		base.setAbstract(true);
		annotate(base, "expose", "false", "effectClass", "privileged", "risk", "high");
		EClass account = eClass(pkg, "Account");
		account.getESuperTypes().add(base);

		ToolActions actions = new ToolActions(pkg);

		assertThat(actions.write(false, false, ActionMeta.MEDIUM))
				.isEqualTo(new ActionMeta("privileged", "high", false, null, null));
	}

	@Test
	void aValueOutsideTheVocabularyCountsAsTheStrongest() {
		EPackage pkg = pkg();
		annotate(pkg, "readRisk", "Low", "minTier", "admin", "disclosure", "public");
		EClass note = eClass(pkg, "Note");
		annotate(note, "effectClass", "Routine", "risk", "extreme");

		ToolActions actions = new ToolActions(pkg);

		assertThat(actions.read()).isEqualTo(new ActionMeta("routine", "high", true, "Owner", "owner-private"));
		assertThat(actions.write(false, false, ActionMeta.MEDIUM))
				.isEqualTo(new ActionMeta("privileged", "high", false, "Owner", null));
	}

	private static EPackage pkg() {
		EPackage pkg = EcoreFactory.eINSTANCE.createEPackage();
		pkg.setName("test");
		pkg.setNsURI("urn:test:actions");
		return pkg;
	}

	private static EClass eClass(EPackage pkg, String name) {
		EClass eClass = EcoreFactory.eINSTANCE.createEClass();
		eClass.setName(name);
		pkg.getEClassifiers().add(eClass);
		return eClass;
	}

	private static void annotate(EModelElement element, String... keysAndValues) {
		for (int i = 0; i < keysAndValues.length; i += 2) {
			EcoreUtil.setAnnotation(element, SkailifyAnnotations.SOURCE, keysAndValues[i], keysAndValues[i + 1]);
		}
	}
}
