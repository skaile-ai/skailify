<!-- SPDX-License-Identifier: Apache-2.0 -->

<!--
  Template for an adapter's AGENTS.md: the file a coding agent follows, top to bottom, to integrate
  the adapter into an app. Copy it to frontend/<name>/AGENTS.md or backend/<name>/AGENTS.md, replace
  every <placeholder>, delete the sections marked "frontend only" or "backend only" that do not
  apply, and delete this comment. Keep the SPDX line above (EPL-2.0 under backend/emf-mcp/).

  Write for an agent that has never seen Skaile: say exactly what to run and what it should print.
  Name no customer, person or internal ticket. Link to docs/getting-started.md and
  docs/mcp-conventions.md for the shared rules instead of repeating them.
-->

# AGENTS.md: integrate `<package or bundle name>` into a `<framework or runtime>` app

You are a coding agent. Follow this file from top to bottom to make an existing `<framework>` app
<agent-controllable inside a Skaile session | reachable for Skaile agents over MCP>. Do every step,
run every check, and report what you could not verify.

## What it does

<Two or three sentences: which channel the adapter covers (the app channel for a frontend adapter,
MCP for a backend adapter) and what the agent can do with the app once it is in place.>

<frontend only> The adapter registers these capabilities (declared as `app.<sector>.<verb>`; the
agent sees each one as `app.<appId>.<sector>.<verb>`):

| Name | Kind | Approval | What it does |
|---|---|---|---|
| `app.<sector>.<verb>` | query / effect | none / required (`<effectClass>`) | <one line> |

<backend only> The adapter serves these MCP tools:

| Tool | `readOnlyHint` | `_meta["ai.skaile/action"]` | What it does |
|---|---|---|---|
| `<tool>` | true | `effect: routine, risk: low, idempotent: true` | <one line> |

## What works today, and what does not

Read "What works today" in [Getting started](<path to>/docs/getting-started.md) first. For this
adapter:

- <Where the app has to run for the adapter to connect, for example: only when the app is embedded in
  a Skaile preview as an app with `"protocol": true`. Opened on its own, it does nothing.>
- **Writes and consent.** <frontend: which capabilities change data, and that each is declared with
  `requiresApproval: true`. backend: that MCP tools are for reads, write tools are off by default,
  and writes that need the user's consent go through `app.*` capabilities of a frontend adapter,
  because the platform applies no approval to MCP calls.>
- <Anything the adapter depends on that the platform does not offer yet.>

## Prerequisites

- <Runtime and version: Node.js / bun / JDK 17 or later>
- `@skaile/workspaces` `<peer range>` (the app SDK, `@skaile/workspaces/app-sdk`) <frontend only>
- <Framework and library versions, as peer dependencies of the app>
- <What the app must already have, for example a router, an identity provider, an OAuth issuer>

## Step 1: install

<How to add the adapter to the app. Say where it must be installed once (a shared library, a single
registry) and what breaks when there are two copies.>

```sh
<command>
```

## Step 2: connect

<Where and when to start the adapter, with a complete code or configuration example. Name every
option that has no safe default.>

```<language>
<example>
```

## Step 3: <expose what the app shows | expose the app's data>

<frontend: how a view registers its lists, forms and actions, when it reports the view and when it
calls settled(). backend: how to choose which types and fields the tools expose, and how to hide
secrets.>

## Step 4: actions that change data

<frontend: how to declare an action, with `requiresApproval: true` and an `effectClass` on every action
that changes data, where to register it so it is offered only on the view that has it, and how to read
`ctx.principal` (refuse `mixed` and `unknown` when the action acts for one person).
backend: the opt-in for write tools, why it is off, and the WARN the server logs when it is on.>

## Step 5: authentication <backend only>

<How the server checks tokens, the 401 challenge, and that it accepts the app's token in
`X-Skaile-Preview-Authorization` when `Authorization` is absent. See
[MCP conventions](<path to>/docs/mcp-conventions.md#authentication).>

## Step 6: verify

Run each of these and report exactly which you ran and what happened.

1. The adapter's own build and tests: `<command>`.
2. <frontend> The app SDK's conformance checks: `bun run conformance` in the adapter folder (7 pass).
   <backend> The metadata check against the endpoint you give agents:
   `bunx -p @skaile/workspaces@<version> skailify-check-mcp --strict <url>` (exit 0).
3. The app's own type-check and build pass, and the app works as before when the adapter is not
   connected.
4. In a Skaile session: <what to try end to end, and what the agent should see>.

## Known limits

- <What the adapter does not do, what may change, and any platform feature it waits for, described in
  words (no ticket numbers).>
