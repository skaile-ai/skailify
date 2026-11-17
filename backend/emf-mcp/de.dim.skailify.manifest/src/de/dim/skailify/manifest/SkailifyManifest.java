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

import java.io.IOException;
import java.util.Arrays;
import java.util.Dictionary;
import java.util.Hashtable;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.osgi.framework.BundleContext;
import org.osgi.framework.ServiceRegistration;
import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.ConfigurationPolicy;
import org.osgi.service.component.annotations.Deactivate;
import org.osgi.service.component.annotations.Reference;
import org.osgi.service.metatype.annotations.Designate;

import io.modelcontextprotocol.json.McpJsonMapper;
import io.modelcontextprotocol.json.McpJsonMapperSupplier;
import jakarta.servlet.Servlet;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Serves the Skailify manifest of an app at {@code /.well-known/skailify.json} of its HTTP
 * context (under the context path, too). The manifest is for discovery only: who the app is, the
 * page Skaile embeds, the MCP endpoint to give agents and where tokens for it come from.
 * <p>
 * It says nothing about single tools: no effect classes, approvals or grants. What a tool does
 * and weighs is in the tool itself, in its annotations and its {@code _meta["ai.skaile/action"]},
 * where the platform reads it.
 * <p>
 * The format is a draft ({@value #FORMAT}); the platform does not import it yet.
 */
@Component(name = "SkailifyManifest", configurationPid = "SkailifyManifest", configurationPolicy = ConfigurationPolicy.REQUIRE,
		service = {})
@Designate(ocd = ManifestConfig.class, factory = true)
public class SkailifyManifest {

	static final String PATH = "/.well-known/skailify.json";
	static final String FORMAT = "0.1-draft";
	static final String PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";

	/** What the configuration says */
	record Settings(String appId, String appName, String appDescription, String publicUrl, String embedUrl,
			String mcpEndpoint, boolean oauth, List<String> issuers, List<String> scopes) {
	}

	private final Settings settings;
	private final ServiceRegistration<Servlet> registration;

	@Activate
	public SkailifyManifest(ManifestConfig config, BundleContext context, @Reference McpJsonMapperSupplier jsonSupplier) {
		McpJsonMapper json = jsonSupplier.get();
		settings = new Settings(config.app_id(), config.app_name(), config.app_description(), config.public_url(),
				config.embed_url(), config.mcp_endpoint(), config.oauth_enabled(), nonBlank(config.auth_issuers()),
				nonBlank(config.auth_scopes()));
		Dictionary<String, Object> properties = new Hashtable<>();
		properties.put("osgi.http.whiteboard.servlet.pattern", PATH);
		properties.put("osgi.http.whiteboard.servlet.name", "skailify-manifest-" + config.app_id());
		properties.put("osgi.http.whiteboard.target", config.osgi_http_whiteboard_target());
		registration = context.registerService(Servlet.class, new ManifestServlet(json), properties);
	}

	@Deactivate
	void deactivate() {
		try {
			registration.unregister();
		} catch (IllegalStateException e) {
			// gone with the bundle already
		}
	}

	private final class ManifestServlet extends HttpServlet {

		private static final long serialVersionUID = 1L;
		private final transient McpJsonMapper json;

		ManifestServlet(McpJsonMapper json) {
			this.json = json;
		}

		@Override
		protected void doGet(HttpServletRequest request, HttpServletResponse response) throws IOException {
			String base = settings.publicUrl().isBlank() ? requestBase(request) : strip(settings.publicUrl());
			byte[] body = json.writeValueAsBytes(document(settings, base));
			response.setStatus(HttpServletResponse.SC_OK);
			response.setContentType("application/json");
			response.setHeader("Access-Control-Allow-Origin", "*");
			response.setHeader("Cache-Control", "max-age=300");
			response.setContentLength(body.length);
			response.getOutputStream().write(body);
		}
	}

	static Map<String, Object> document(Settings settings, String base) {
		Map<String, Object> document = new LinkedHashMap<>();
		document.put("skailify", FORMAT);
		Map<String, Object> app = new LinkedHashMap<>();
		app.put("id", settings.appId());
		app.put("name", settings.appName());
		if (!settings.appDescription().isBlank()) {
			app.put("description", settings.appDescription());
		}
		app.put("url", base + "/");
		app.put("embedUrl", resolve(base, settings.embedUrl()));
		document.put("app", app);

		String endpoint = resolve(base, settings.mcpEndpoint());
		Map<String, Object> mcp = new LinkedHashMap<>();
		mcp.put("url", endpoint);
		mcp.put("transport", "streamable-http");
		document.put("mcp", mcp);

		Map<String, Object> auth = new LinkedHashMap<>();
		if (settings.oauth()) {
			auth.put("type", "oauth2");
			auth.put("issuers", settings.issuers());
			if (!settings.scopes().isEmpty()) {
				auth.put("scopes", settings.scopes());
			}
			String path = endpoint.startsWith(base) ? endpoint.substring(base.length()) : "";
			auth.put("protectedResourceMetadata", base + PROTECTED_RESOURCE_PATH + path);
		} else {
			auth.put("type", "none");
		}
		document.put("auth", auth);
		return document;
	}

	/** The base URL as the caller sees it: forwarded scheme and host first, plus the context path */
	static String requestBase(HttpServletRequest request) {
		String scheme = firstValue(request.getHeader("X-Forwarded-Proto"));
		if (scheme == null) {
			scheme = request.getScheme();
		}
		String host = firstValue(request.getHeader("X-Forwarded-Host"));
		if (host == null) {
			host = request.getHeader("Host");
		}
		if (host == null) {
			host = request.getServerName() + (request.getServerPort() > 0 ? ":" + request.getServerPort() : "");
		}
		String contextPath = request.getContextPath() == null ? "" : request.getContextPath();
		return strip(scheme + "://" + host + contextPath);
	}

	private static String firstValue(String header) {
		if (header == null || header.isBlank()) {
			return null;
		}
		int comma = header.indexOf(',');
		return (comma < 0 ? header : header.substring(0, comma)).strip();
	}

	private static String resolve(String base, String url) {
		if (url.startsWith("http://") || url.startsWith("https://")) {
			return url;
		}
		return base + (url.startsWith("/") ? url : "/" + url);
	}

	private static String strip(String url) {
		return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
	}

	private static List<String> nonBlank(String[] values) {
		return Arrays.stream(values).filter(v -> v != null && !v.isBlank()).map(String::strip).toList();
	}
}
