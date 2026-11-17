<!-- SPDX-License-Identifier: Apache-2.0 -->

# Skailify JPA/MCP adapter

> **Status: preliminary.** Read-only in this version. The artifact, property and annotation names
> may still change.

A Spring Boot starter that makes the JPA entities you choose readable for Skaile agents over MCP.
Mark an entity with `@SkailifyEntity` and the starter serves it on a streamable HTTP MCP endpoint
(`/mcp` by default) as read tools. Every tool carries its Skaile action metadata at
`_meta["ai.skaile/action"]`, taken from a `@SkaileAction` annotation on the entity, so
`skailify-check-mcp --strict` passes.

Nothing in it writes data. Writes that need the user's consent belong in `app.*` capabilities of a
UI adapter (see [`frontend/`](../../frontend/)), where the platform's approval applies; see
[MCP conventions](../../docs/mcp-conventions.md#mcp-is-for-reads-and-queries).

Integration step by step, for a coding agent: [AGENTS.md](AGENTS.md).

## Tools

| Tool | What it does |
|---|---|
| `describe_model` | The exposed record types: their attributes, the filters each takes, and the tools that read them |
| `list_<name>` | A page of records, sorted (by id by default) |
| `get_<name>` | One record by id (not served for an entity with a composite id) |
| `query_<name>` | A page of the records whose attributes match filters, sorted |

`<name>` is the entity name in snake case (`OrderLine` → `order_line`), or `@SkailifyEntity(name = …)`.

Every tool has `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true` and
`openWorldHint: false`. The metadata:

| Tool | `effect` | `risk` | `idempotent` | `minTier` | `disclosure` |
|---|---|---|---|---|---|
| `describe_model` | `routine` | `low` | `true` | | `session-visible` (model structure only) |
| an entity's tools | `routine` | `@SkaileAction(risk)`, default `low` | `true` | `@SkaileAction(minTier)`, default none | `@SkaileAction(disclosure)`, default `owner-private` |

Because only reads are served, `@SkaileAction(effect)` other than `ROUTINE`, or `idempotent = false`,
stops the application at startup, naming the entity. The metadata describes the tools; it grants
and denies nothing.

### What a record shows

- Basic attributes of these types: strings, characters, whole and decimal numbers, booleans,
  enums (by constant name), `UUID`, and `java.time` dates, times and timestamps as ISO-8601 strings
  (`LocalDateTime` and `LocalTime` without an offset, `2026-01-31T09:30:00`).
- To-one references (`@ManyToOne`, `@OneToOne`) to another exposed entity, as
  `{"entity": "customer", "id": 3}`.
- Not shown: attributes marked `@SkailifyHidden`, references to entities that are not exposed or
  whose id is hidden, collections, embedded values, and attributes of other types (`byte[]`, LOB handles, …). The
  startup log lists what it left out per entity.

### Queries

`where` maps an attribute to a value (equals) or to operators, and all conditions must hold:

```json
{ "where": { "status": "OPEN", "totalEur": { "gte": 10 }, "customer": 1 }, "orderBy": "placedOn", "direction": "desc" }
```

| Operators | Attributes |
|---|---|
| `eq`, `ne`, `in` (1 to 100 values), `isNull` | all |
| `lt`, `lte`, `gt`, `gte` (and sorting) | numbers, strings, dates and times |
| `contains`, `startsWith` (case-insensitive, `%` and `_` taken literally) | strings (not single characters) |

Queries are built with the JPA Criteria API from the metamodel and select only the served
attributes, in an entity manager of their own: no JPQL is assembled from input, no entity is loaded
into the app's persistence context, and nothing is flushed. Pages hold `skailify.mcp.default-limit`
records (50) unless the call asks for up to `skailify.mcp.max-limit` (200); a result says `hasMore`.
Records are sorted by `orderBy` and then by id, so paging with `offset` neither skips nor repeats a
record while the data does not change. An entity without a single served id has no defined order,
and paging through it is not stable.

## Access

- **Authentication is the app's.** Protect the endpoint with Spring Security, for example as an
  OAuth2 resource server. The starter refuses to start in an app without a Spring Security filter
  chain unless `skailify.mcp.allow-unauthenticated=true`, which is for local development only and
  logs a warning. The check only sees that a chain exists; make sure it requires authentication on
  the endpoint's path (a `permitAll` rule there would pass the check).
- **Behind a Skaile preview** the proxy drops `Authorization`. The starter presents
  `X-Skaile-Preview-Authorization` as `Authorization` to the app's filters when `Authorization` is
  absent (`skailify.mcp.preview-authorization`, on by default).
- **Row-level restrictions** come from `SkailifyReadFilter` beans: each returns a predicate per
  entity that every `list`, `get` and `query` call adds. Tool calls run on the request's thread, so a
  filter can read the caller from the security context. A filter restricts the entity being read,
  not the records it references: a reference still shows the id of a record the filter hides from
  the caller, and `where` can match on it.

## Configuration

| Property | Default | Meaning |
|---|---|---|
| `skailify.mcp.enabled` | `true` | Serve the endpoint |
| `skailify.mcp.path` | `/mcp` | Servlet path of the endpoint |
| `skailify.mcp.server-name`, `server-version` | `skailify-jpa-mcp`, `0.1.0` | Reported to MCP clients |
| `skailify.mcp.instructions` | a short note | Sent to the agent when it connects |
| `skailify.mcp.default-limit`, `max-limit` | `50`, `200` | Page sizes |
| `skailify.mcp.query-timeout-ms` | `10000` | Query timeout; `0` leaves it to the JPA provider |
| `skailify.mcp.allow-unauthenticated` | `false` | Serve without Spring Security (local development only) |
| `skailify.mcp.preview-authorization` | `true` | Accept the token in `X-Skaile-Preview-Authorization` |

The endpoint is stateless streamable HTTP, served by the
[MCP Java SDK](https://github.com/modelcontextprotocol/java-sdk) as a servlet next to the app's own.

## Build and run

JDK 17 or later; the Maven Wrapper is committed:

```sh
./mvnw verify
```

builds the starter and the example app and runs their tests (an MCP client against the running
server).

```sh
java -jar example/target/skailify-jpa-mcp-example.jar
```

starts the example, a small shop on in-memory H2 (customers, products and orders exposed, an audit
log not exposed), at `http://127.0.0.1:8080/mcp`, without authentication and on loopback only. CI
runs `skailify-check-mcp` against it, and it passes with `--strict` too:

```sh
npx --package @skaile/workspaces -- skailify-check-mcp --strict http://127.0.0.1:8080/mcp
```

| Module | What it is |
|---|---|
| `starter/` | `ai.skaile.skailify:skailify-jpa-mcp-spring-boot-starter`, the adapter |
| `example/` | the example app; not part of the adapter |

It is built on Spring Boot 4.1 (Jackson 3) and MCP Java SDK 2.2. The starter needs the app to bring
a JPA provider and a servlet web server (`spring-boot-starter-data-jpa` and
`spring-boot-starter-webmvc`). It is not published to a Maven repository yet: `./mvnw install`
puts it in your local one.

## Known limits

- Read-only: no write tools, by design of this version.
- No `/.well-known/skailify.json` manifest yet; register the MCP server with Skaile by hand.
- One persistence unit: the starter backs off when the app has more than one
  `EntityManagerFactory`.
- Embedded values, collections and composite-id references are not served.

## License

Apache-2.0, see [LICENSE](../../LICENSE).
