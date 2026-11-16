<!-- SPDX-License-Identifier: Apache-2.0 -->

# The adapter CI template

[`.github/workflows/adapter.yml`](../.github/workflows/adapter.yml) is a reusable GitHub Actions
workflow that builds, tests and checks one adapter folder against every app-sdk version the adapter
supports. This repository runs it for its own adapters; you can call it from your repository or copy
it there.

## What it runs

The app SDK ships inside the [`@skaile/workspaces`](https://www.npmjs.com/package/@skaile/workspaces)
package, so "app-sdk version" means a version of that package.

1. **Versions.** It reads the adapter's supported range, `peerDependencies["@skaile/workspaces"]` in
   its `package.json` (or the `app-sdk-range` input), and picks two versions from npm: the lowest
   published version in the range, and the `latest` tag. When they are the same, it tests one. A
   range that starts before 10.4.0, the first version with the conformance kit, fails with a message
   to raise the floor: the workflow cannot check versions it has no checks for.
2. **One job per version**, each with the version installed exactly:
   - `kind: js`: `bun install`, `bun add --dev --exact @skaile/workspaces@<version>`, then
     `bun run test` and `bun run conformance` in the adapter folder.
   - `kind: java`: a JDK (17 by default), the folder's own wrapper (`./gradlew build` or
     `./mvnw -B verify`), then it starts the server, waits for its MCP endpoint and runs
     `skailify-check-mcp <mcp-url>` from that `@skaile/workspaces` version.

The workflow asks for `contents: read` only, uses no secrets, and pins every action to a full
commit SHA.

## What your adapter needs

A JavaScript adapter:

- `peerDependencies["@skaile/workspaces"]`, starting at 10.4.0 or later (for example `^10.4.0`);
- a `test` script for its own tests;
- a `conformance` script that runs the app SDK's conformance checks. With `bun:test`:

  ```ts
  // test/conformance/conformance.test.ts
  import { describe, it } from "bun:test";
  import { registerAppConformance } from "@skaile/workspaces/app-sdk/testing";

  registerAppConformance(
    { describe, it },
    {
      connect: async (gateway) => {
        const app = createYourApp({ transport: gateway.transport(), reconnect: { baseMs: 10, maxMs: 50 } });
        await app.connect();
        return app;
      },
      view: { name: "app.yours.open", input: { id: "r1" } },
      principal: { name: "app.yours.whoami" },
    },
  );
  ```

  and `"conformance": "bun test ./test/conformance"` in `package.json`. `runAppConformance` is the
  same checks without a test runner, if you would rather assert on its report yourself.
  [`frontend/_example`](../frontend/_example/) is a complete, minimal adapter that passes.

A Java adapter:

- its build wrapper committed in its folder (`gradlew` or `mvnw`, executable);
- a command that starts its MCP server in the foreground, and the server's streamable HTTP MCP URL;
- every tool carrying valid Skaile action metadata at `_meta["ai.skaile/action"]`, which is what
  `skailify-check-mcp` checks.

## Calling it

From this repository, add a job to [`.github/workflows/ci.yml`](../.github/workflows/ci.yml):

```yaml
  vue-tsm:
    uses: ./.github/workflows/adapter.yml
    with:
      path: frontend/vue-tsm
      kind: js
```

```yaml
  my-java-adapter:
    uses: ./.github/workflows/adapter.yml
    with:
      path: backend/my-java-adapter
      kind: java
      app-sdk-range: ^10.4.0
      java-start-command: ./gradlew run --no-daemon
      mcp-url: http://localhost:8080/mcp
```

| Input | For | Default | Meaning |
|---|---|---|---|
| `path` | both | required | adapter folder, relative to the repository root |
| `kind` | both | required | `js` or `java` |
| `app-sdk-range` | both | the `package.json` peer range | supported `@skaile/workspaces` range; required for `java` |
| `bun-version` | js | `1.3.12` | Bun version |
| `java-version` | java | `17` | JDK version |
| `java-build-command` | java | the wrapper's build | build and test command, run in the adapter folder |
| `java-start-command` | java | required | starts the MCP server in the foreground, run in the adapter folder |
| `mcp-url` | java | required | the started server's MCP endpoint |
| `mcp-ready-timeout` | java | `120` | seconds to wait for the endpoint to answer |

## Using it in your own repository

Either call it here, pinned to a commit of this repository (a public repository's reusable workflow
can be called from any repository):

```yaml
permissions:
  contents: read

jobs:
  adapter:
    uses: skaile-ai/skailify-adapters/.github/workflows/adapter.yml@<full commit sha>
    with:
      path: .
      kind: js
```

or copy `adapter.yml` into your repository's `.github/workflows/` and call it as
`./.github/workflows/adapter.yml`. It is one self-contained file: it needs no other script from this
repository. When you copy it, keep the action SHAs pinned and update them deliberately (for example
with Dependabot's `github-actions` updates).

The repository checks in [`ci.yml`](../.github/workflows/ci.yml), the DCO sign-off and the SPDX
headers (scripts in [`.github/scripts/`](../.github/scripts/)), are this repository's contribution
rules; copy them only if your repository has the same rules.
