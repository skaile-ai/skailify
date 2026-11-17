<!-- SPDX-License-Identifier: EPL-2.0 -->

# AGENTS.md: integrate the Skailify EMF/MCP adapter into an OSGi backend

> **Status: preliminary.** Bundle names, packages and APIs may still change. Contributed by
> Data In Motion; the final naming is to be agreed with Data In Motion.

Use the names as they are now and expect a rename later; keep the integration in one place
(run descriptor and configuration) so it is easy to follow.

You are a coding agent. Follow this file from top to bottom to make an existing EMF/OSGi
backend reachable for Skaile agents: generic model tools over MCP, an OAuth resource server
for Skaile's per-user MCP access, and the `/.well-known/skailify.json` discovery manifest. Do every step,
run every check, and report what you could not verify.

**Writes and consent: read this before you expose anything.** `create`, `update` and `delete` are
MCP tools. The Skaile platform does **not** apply its approval cards or any user consent to MCP
calls: an agent with a write token changes data directly, as the user. The action metadata the
tools carry (Step 3) describes them; nothing enforces it on an MCP call. So:

- **Write tools are off by default.** A `SkailifyMCPServer` serves only tools that declare
  `readOnlyHint=true` (`describe_model`, `query`, `get`) unless its configuration sets
  `"write.tools": true`. Without the opt-in, `create`, `update` and `delete` are neither listed
  nor callable (a call is refused as an unknown tool). A tool without annotations counts as a
  write tool.
- **With `"write.tools": true` the writes are ungoverned and your responsibility.** No Skaile
  approval or consent applies to them; the server logs a WARN saying so when it activates. Turn
  it on only for tests or trusted automation, and say why in the app's configuration.
- Expose the read-only endpoint (Step 4, or any endpoint without the opt-in) to agents.
- Put writes that need consent through `app.*` actions of the UI adapter (`frontend/vue-tsm` in
  this repository), where the platform's approval applies.

The platform design treats MCP as the read and query channel. That may change or remove the
write tools here.

## What it does

| Bundle | What it gives the app |
|---|---|
| `de.dim.skailify.mcp` | `SkailifyMCPServer` (factory PID `SkailifyMCPServer`): an MCP endpoint on the HTTP whiteboard, a drop-in for the upstream `HttpMCPServerComponent`, that can be an OAuth resource server (RFC 6750 challenges, RFC 9728 metadata, audience and scope checks) and hands the verified caller (`Caller`) to the tools. `SkailifyToolProvider`: collects tools and carries their annotations (`readOnlyHint`, `destructiveHint`, …) and their Skaile action metadata (`_meta["ai.skaile/action"]`) into the tool list. |
| `de.dim.skailify.emf.tools` | `SkailifyEmfTools` (factory PID): the tools `describe_model`, `query`, `get`, `create`, `update`, `delete` over one EPackage and one Fennec `Repository`. JSON in and out, filters as Fennec queries, OCL/Diagnostician validation with structured errors, unique attributes, read and write scopes. |
| `de.dim.skailify.manifest` | `SkailifyManifest` (factory PID): serves `/.well-known/skailify.json` for discovery: the app, its embed URL, the MCP endpoint and the token issuers. Nothing per tool. |

The example and test-only bundles (`de.dim.skailify.example.model`, `de.dim.skailify.example.app`,
`de.dim.skailify.testing.filerepository`, `de.dim.skailify.tests`) are not part of the adapter.
Do not deploy them. `de.dim.skailify.example.app/config/configuration.json` is a complete,
working configuration to copy from.

## Prerequisites

- Java 21, an OSGi framework with Declarative Services, Configuration Admin and the HTTP
  servlet whiteboard (the tests use Felix and Jetty 12).
- bnd (workspace or Maven/Gradle plugin) to build and resolve.
- EMF via Eclipse Fennec `emf.osgi` (the EPackage as an OSGi service with `emf.nsURI`).
- Eclipse Fennec `emf.osgi-mcp` (`org.eclipse.fennec.mcp.*`, MCP Java SDK) and, for OAuth,
  its `org.eclipse.fennec.mcp.auth.jwt` (`JwtTokenVerifier`).
- A Fennec persistence `Repository` service for the app's data
  (`org.eclipse.fennec.persistence.repository.api`), registered with `persistence.repository.id`.
- For OCL constraints: the Fennec m2x OCL engine and parser bundles.

## Step 1: build and add the bundles

`./gradlew build` in this folder builds the bundles and runs all tests. Add the three adapter
bundles to the app's run descriptor (`-runrequires` / `-runbundles`) and resolve. Keep one
emf.osgi runtime stack (see `de.dim.skailify.tests/test.bndrun` for a working set).

## Step 2: wire the tools to the app's model and repository

Configure through Configuration Admin (a configurator JSON, `.cfg` files or code). Minimal set:

