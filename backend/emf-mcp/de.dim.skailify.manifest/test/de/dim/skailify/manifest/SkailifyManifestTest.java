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
package de.dim.skailify.manifest;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

/** The manifest document: discovery only, no per-tool metadata. */
class SkailifyManifestTest {

	@Test
	@SuppressWarnings("unchecked")
	void listsTheAppEndpointAndAuth() {
		SkailifyManifest.Settings settings = new SkailifyManifest.Settings("shop", "Shop", "Orders", "", "/", "/mcp",
				true, List.of("https://id.example.org/realms/example"), List.of("shop:read"));

		Map<String, Object> document = SkailifyManifest.document(settings, "https://shop.example.org/preview/x");

		assertThat(document).containsOnlyKeys("skailify", "app", "mcp", "auth").containsEntry("skailify", "0.1-draft");
		assertThat((Map<String, Object>) document.get("app")).containsEntry("id", "shop")
				.containsEntry("description", "Orders")
				.containsEntry("embedUrl", "https://shop.example.org/preview/x/");
		assertThat((Map<String, Object>) document.get("mcp")).containsExactly(
				Map.entry("url", "https://shop.example.org/preview/x/mcp"), Map.entry("transport", "streamable-http"));
		assertThat((Map<String, Object>) document.get("auth"))
				.containsEntry("type", "oauth2")
				.containsEntry("issuers", List.of("https://id.example.org/realms/example"))
				.containsEntry("scopes", List.of("shop:read"))
				.containsEntry("protectedResourceMetadata",
						"https://shop.example.org/preview/x/.well-known/oauth-protected-resource/mcp");
	}

	@Test
	@SuppressWarnings("unchecked")
	void saysWhenThereIsNoAuth() {
		SkailifyManifest.Settings settings = new SkailifyManifest.Settings("a", "A", "", "", "https://ui.example.org/a",
				"mcp", false, List.of(), List.of());
		Map<String, Object> document = SkailifyManifest.document(settings, "http://localhost:8090");
		assertThat((Map<String, Object>) document.get("auth")).containsExactly(Map.entry("type", "none"));
		assertThat((Map<String, Object>) document.get("app")).containsEntry("embedUrl", "https://ui.example.org/a")
				.doesNotContainKey("description");
		assertThat((Map<String, Object>) document.get("mcp")).containsEntry("url", "http://localhost:8090/mcp");
	}
}
