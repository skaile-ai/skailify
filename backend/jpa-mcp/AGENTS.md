<!-- SPDX-License-Identifier: Apache-2.0 -->

# AGENTS.md: integrate `skailify-jpa-mcp-spring-boot-starter` into a Spring Boot JPA app

> **Status: preliminary.** Read-only in this version; names may still change.

You are a coding agent. Follow this file from top to bottom to make an existing Spring Boot app
with JPA entities reachable for Skaile agents over MCP. Do every step, run every check, and report
what you could not verify.

## What it does

The starter serves the JPA entities you mark as read-only MCP tools on a streamable HTTP endpoint
(`/mcp` by default). An agent can describe the data model, list records, read one by id and query
by attribute filters. Every tool carries its Skaile action metadata at `_meta["ai.skaile/action"]`.

| Tool | `readOnlyHint` | `_meta["ai.skaile/action"]` | What it does |
|---|---|---|---|
| `describe_model` | true | `effect: routine, risk: low, idempotent: true, disclosure: session-visible` | The exposed record types, their attributes and filters |
| `list_<name>` | true | from the entity's `@SkaileAction` (default `routine, low, true, owner-private`) | A page of records |
| `get_<name>` | true | as `list_<name>` | One record by id |
| `query_<name>` | true | as `list_<name>` | A page of records matching attribute filters |

Details of what a record shows and how queries work: [README.md](README.md).

## What works today, and what does not

Read "What works today" in [Getting started](../../docs/getting-started.md) first. For this
adapter:

- The endpoint runs inside the app's own server, so the app's backend must be reachable from where
  the agent runs. Register the MCP server with Skaile by hand; there is no manifest import yet.
- **Writes and consent.** This version serves no write tools at all. The platform applies no
  approval to MCP calls, so writes that need the user's consent go through `app.*` capabilities of
  a frontend adapter (see [`frontend/`](../../frontend/)), not through MCP.
- Data-level authorization stays the app's job: the metadata grants and denies nothing. Use the
  app's security for who may call the endpoint and a `SkailifyReadFilter` for which rows they see.

## Prerequisites

- JDK 17 or later.
- Spring Boot 4.1 with `spring-boot-starter-data-jpa` and `spring-boot-starter-webmvc` (a servlet web
  server), and one `EntityManagerFactory`.
- Spring Security in the app, unless this is local development only (Step 5).

## Step 1: install

The starter is not in a Maven repository yet. Build it into the local repository from this folder:

```sh
./mvnw -B install -pl starter -am
```

It prints `BUILD SUCCESS`. Then add it to the app (Maven shown; Gradle takes the same coordinates):

```xml
<dependency>
  <groupId>ai.skaile.skailify</groupId>
  <artifactId>skailify-jpa-mcp-spring-boot-starter</artifactId>
  <version>0.1.0-SNAPSHOT</version>
</dependency>
```

Add it once, to the module that has the Spring Boot application. It brings the MCP Java SDK 2.2
(Jackson 3) with it; if the app pins another MCP SDK version, align it.

## Step 2: connect

There is no code to write: the starter's auto-configuration registers the endpoint when the app has
a servlet web server and one `EntityManagerFactory`. Optional settings go in
`application.properties`:

```properties
skailify.mcp.path=/mcp
skailify.mcp.server-name=orders-app
skailify.mcp.max-limit=200
```

All properties are listed in [README.md](README.md#configuration). Start the app; the log shows
`Skailify MCP: serving <n> read-only tools for <m> entities at /mcp`.

## Step 3: expose the app's data

Choose the entities an agent may read, and nothing else. On each, add `@SkailifyEntity` and, unless
the defaults fit, `@SkaileAction`:

```java
@Entity
@SkailifyEntity(name = "order", description = "A customer's order: status, total and the day it was placed.")
@SkaileAction(risk = Risk.MEDIUM, minTier = MinTier.USER, disclosure = Disclosure.OWNER_PRIVATE)
public class PurchaseOrder {
    @Id private Long id;
    @ManyToOne private Customer customer;   // served as {"entity": "customer", "id": …} if Customer is exposed
    private Status status;
    @SkailifyHidden private String internalNote;   // never shown, filtered or sorted on
}
```

- `name`: lower snake case, at most 40 characters; it goes into the tool names. Two entities with
  the same name stop the app at startup.
- `description`: one sentence the agent reads in each tool's description.
- `@SkaileAction`: keep `effect = ROUTINE` and `idempotent = true` (the defaults); anything else
  stops the app at startup, because every tool here is a read. Set `risk` to how much harm a wrong
  read could do, `minTier` to the role the app's own access check needs, and `disclosure` to
  `SESSION_VISIBLE` only when the records hold nothing that any reader of the session may not see
  (the default is `OWNER_PRIVATE`). See [MCP conventions](../../docs/mcp-conventions.md#action-metadata-_metaaiskaileaction).
- Mark every secret or personal attribute that the agent does not need `@SkailifyHidden` (password
  hashes, tokens, internal notes). Put it on the field, or on the getter for property access.
- A reference to an entity that is not exposed is left out, so exposing one entity never reveals
  another.

The startup log lists, per entity, the attributes it left out and why.

## Step 4: actions that change data

There are none in this version, and there is no opt-in for write tools. Put writes through `app.*`
capabilities of a frontend adapter with `requiresApproval: true`.

## Step 5: authentication

Protect the endpoint with the app's Spring Security, for example as an OAuth2 resource server
(`spring-boot-starter-oauth2-resource-server`) that requires a valid bearer token on the
`skailify.mcp.path` path and answers `401` with a `WWW-Authenticate: Bearer` challenge (see
[MCP conventions](../../docs/mcp-conventions.md#authentication)).

- The starter refuses to start when the app has no Spring Security filter chain. Only for local
  development, set `skailify.mcp.allow-unauthenticated=true`; it logs a warning, and you should
  also bind the server to loopback (`server.address=127.0.0.1`).
- Behind a Skaile preview, the token arrives in `X-Skaile-Preview-Authorization`. The starter
  presents it as `Authorization` to the app's filters when `Authorization` is absent; when both are
  present, `Authorization` wins. Turn it off with `skailify.mcp.preview-authorization=false`.
- To restrict rows per caller, add a `SkailifyReadFilter` bean. Tool calls run on the request's
  thread, so it can read the caller from `SecurityContextHolder`:

  ```java
  @Bean
  SkailifyReadFilter tenantOnly() {
      return (entityClass, root, cb) -> {
          if (!TenantOwned.class.isAssignableFrom(entityClass)) return null;
          return cb.equal(root.get("tenantId"), currentTenant());
      };
  }
  ```

## Step 6: verify

Run each of these and report exactly which you ran and what happened.

1. The adapter's own build and tests, in this folder: `./mvnw -B verify` (`BUILD SUCCESS`).
2. The metadata check against the endpoint you give agents, with the app running (add
   `--token <token>` when it requires one):
   `npx --package @skaile/workspaces@latest -- skailify-check-mcp --strict http://<host>:<port>/mcp`
   (exit 0, `0 error(s), 0 warning(s)`).
3. The app's own build and tests pass, and its own endpoints behave as before.
4. A call without a token gets `401` (skip only with `allow-unauthenticated` for local development).
5. In a Skaile session with the MCP server registered: ask the agent to describe the model, then to
   find a record you know by one of its attributes; it should use `describe_model` and then
   `query_<name>`, and no hidden attribute should appear.

## Known limits

- Read-only; no write tools.
- No `/.well-known/skailify.json` manifest; register the server by hand.
- One persistence unit only.
- Embedded values, collections, and references to entities with a composite id are not served.
