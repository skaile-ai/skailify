<!-- SPDX-License-Identifier: Apache-2.0 -->

# Getting started

This guide takes you, or the coding agent working for you, from a clean checkout of this repository to
a passing conformance run on a small dummy adapter, and then to checking an MCP server. Every command
in it is meant to be run as written. It takes about ten minutes.

Read [What works today](#what-works-today) before you plan an integration: it says which parts of
the platform an adapter can rely on now and which are still to come.

## How an app talks to Skaile

An app reaches a Skaile agent over two channels, and an adapter usually covers one of them:

| Channel | Adapter folder | What goes over it | Consent |
|---|---|---|---|
| **App channel** | [`frontend/`](../frontend/) | `app.*` capabilities the app registers from the browser: open a view, select a row, fill in a form, save it; plus what the app shows (`reportView`, `loading`, `settled`) | The platform shows an approval card for a capability declared with `requiresApproval: true`, supports standing grants, and audits the call |
| **MCP** | [`backend/`](../backend/) | Tools of an MCP server in the app's backend, for reads and queries | None. The platform does not put MCP tool calls through approval |

Both are defined by the app SDK, `@skaile/workspaces/app-sdk`, which ships inside the
[`@skaile/workspaces`](https://www.npmjs.com/package/@skaile/workspaces) npm package (there is no
separate app-sdk package). Its test kit is the `@skaile/workspaces/app-sdk/testing` entry point, and
the same package carries the `skailify-check-mcp` command for MCP servers.

The rule that follows from the table: **an action that changes data and needs the user's consent is
an `app.*` capability.** An MCP server is for reading. The conventions for MCP tools are in
[MCP conventions](mcp-conventions.md).

## What works today

- **Apps embedded in a Skaile preview.** An app runs in a session's preview, declared as an app with
  the app channel switched on (`"protocol": true` in the workspace's `skaile.preview.json`, where its
  `id` is the app's `appId`). It connects over the app channel and registers its `app.*`
  capabilities, and the agent can read what it shows.
- **Writes that need consent, as `app.*` capabilities.** A capability declared with
  `requiresApproval: true`, and optionally an `effectClass` (`routine`, `external`, `privileged` or
  `never`), runs only after the user approves it on a card; the user can grant it standing approval for
  the session (except for `never`, which asks every time), and every call is audited. This works today over the browser app channel, so the
  capability exists while the app is open in the session. The vue-tsm adapter (see the
  [root README](../README.md)) works this way: it fills in and saves an app's forms, and runs the
  app's view actions, as `app.*` capabilities, with approval on the actions that need it.
- **The app's own token through the preview.** The preview proxy drops the `Authorization` header and
  cookies of requests to the app. A client sends the app's own bearer token as
  `X-Skaile-Preview-Authorization: Bearer <token>` instead, and the app's backend reads that header
  when `Authorization` is absent. A real `Authorization` header always wins.
- **An MCP server for reads and queries.** Add the app's MCP server in Skaile by hand, like any other
  remote MCP server. Its tools describe themselves with Skaile action metadata in `_meta`
  ([MCP conventions](mcp-conventions.md)). `skailify-check-mcp` checks that metadata; **the
  platform does not enforce it**, and it applies no approval to MCP tool calls.

### Not yet

- **Hosting the app outside a preview.** An app served from its own origin cannot yet be embedded in a
  session; it has to run in a Skaile preview.
- **Importing the manifest.** The platform does not read `/.well-known/skailify.json` yet. Register the
  MCP server, and declare the app, by hand.
- **A server-side app connection.** Today an app's `app.*` capabilities come from the browser, so they
  exist only while the app is open. A planned server-side connection lets the app's backend provide
  them without an open browser tab. It adds a transport, not a new consent model: the same
  declarations, cards, grants and audit apply. Writes need not wait for it.
- **Single sign-on into the app.** A user is not yet signed in to the app with their Skaile identity.
  The app keeps its own login, and its backend calls carry the app's own token (see above).

## Prerequisites

- git
- [bun](https://bun.sh) 1.3 or later (`bun --version`)
- Node.js 22.5 or later, only if you run `skailify-check-mcp` through `npx` instead of `bunx`

## 1. Clone and install

```sh
git clone https://github.com/skaile-ai/skailify.git
cd skailify
bun install
```

The repository root is a bun workspace over `frontend/*` and `backend/*`, so every JavaScript adapter
is installed from here.

## 2. Create a dummy frontend adapter

The dummy, `frontend/hello/`, is the smallest adapter that passes the conformance checks: one
capability that changes the view and reports it, and one that returns who invoked it. You will turn it
into your own adapter in step 5, or delete it.

`frontend/hello/package.json`:

```json
{
  "name": "skailify-hello",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "Apache-2.0",
  "main": "./src/index.ts",
  "scripts": {
    "conformance": "bun test ./test/conformance"
  },
  "peerDependencies": {
    "@skaile/workspaces": "^10.10.1",
    "zod": "^4.4.0"
  },
  "devDependencies": {
    "@skaile/workspaces": "10.10.1",
    "zod": "^4.4.0"
  }
}
```

The app SDK is a peer dependency: the app that uses the adapter brings its own copy, so the adapter
and the app share one. The exact version in `devDependencies` is the one the adapter is tested
against. Keep `zod` at major 4: the SDK turns your schemas into JSON Schema with it.

`frontend/hello/src/index.ts`:

```ts
// SPDX-License-Identifier: Apache-2.0

import {
  type AppTransport,
  createSkaileApp,
  defineAppCapability,
  type ReconnectOptions,
  type SkaileApp,
} from "@skaile/workspaces/app-sdk";
import * as z from "zod";

export interface HelloAppOptions {
  transport: AppTransport;
  reconnect?: ReconnectOptions | false;
}

export function createHelloApp(options: HelloAppOptions): SkaileApp {
  const app = createSkaileApp({
    appId: "hello",
    transport: options.transport,
    reconnect: options.reconnect,
  });

  app.registerCapability(
    defineAppCapability({
      name: "app.hello.open",
      description: "Open a record in the hello view.",
      input: z.object({ id: z.string() }),
      kind: "effect",
      handler: async ({ id }) => {
        app.loading("opening record");
        app.reportView({ viewId: `record/${id}`, title: `Record ${id}` });
        app.settled();
        return { opened: id };
      },
    }),
  );

  app.registerCapability(
    defineAppCapability({
      name: "app.hello.whoami",
      description: "Report who set off the current turn.",
      input: z.object({}),
      kind: "query",
      handler: async (_args, ctx) => ({ principal: ctx.principal }),
    }),
  );

  return app;
}
```

`frontend/hello/test/conformance/conformance.test.ts`:

```ts
// SPDX-License-Identifier: Apache-2.0

import { describe, it } from "bun:test";
import { registerAppConformance } from "@skaile/workspaces/app-sdk/testing";
import { createHelloApp } from "../../src/index.ts";

registerAppConformance(
  { describe, it },
  {
    title: "hello adapter conformance",
    connect: async (gateway) => {
      const app = createHelloApp({
        transport: gateway.transport(),
        reconnect: { baseMs: 10, maxMs: 50 },
      });
      await app.connect();
      return app;
    },
    view: { name: "app.hello.open", input: { id: "r1" } },
    principal: { name: "app.hello.whoami" },
  },
);
```

`connect` starts the adapter on an in-memory fake of the platform's gateway (`gateway.transport()`
in place of the real WebSocket transport). The suite calls it once per check, each time with a fresh
gateway. Keep the reconnect backoff short: one check drops the socket and waits for the app to come
back.

## 3. Run the conformance checks

```sh
bun install
cd frontend/hello
bun run conformance
```

The second `bun install` adds the new adapter to the workspace. The run ends with:

```text
 7 pass
 0 fail
```

one test per check:

| Check | Passes when |
|---|---|
| `register` | The app connects and registers its capabilities, each with a description and an input schema, and the gateway refuses none |
| `contract-version` | The app announces a protocol version that carries view state |
| `effect-classes` | Every capability declares a valid effect class (a class above `routine` needs `requiresApproval: true`) |
| `invoke` | The `view` capability answers without an error |
| `principal` | The `principal` capability returns the principal it was sent |
| `view-settled` | Invoking `view` sends a view report, then `settled` |
| `reconnect` | After a dropped socket the app says hello again, re-registers every capability unchanged, replays its last view and answers again |

If a check fails, its message says what the gateway saw. `runAppConformance` (same entry point) runs
the same checks without a test runner and returns a report, and `createFakeGateway` gives you the
fake gateway for tests of your own (invoke a capability, wait for `settled`, drop the socket).

## 4. Check an MCP server

A backend adapter exposes the app's data as MCP tools. `skailify-check-mcp` connects to an MCP
server, lists its tools and checks the Skaile action metadata on each one, so it works for a server in
any language.

Against a running server over streamable HTTP:

```sh
bunx -p @skaile/workspaces@10.10.1 skailify-check-mcp http://localhost:8080/mcp
```

Through a Skaile preview, with the app's own token sent as `X-Skaile-Preview-Authorization`:

```sh
SKAILIFY_MCP_TOKEN=<token> bunx -p @skaile/workspaces@10.10.1 skailify-check-mcp --preview https://<preview-url>/mcp
```

Or against a server it starts itself over stdio (everything after `--stdio` is the command):

```sh
bunx -p @skaile/workspaces@10.10.1 skailify-check-mcp --stdio java -jar my-server.jar
```

To see it pass, give the dummy adapter a small stdio MCP server with one read tool. Add the MCP SDK
next to the app SDK:

```sh
bun add --dev @modelcontextprotocol/sdk@^1.27.1
```

`frontend/hello/test/mcp-server.ts`:

```ts
// SPDX-License-Identifier: Apache-2.0

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "hello", version: "0.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_record",
      description: "Read one record by id.",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: true },
      _meta: {
        "ai.skaile/action": { effect: "routine", risk: "low", idempotent: true, disclosure: "session-visible" },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{ type: "text", text: JSON.stringify({ id: request.params.arguments?.id }) }],
}));

await server.connect(new StdioServerTransport());
```

From `frontend/hello`:

```sh
bunx -p @skaile/workspaces@10.10.1 skailify-check-mcp --strict --stdio bun test/mcp-server.ts
```

It exits 0 and prints:

```text
hello 0.0.0: 1 tool(s), 0 error(s), 0 warning(s)
```

Remove `readOnlyHint` or the `_meta` entry and run it again to see the findings: a tool without
`readOnlyHint: true` is a write tool and gets a `write-tool-ungoverned` warning (which `--strict`
turns into exit 1), and a tool without metadata gets a `missing-action-meta` error. `--json` prints the full report. The rules and how to fill in the
metadata are in [MCP conventions](mcp-conventions.md).

## 5. Turn the dummy into your adapter

1. Rename the folder to `frontend/<name>/` and the package to match, and replace the two dummy
   capabilities with what your app does. Name capabilities `app.<sector>.<verb>`; the agent sees each
   one as `app.<appId>.<sector>.<verb>`. (A backend adapter is an MCP server in `backend/<name>/`,
   built with its own toolchain; step 4 and [MCP conventions](mcp-conventions.md) cover it.)
2. Mark every capability that changes data with `requiresApproval: true`, and give it the
   `effectClass` that fits: `external` when it reaches outside the app (sends mail, posts elsewhere),
   `privileged` for administrative actions, `never` for actions the user must approve every time.
   Name the expected classes in the conformance options (`effectClasses`), so a changed class fails a
   test.
3. Call `reportView` whenever the visible view changes, and `settled()` after every navigation and
   every handled invocation that changes the view, once it has rendered. The agent waits for
   `settled` before it reads the screen.
4. In a real app, connect through the host's handshake and the WebSocket transport instead of the
   fake gateway. The host hands the app its gateway URL and a token over `postMessage`
   (`resolveAppConnectionParams`). Each token works once, so pass the transport a function that asks
   for a fresh one, not the token itself:

   ```ts
   import { createWebSocketAppTransport, resolveAppConnectionParams } from "@skaile/workspaces/app-sdk";

   const appId = "hello"; // the app's id in skaile.preview.json
   const params = await resolveAppConnectionParams({ appId });
   let first: string | null = params.token;
   const app = createHelloApp({
     transport: createWebSocketAppTransport({
       url: params.url,
       sessionToken: () => {
         if (first) {
           const token = first;
           first = null;
           return token;
         }
         return resolveAppConnectionParams({ appId }).then((p) => p.token);
       },
     }),
   });
   await app.connect();
   ```

   The options are documented in the package's type declarations under
   `node_modules/@skaile/workspaces/dist/app-sdk/src/` (`connection-params.d.ts`, `ws-transport.d.ts`,
   `app.d.ts`).
5. Write the adapter's `AGENTS.md` from the [template](AGENTS.template.md), and its `README.md`.
6. Add the adapter to CI with the reusable adapter workflow ([CI template](ci-template.md)); it runs
   your tests and the conformance checks against every app SDK version your peer range allows.
7. Follow [CONTRIBUTING.md](../CONTRIBUTING.md): an SPDX header on every new file, `git commit -s` on
   every commit, and a row in the [root README](../README.md)'s adapter table.

If you only tried the dummy, delete it: `rm -rf frontend/hello` and `bun install`.

## Where to go next

- [MCP conventions](mcp-conventions.md): what an MCP tool declares, and what the manifest is for.
- [AGENTS.md template](AGENTS.template.md): the integration guide each adapter ships for coding agents.
- [CI template](ci-template.md): the reusable workflow for an adapter's CI.
