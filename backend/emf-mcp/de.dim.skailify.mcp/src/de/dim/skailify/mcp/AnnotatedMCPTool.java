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

import org.eclipse.fennec.mcp.api.MCPTool;
import org.osgi.annotation.versioning.ConsumerType;

import io.modelcontextprotocol.spec.McpSchema.ToolAnnotations;

/**
 * An MCP tool with a human-readable title, the MCP tool annotations and its Skaile action
 * metadata ({@link ActionMeta}, served at {@code _meta["ai.skaile/action"]}). Register it as an
 * {@link MCPTool} service; a {@code SkailifyToolProvider} serves both, the upstream
 * {@code MCPToolProvider} ignores them.
 * <p>
 * Upstream gap: meant to become part of {@link MCPTool}.
 */
@ConsumerType
public interface AnnotatedMCPTool extends MCPTool {

	/** The title shown to people, or null */
	default String getTitle() {
		return null;
	}

	/**
	 * The tool annotations ({@code readOnlyHint}, {@code destructiveHint},
	 * {@code idempotentHint}, {@code openWorldHint}), or null for none. The SDK's
	 * {@link ToolAnnotations} title is filled from {@link #getTitle()} when it has none.
	 */
	default ToolAnnotations getAnnotations() {
		return null;
	}

	/**
	 * The Skaile action metadata, served at {@code _meta["ai.skaile/action"]}, or null for none.
	 * A read ({@code readOnlyHint=true}) must be {@code routine}, and a tool with
	 * {@code destructiveHint=true} must not be: a {@code SkailifyMCPServer} leaves a tool that
	 * contradicts its own annotations out, with an error in the log. Implement it on every tool
	 * you write: a tool without it fails {@code skailify-check-mcp} ({@code missing-action-meta}).
	 */
	default ActionMeta getAction() {
		return null;
	}

	/**
	 * Whether annotations declare a tool that only reads: {@code readOnlyHint=true}. No
	 * annotations, or no hint, count as a tool that changes data. The one rule for which tools an
	 * endpoint without {@code write.tools} serves.
	 */
	static boolean readOnly(ToolAnnotations annotations) {
		return annotations != null && Boolean.TRUE.equals(annotations.readOnlyHint());
	}

	/** Annotations of a tool that only reads */
	static ToolAnnotations query(String title) {
		return new ToolAnnotations(title, Boolean.TRUE, Boolean.FALSE, Boolean.TRUE, Boolean.FALSE, null);
	}

	/**
	 * Annotations of a tool that changes data
	 *
	 * @param destructive whether it may destroy or overwrite data (delete, update) rather than
	 *            only add
	 * @param idempotent whether calling it again with the same arguments has no further effect
	 */
	static ToolAnnotations effect(String title, boolean destructive, boolean idempotent) {
		return new ToolAnnotations(title, Boolean.FALSE, destructive, idempotent, Boolean.FALSE, null);
	}
}