```json
"SkailifyEmfTools~app": {
  "skailify.model": "app",
  "epackage.target": "(emf.nsURI=https://example.org/app/1.0)",
  "repository.target": "(persistence.repository.id=app)",
  "unique.attributes": ["Named.name"],
  "scope.read": "app:read",
  "scope.write": "app:write"
},
"SkailifyToolProvider~app": {
  "name": "app_tools",
  "description": "the app's model tools",
  "tools.target": "(skailify.model=app)",
  "tools.cardinality.minimum": 6
},
"SkailifyMCPServer~app": {
  "server.name": "app",
  "osgi.http.whiteboard.servlet.pattern": "/mcp",
  "osgi.http.whiteboard.target": "(id=app-http)",
  "has.tool.capability": true,
  "toolProviders.target": "(name=app_tools)"
}
```

This endpoint serves the three read tools only: `write.tools` is off. To serve `create`,
`update` and `delete` on it as well, add `"write.tools": true` to `SkailifyMCPServer~app`. Those
writes are ungoverned and your responsibility (see "Writes and consent" above).

Other tool options: `tool.prefix`, `types.excluded`, `messages.annotation.source` (a class
annotation holding a human message per constraint name), `structural.validation`,
`label.attributes`, `read.only`, `query.default.top`, `query.max.top`.

## Step 3: hide, describe and weigh through the model

Put an EAnnotation with source `https://data-in-motion.biz/skailify` on the EPackage, a class or a
feature:

| key | on | meaning |
|---|---|---|
| `expose` = `false` | class, feature | hidden from agents: the tools neither show nor accept it; a reference to a hidden class is hidden too |
| `description` | package, class, feature | what an agent should know, in place of the GenModel documentation |
| `effectClass` | package, class | `routine`, `external` or `privileged`: the `effect` of the write tools (the strongest of the package and its visible classes; `update` and `delete` are at least `privileged`) |
| `risk` | package, class | `low`, `medium` or `high`: the `risk` of the write tools (the highest wins; at least `medium`, `delete` always `high`) |
| `readRisk` | package | the `risk` of `query` and `get`; default `low` |
| `disclosure` | package | `session-visible` or `owner-private`: who may see what `query` and `get` answer; default `owner-private`. Choose `session-visible` only when every reader of a Skaile session may see every object the tools show |
| `minTier` | package | `Viewer`, `User` or `Owner`: the role the app's own access check needs, on every tool |

These become each tool's `_meta["ai.skaile/action"]` (see README.md, "Tools and their action
metadata"). A class also counts with what its supertypes say (hidden ones too); the strongest value
wins. A value outside the vocabulary (a typo, the wrong case) is taken as the strongest value of its
key (`privileged`, `high`, `Owner`, `owner-private`) with a warning in the log, so check the log
after startup. They describe the tools; nothing enforces them on an MCP call.

**Tools of your own.** If the app registers its own `AnnotatedMCPTool`s next to the model tools,
each must implement `getAction()` and return its `ActionMeta` (effect, risk, idempotent, and for a
read `disclosure`). Without it the tool has no `_meta["ai.skaile/action"]` and `skailify-check-mcp`
reports `missing-action-meta`. A tool whose metadata contradicts its annotations (`readOnlyHint`
but not `routine`, `destructiveHint` but `routine`) is left out of the endpoint with an error in
the log.

Hide secrets (credentials, bank details, internal notes) with `expose=false`. Check with
`describe_model` that they are gone.

## Step 4: a read-only endpoint (the one to give agents)

A second tool set over the same model with only the read tools, on its own endpoint. This is the
endpoint to register for Skaile agents for now (see "Writes and consent" above):

```json
"SkailifyToolProvider~app-read": {
  "name": "app_read_tools",
  "description": "the app's read tools",
  "tools.target": "(&(skailify.model=app)(tool.readOnly=true))",
  "tools.cardinality.minimum": 3
},
"SkailifyMCPServer~app-read": {
  "server.name": "app-read",
  "osgi.http.whiteboard.servlet.pattern": "/mcp-read",
  "osgi.http.whiteboard.target": "(id=app-http)",
  "has.tool.capability": true,
  "toolProviders.target": "(name=app_read_tools)"
}
```

Each endpoint is its own OAuth resource (`<base>/mcp-read`); a token for it needs its audience.

## Step 5: authentication

Choose one mode per endpoint.

