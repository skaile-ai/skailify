<!-- SPDX-License-Identifier: Apache-2.0 -->

# MCP conventions

How a backend adapter's MCP server describes its tools to Skaile, and what the
`/.well-known/skailify.json` manifest is for. `skailify-check-mcp` from
[`@skaile/workspaces`](https://www.npmjs.com/package/@skaile/workspaces) checks the rules marked
**checked** below; [Getting started](getting-started.md#4-check-an-mcp-server) shows how to run it.

## MCP is for reads and queries

An app's MCP server gives the agent the app's data: describe the model, query it, read records. The
platform does **not** put MCP tool calls through approval: an agent holding a token calls the tool
directly, as the user the token belongs to. The action metadata below is checked by
`skailify-check-mcp`, not enforced by the platform.

So:

- **Writes that need the user's consent are `app.*` capabilities**, registered over the app channel
  with `requiresApproval: true` (see [Getting started](getting-started.md#how-an-app-talks-to-skaile)).
  That works today from the app's browser UI. A planned server-side connection will let the app's
  backend provide the same capabilities without an open browser tab, with the same approval, grants
  and audit; it is a second transport, not a reason to put writes on MCP meanwhile.
- **Write tools on an MCP server are off by default** in an adapter, and turned on only by an explicit
  opt-in in the app's configuration, for tests or trusted automation. A server that serves them is
  responsible for them: nothing on the platform side asks the user first.
- Mark every read tool `readOnlyHint: true`. A tool without it counts as a write tool.

## Action metadata: `_meta["ai.skaile/action"]`

Every tool carries its Skaile action metadata under one `_meta` key, `ai.skaile/action`. The key
follows the MCP specification's naming rule for `_meta` keys (revision 2025-11-25: a reverse-DNS
prefix, a slash, the name). This is the only place per-tool metadata lives: not in the tool's name or
description, not in the manifest.

| Field | Values | Required | Meaning |
|---|---|---|---|
| `effect` | `routine`, `external`, `privileged` | yes | The consent class. `routine`: ordinary work inside the app, and every read. `external`: reaches outside the app (sends mail, posts to another system). `privileged`: administrative, such as changing who may do what |
| `risk` | `low`, `medium`, `high` | yes | How much harm a wrong call can do |
| `idempotent` | `true`, `false` | yes | Whether calling it twice with the same input has the effect of calling it once. A read is always `true` |
| `minTier` | `Viewer`, `User`, `Owner` | no | The role the tool's own access check needs |
| `disclosure` | `session-visible`, `owner-private` | no; set it on every read | `session-visible` only when the result holds nothing that any reader of the session may not see, since it lands in the conversation everyone in the session reads; otherwise `owner-private` |

These are the fields the platform uses for its own agent actions, so a tool reads the same way as a
platform action. The object is strict: an unknown key (a typo such as `minTeir`) is an error.

Rules **checked** by `skailify-check-mcp`:

| Rule | Severity | When |
|---|---|---|
| `missing-action-meta` | error | The tool has no `_meta["ai.skaile/action"]` |
| `invalid-action-meta` | error | The value does not match the table above |
| `read-only-not-routine` | error | `readOnlyHint: true` with an `effect` other than `routine` |
| `destructive-routine` | error | `destructiveHint: true` with `effect: "routine"` |
| `write-tool-ungoverned` | warning | The tool lacks `readOnlyHint: true`. It fires even with valid metadata, so `--strict` fails any server that serves a write tool |
| `missing-description` | warning | The tool has no description |

The command exits 1 on an error (with `--strict`, on a warning too) or when it cannot reach the
server, and 2 on a usage error. Run it with `--strict` in CI against the endpoint you give agents.

## Examples

A read tool:

```json
{
  "name": "query_orders",
  "description": "Find orders by customer, status or date range. Returns at most 50 rows.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "customer": { "type": "string" },
      "status": { "type": "string", "enum": ["open", "shipped", "cancelled"] }
    }
  },
  "annotations": { "readOnlyHint": true },
  "_meta": {
    "ai.skaile/action": { "effect": "routine", "risk": "low", "idempotent": true, "disclosure": "session-visible" }
  }
}
```

A read tool whose results only the session's owner should see:

```json
{
  "name": "get_salary",
  "description": "Read an employee's salary record.",
  "inputSchema": { "type": "object", "properties": { "employeeId": { "type": "string" } }, "required": ["employeeId"] },
  "annotations": { "readOnlyHint": true },
  "_meta": {
    "ai.skaile/action": {
      "effect": "routine",
      "risk": "medium",
      "idempotent": true,
      "minTier": "Owner",
      "disclosure": "owner-private"
    }
  }
}
```

A write tool, on a server that has opted in to write tools. It is described honestly, and
`skailify-check-mcp` still warns that it is not governed:

```json
{
  "name": "delete_order",
  "description": "Delete an order and its lines.",
  "inputSchema": { "type": "object", "properties": { "orderId": { "type": "string" } }, "required": ["orderId"] },
  "annotations": { "destructiveHint": true },
  "_meta": {
    "ai.skaile/action": { "effect": "privileged", "risk": "high", "idempotent": true, "minTier": "Owner" }
  }
}
```

The same delete, as the user should get it: an `app.*` capability that the platform asks the user to
approve.

```ts
defineAppCapability({
  name: "app.orders.delete",
  description: "Delete an order and its lines.",
  input: z.object({ orderId: z.string() }),
  kind: "effect",
  requiresApproval: true,
  effectClass: "privileged",
  handler: async ({ orderId }, ctx) => deleteOrder(orderId, ctx.principal),
});
```

Errors the checker reports for common mistakes:

```json
{ "annotations": { "readOnlyHint": true }, "_meta": { "ai.skaile/action": { "effect": "external", "risk": "low", "idempotent": true } } }
```

`read-only-not-routine`: a tool that only reads cannot reach outside the app.

```json
{ "annotations": { "destructiveHint": true }, "_meta": { "ai.skaile/action": { "effect": "routine", "risk": "low", "idempotent": false } } }
```

`destructive-routine`: a destructive tool is never routine.

## Authentication

- Each user reaches the server with their own token. A server that is an OAuth resource server
  answers a request without a token with `401` and a `WWW-Authenticate: Bearer` challenge that points
  at its protected-resource metadata (RFC 9728), so an MCP client can find where to get a token.
- **Behind a Skaile preview** the proxy drops `Authorization` and cookies. Accept the bearer token in
  `X-Skaile-Preview-Authorization: Bearer <token>` when `Authorization` is absent; when both are
  present, `Authorization` wins. `skailify-check-mcp --preview` sends the token that way.
- The verified caller is who the tool acts for. Authorization against the app's own data stays the
  app's job; the metadata above does not grant or deny anything.

## The manifest: `/.well-known/skailify.json`

The manifest is for **discovery only**. It tells the platform who the app is and where to find it:

| Field | Meaning |
|---|---|
| `skailify` | The manifest format version |
| `app.id`, `app.name`, `app.description` | The app's id (its `appId` on the app channel), its display name and a short description |
| `app.url`, `app.embedUrl` | The app's base URL and the page Skaile embeds |
| `mcp.url`, `mcp.transport` | The MCP endpoint to give agents (the read endpoint) and its transport (`streamable-http`) |
| `auth.type`, `auth.issuers`, `auth.scopes`, `auth.protectedResourceMetadata` | Where tokens for the MCP endpoint come from |

```json
{
  "skailify": "0.1-draft",
  "app": {
    "id": "orders",
    "name": "Orders",
    "url": "https://orders.example.org/",
    "embedUrl": "https://orders.example.org/app/"
  },
  "mcp": { "url": "https://orders.example.org/mcp-read", "transport": "streamable-http" },
  "auth": {
    "type": "oauth2",
    "issuers": ["https://id.example.org/realms/orders"],
    "scopes": ["orders:read"],
    "protectedResourceMetadata": "https://orders.example.org/.well-known/oauth-protected-resource/mcp-read"
  }
}
```

What the platform will do with it, once it imports manifests: feed its existing intake for external
MCP servers (the same review and allow-list every external MCP server goes through) and the
registration of the app. It is not a second intake path, and an adapter builds no intake,
registration or consent of its own around it.

What does **not** go in it: per-tool action metadata (that is `_meta`, above), grants, approval
settings or effect classes. The platform reads those from the tool itself and from the app's `app.*`
declarations.

The format is a draft, and the platform does not import the manifest yet: register the MCP server by
hand for now. Serve it anyway if your adapter can, so the app is ready when import arrives.
