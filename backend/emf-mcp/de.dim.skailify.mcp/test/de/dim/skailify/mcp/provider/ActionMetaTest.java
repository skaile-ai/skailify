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
package de.dim.skailify.mcp.provider;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import de.dim.skailify.mcp.ActionMeta;
import de.dim.skailify.mcp.AnnotatedMCPTool;
import io.modelcontextprotocol.server.McpServerFeatures.AsyncToolSpecification;
import io.modelcontextprotocol.spec.McpSchema.CallToolResult;
import io.modelcontextprotocol.spec.McpSchema.Tool;
import io.modelcontextprotocol.spec.McpSchema.ToolAnnotations;
import reactor.core.publisher.Mono;

/** The Skaile action metadata: its strict vocabulary, and the rules a tool's own annotations set */
class ActionMetaTest {

	@Test
	void servesOnlyTheFieldsItHas() {
		assertThat(ActionMeta.read("low", null, "owner-private").toToolMeta()).isEqualTo(Map.of("ai.skaile/action",
				Map.of("effect", "routine", "risk", "low", "idempotent", true, "disclosure", "owner-private")));
	}

	@Test
	void refusesValuesOutsideTheVocabulary() {
		assertThatThrownBy(() -> new ActionMeta("dangerous", "low", true, null, null)).isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> new ActionMeta("routine", "extreme", true, null, null)).isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> new ActionMeta("routine", "low", true, "Admin", null)).isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> new ActionMeta("routine", "low", true, null, "public")).isInstanceOf(IllegalArgumentException.class);
	}

	@Test
	void aReadIsRoutineAndADestructiveToolIsNot() {
		assertThat(AnnotatedToolProvider.violation(tool("query", AnnotatedMCPTool.query("Query"),
				ActionMeta.read("low", null, "owner-private")))).isNull();
		assertThat(AnnotatedToolProvider.violation(tool("query", AnnotatedMCPTool.query("Query"),
				new ActionMeta("external", "low", true, null, null)))).contains("readOnlyHint");
		assertThat(AnnotatedToolProvider.violation(tool("delete", AnnotatedMCPTool.effect("Delete", true, true),
				new ActionMeta("privileged", "high", true, null, null)))).isNull();
		assertThat(AnnotatedToolProvider.violation(tool("delete", AnnotatedMCPTool.effect("Delete", true, true),
				new ActionMeta("routine", "high", true, null, null)))).contains("destructiveHint");
		// no metadata is not judged here; skailify-check-mcp reports it
		assertThat(AnnotatedToolProvider.violation(tool("plain", null, null))).isNull();
	}

	@Test
	void anEndpointLeavesOutOnlyTheContradictoryToolsItWouldServe() {
		AsyncToolSpecification good = spec("query", AnnotatedMCPTool.query("Query"), ActionMeta.read("low", null, "owner-private"));
		AsyncToolSpecification badRead = spec("lookup", AnnotatedMCPTool.query("Lookup"),
				new ActionMeta("external", "low", true, null, null));
		AsyncToolSpecification badWrite = spec("delete", AnnotatedMCPTool.effect("Delete", true, true),
				new ActionMeta("routine", "high", true, null, null));
		AsyncToolSpecification goodWrite = spec("create", AnnotatedMCPTool.effect("Create", false, false),
				new ActionMeta("routine", "medium", false, null, null));
		List<AsyncToolSpecification> tools = List.of(good, badRead, badWrite, goodWrite);

		Map<String, String> refused = new LinkedHashMap<>();
		// write tools off: the bad write tool is not served anyway, so it is not judged
		assertThat(SkailifyMCPServer.served(tools, false, refused::put)).containsExactly(good);
		assertThat(refused).containsOnlyKeys("lookup");

		refused.clear();
		assertThat(SkailifyMCPServer.served(tools, true, refused::put)).containsExactly(good, goodWrite);
		assertThat(refused).containsOnlyKeys("lookup", "delete");
	}

	private static Tool tool(String name, ToolAnnotations annotations, ActionMeta action) {
		Tool.Builder definition = Tool.builder(name, Map.of("type", "object"));
		if (annotations != null) {
			definition.annotations(annotations);
		}
		if (action != null) {
			definition.meta(action.toToolMeta());
		}
		return definition.build();
	}

	private static AsyncToolSpecification spec(String name, ToolAnnotations annotations, ActionMeta action) {
		return AsyncToolSpecification.builder().tool(tool(name, annotations, action))
				.callHandler((exchange, request) -> Mono.just(CallToolResult.builder().build())).build();
	}
}
