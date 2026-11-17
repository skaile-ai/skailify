<!-- SPDX-License-Identifier: EPL-2.0 -->

# Skailify EMF/MCP adapter

> **Status: preliminary.** Bundle names, packages and APIs may still change; the final naming is
> to be agreed with Data In Motion, who contributed the adapter. License: EPL-2.0 (this folder
> only; the rest of the repository is Apache-2.0).

Makes an EMF/OSGi backend (Eclipse Fennec) reachable for Skaile agents:

- **`de.dim.skailify.emf.tools`**: generic MCP tools over any EPackage and Fennec repository. The
  read tools `describe_model`, `query` and `get` are served by default; `create`, `update` and
  `delete` only with an explicit opt-in (see [Write tools](#write-tools-ungoverned-your-responsibility)).
  Structured validation errors, per-call read/write scopes.
- **`de.dim.skailify.mcp`**: an MCP server component for eclipse-fennec/emf.osgi-mcp that can be an
  OAuth resource server (RFC 6750, RFC 9728 metadata) and hands the verified caller to the tools;
  every tool's MCP annotations (`readOnlyHint`, `destructiveHint`, …) and its Skaile action
  metadata at `_meta["ai.skaile/action"]`; static-token mode; the
  `X-Skaile-Preview-Authorization` fallback behind the Skaile preview proxy.
- **`de.dim.skailify.manifest`**: `/.well-known/skailify.json`, a discovery manifest: the app, its
  embed URL, its MCP endpoint and where tokens come from. Skaile does not import it yet.

The app plugs in through its EPackage, its repository and configuration; nothing here knows an
application. Integration step by step: [AGENTS.md](AGENTS.md). The conventions the tools follow
are in [docs/mcp-conventions.md](../../docs/mcp-conventions.md).

## Tools and their action metadata

Every tool declares MCP annotations and carries its Skaile action metadata at
`_meta["ai.skaile/action"]`, derived from the `skailify` EAnnotation
(source `https://data-in-motion.biz/skailify`) of the EPackage and its classes:

| Tool | Served | `readOnlyHint` | `effect` | `risk` | `idempotent` | `disclosure` |
|---|---|---|---|---|---|---|
| `describe_model` | always | `true` | `routine` | `low` | `true` | `session-visible` (model structure only) |
| `query`, `get` | always | `true` | `routine` | package `readRisk`, default `low` | `true` | package `disclosure`, default `owner-private` |
| `create` | opt-in | `false` | strongest `effectClass` of package and visible classes, default `routine` | highest `risk` of package and visible classes, at least `medium` | `false` | |
| `update` | opt-in | `false` (`destructiveHint`) | as `create`, at least `privileged` | as `create` | `true` | |
| `delete` | opt-in | `false` (`destructiveHint`) | as `create`, at least `privileged` | `high` | `true` | |

A class counts with what its supertypes say, hidden ones included; the strongest value wins. A
package-level `minTier` (`Viewer`, `User`, `Owner`) goes on every tool. A value outside the
vocabulary (a typo, the wrong case) fails safe: it is taken as the strongest value of its key
(`privileged`, `high`, `Owner`, `owner-private`), with a warning in the log. The metadata describes
the tools; it does not grant or deny anything, and the platform does not put MCP calls through
approval.

A served tool whose metadata contradicts its annotations (a `readOnlyHint` tool that is not
`routine`, a `destructiveHint` tool that is) is left out of the endpoint, with an error in the log;
the other tools are still served.

**Your own tools.** An `AnnotatedMCPTool` you write and register next to these must implement
`getAction()` and return its `ActionMeta`; otherwise it has no `_meta["ai.skaile/action"]` and
`skailify-check-mcp` reports `missing-action-meta`.

## Write tools: ungoverned, your responsibility

`create`, `update` and `delete` are **off by default**: a `SkailifyMCPServer` serves only tools
that declare `readOnlyHint: true` unless its configuration sets `"write.tools": true`. Without the
opt-in they are neither listed nor callable.

With the opt-in on, the write tools are served **ungoverned and your responsibility**: the Skaile
platform applies no approval or consent to MCP calls, so an agent with a write token changes data
directly, as the user. The server logs a warning saying so when it activates, and
`skailify-check-mcp` reports `write-tool-ungoverned` for each write tool. Use it only for tests or
trusted automation. Writes that need the user's consent belong in `app.*` capabilities of the UI
adapter ([`frontend/vue-tsm`](../../frontend/vue-tsm/)), where the platform's approval applies.

## The discovery manifest

`/.well-known/skailify.json` lists the app (`id`, `name`, `description`, `url`, `embedUrl`), the MCP
endpoint (`url`, `transport`) and the auth block (`type`, `issuers`, `scopes`,
`protectedResourceMetadata`). It holds nothing per tool: no effect classes, approvals or grants.
Those live only in each tool's `_meta`. Point its `mcp.endpoint` at the endpoint you give agents.

## Build and run

JDK 21 (the pinned Fennec builds are Java 21 class files):

```sh
./gradlew build
```

builds the bundles and runs the unit tests and the OSGi integration tests.

```sh
./gradlew run.example
```

starts the adapter over the example shop model with the read tools at `http://127.0.0.1:8080/mcp`
(loopback callers only) and the manifest at `http://127.0.0.1:8080/.well-known/skailify.json`. CI
runs `skailify-check-mcp` against it:

```sh
npx --package @skaile/workspaces -- skailify-check-mcp --strict http://127.0.0.1:8080/mcp
```

Example and test support only (not part of the adapter): `de.dim.skailify.example.model` (a small
shop model), `de.dim.skailify.example.app` (the configuration `run.example` uses),
`de.dim.skailify.testing.filerepository` (a file/XMI repository, so the tests and the example
need no database) and `de.dim.skailify.tests` (OSGi integration tests over real HTTP).

## Dependencies

Released artifacts come from Maven Central (`cnf/ext/central.mvn`). Most of the Fennec artifacts
this adapter needs have no release yet, so they **stay pinned to exact snapshot builds** that build
and pass the tests as of 2026-11-05: `cnf/ext/fennec-pinned.xml` is an OSGi repository index whose
entries point at the timestamped jars in Maven Central's snapshot repository, each checked by
SHA-256. A new snapshot never comes in by itself.

Still snapshots, and why:

| Project | Version line | Pinned builds | Why not a release |
|---|---|---|---|
| Fennec EMF (`org.eclipse.fennec.emf`): `osgi.api`, `osgi.component.minimal`, `osgi.metadata`, `osgi.eobject.registry`, `osgi.codegen`, `osgi.bnd.library.project` | 1.1.0 | 2026-10-31 | 1.0.2 is released, but Fennec MCP, Persistence and Codec are built against the 1.1.0 line; mixing lines puts two EMF OSGi lines into one runtime |
| Fennec MCP (`org.eclipse.fennec.mcp`): `api`, `endpoint`, `http.component`, `auth.jwt` | 0.1.0 | 2026-10-06 | no release yet |
| Fennec Codec (`org.eclipse.fennec.codec`): `api`, `metadata` | 0.1.0 | 2026-10-30 | no release yet |
| Fennec Persistence (`org.eclipse.fennec.persistence`): `persistence`, `capabilities`, `repository`, `query`, `query.derived`, `pushstreams`, `command.model`, `expression.model`, `expression.ocl`, `query.model`, `stream.model`, `tck` (tests only) | 0.1.0 | 2026-11-05 | no release yet |
| Fennec M2X (`org.eclipse.fennec.m2x`): `unit`, `ocl.api`, `ocl.model`, `ocl.parser`, `ocl.engine` | 0.1.1 | 2026-10-31 | no release yet |

Central deletes old snapshot builds after a while. When a build fails to download a pinned jar,
move the pins: build with the snapshots that are current, check the tests, regenerate the index
with `bnd index` over those jars and point its `url` entries at the timestamped jars. Move to
releases as soon as they exist. Fennec's workspace libraries (`fennecEMF`, `fennecMCP`,
`fennecPersistence`) are not used, because their indexes name open `-SNAPSHOT` versions.

## License

This folder is EPL-2.0: every source file carries a Data In Motion EPL-2.0 header
(`SPDX-License-Identifier: EPL-2.0`), and the license text is in [LICENSE](LICENSE). The rest of
the repository is Apache-2.0, see [LICENSE](../../LICENSE). The Gradle wrapper scripts keep their
own Apache-2.0 headers.