**OAuth resource server** (for Skaile's per-user MCP OAuth). Bind a `JwtTokenVerifier` to the
app's identity provider and switch the server on:

```json
"JwtTokenVerifier~app": {
  "verifier.name": "app",
  "jwks.url": "https://id.example.org/realms/app/protocol/openid-connect/certs",
  "issuer": "https://id.example.org/realms/app"
},
"SkailifyMCPServer~app": {
  "...": "as above",
  "verifier.target": "(verifier.name=app)",
  "oauth.enabled": "true",
  "public.url": "https://app.example.org",
  "oauth.authorization.servers": ["https://id.example.org/realms/app"],
  "oauth.scopes.supported": ["app:read", "app:write"],
  "oauth.scopes.required": ["app:read"]
}
```

- A request without a token gets `401` with `WWW-Authenticate: Bearer …, resource_metadata="<base>/.well-known/oauth-protected-resource/mcp"`;
  the metadata (RFC 9728) names the authorization servers and scopes. That is how an MCP client
  finds where to get a token.
- A token must verify (signature, issuer, expiry), carry the resource (`<base>/mcp`, or
  `oauth.resource`) or one of `oauth.audiences` in `aud`, else `401 invalid_token`; it must
  grant `oauth.scopes.required`, else `403 insufficient_scope`.
- `scope.read` / `scope.write` of the tools are checked per call: a read token reads but does not
  write.
- With OAuth on and no verifier bound, the endpoint answers `503`; it is never open.
- `public.url` fixes the base URL; empty, it is taken from the request (`Host`,
  `X-Forwarded-*`). Behind a proxy that rewrites the host, set it.
- Every tool gets the verified `Caller` (subject, username, client, scopes, token). Log changes
  with it. Authorization against the app's own data stays the app's job.

**Static token** (OAuth off): `auth.token` on the server; every request needs
`Authorization: Bearer <token>`. Without a token configured only loopback callers get in.

**Behind the Skaile preview proxy:** the proxy drops `Authorization`. A client sends the app's
token as `X-Skaile-Preview-Authorization: Bearer <token>` instead; the adapter reads it when
`Authorization` is absent, in both modes. A real `Authorization` header always wins.

## Step 6: the discovery manifest

```json
"SkailifyManifest~app": {
  "app.id": "app",
  "app.name": "Example App",
  "mcp.endpoint": "/mcp-read",
  "oauth.enabled": "true",
  "auth.issuers": ["https://id.example.org/realms/app"],
  "auth.scopes": ["app:read"],
  "osgi.http.whiteboard.target": "(id=app-http)"
}
```

`GET /.well-known/skailify.json` then lists the app, `embedUrl`, `mcp.url` (point `mcp.endpoint` at
the endpoint you give agents) and the auth block with the protected resource metadata URL. It is
for discovery only: it lists no tools, effect classes, approvals or grants; those are in each
tool's `_meta`. The format is a draft (`0.1-draft`).

The platform does not import this manifest yet: register the MCP endpoint in Skaile by hand.

## Step 7: verify

1. `./gradlew build` here: unit tests and the OSGi integration tests
   (`de.dim.skailify.tests`) pass.
2. In the app's runtime:
   - `curl -i -X POST <base>/mcp` without a token: `401` with `resource_metadata` (OAuth) or
     `401`/`403` (static token / loopback only).
   - `curl <base>/.well-known/oauth-protected-resource/mcp` and
     `curl <base>/.well-known/skailify.json`: valid JSON with your issuer, scopes and endpoint.
   - `npx --package @skaile/workspaces -- skailify-check-mcp --strict <base>/mcp-read` (add
     `--token` or `--preview` as your auth needs): no errors and no warnings.
   - An MCP client with a valid token: `tools/list` shows the three read tools with
     annotations and `_meta["ai.skaile/action"]`, and a `create` call is refused;
     `describe_model` hides what you hid; `query`.
   - Only if an endpoint has `"write.tools": true`: the WARN at activation, `tools/list` shows
     the six tools, `skailify-check-mcp` warns `write-tool-ungoverned` for each write tool, `create` with a constraint violation (structured `constraint_violation`), a
     write with a read-only token (`insufficient_scope`).
   - The same through the Skaile preview URL with `X-Skaile-Preview-Authorization`.
3. Report exactly which of these you ran and what happened.

## Known limits

- **Snapshots.** Most Fennec artifacts have no release yet. This workspace pins them to exact
  snapshot builds (`cnf/ext/fennec-pinned.xml`; the list and the reasons are in README.md,
  "Dependencies"). Do the same in the app's workspace: an open `-SNAPSHOT` can change under a
  build overnight. Pinned builds expire when Central deletes old
  snapshots; then move the pins, or move to releases when they exist.
- **Network reach.** Skaile reaches the MCP endpoint and the manifest from its own network: an
  app reachable only inside a private network is not reachable for Skaile agents.
- **Upstream gaps.** `SkailifyMCPServer` and `SkailifyToolProvider` re-do parts of
  `emf.osgi-mcp` (tool annotations and `_meta`, caller context, resource metadata;
  eclipse-fennec/emf.osgi-mcp#55–#59). Once upstream has them, they go.
- The EAnnotation source `https://data-in-motion.biz/skailify` is the contract with the model. Like
  the names, it may change with the final naming.
