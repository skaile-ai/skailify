<!-- SPDX-License-Identifier: Apache-2.0 -->

# skailify-adapters

Skailify makes an existing app agent-controllable in [Skaile](https://skaile.ai): an AI agent working in a
Skaile session can read what the app shows and act in it (open views, fill in forms, call the app's
backend) through the same contract the app's own users work with, and with the user's consent for
anything that changes data.

This repository holds the adapters that connect an app to Skaile. Each adapter lives in a folder of its
own, with its own build and tests and an `AGENTS.md` that a coding agent can follow end to end to
integrate it into an app.

- [`frontend/`](frontend/) holds adapters for UI frameworks: they expose an app's views, lists and forms
  over the Skaile app channel.
- [`backend/`](backend/) holds adapters for server runtimes: they expose an app's data and operations as
  tools over MCP.

The contract between an app and the platform is the app SDK, `@skaile/workspaces/app-sdk`, published in
the [`@skaile/workspaces`](https://www.npmjs.com/package/@skaile/workspaces) package.

## Adapters

| Adapter | Folder | Package | Status | What it does |
|---|---|---|---|---|
| angular | `frontend/angular/` | [`@skaile/skailify-angular`](https://www.npmjs.com/package/@skaile/skailify-angular) | Available | Angular 20 to 22 apps, zoneless or zone.js: views, state and actions declared with `inject*` functions; NgRx Store actions and selectors, NgRx SignalStore methods and state; Angular Router navigation |
| core | `frontend/core/` | [`@skaile/skailify-core`](https://www.npmjs.com/package/@skaile/skailify-core) | Available | Apps without a UI framework: the client the React and Angular adapters wrap, as plain function calls, and a `<script>`-tag bundle (`Skailify` global) for pages without a bundler |
| react | `frontend/react/` | [`@skaile/skailify-react`](https://www.npmjs.com/package/@skaile/skailify-react) | Available | React 18/19 apps, router-agnostic: views, exposed state and actions declared with hooks, over the Skaile app channel |
| vue-tsm | `frontend/vue-tsm/` | [`@skaile/skailify-vue-tsm`](https://www.npmjs.com/package/@skaile/skailify-vue-tsm) | Available | Vue 3 apps on the tsm module runtime: views, lists, UIModel forms and view actions over the Skaile app channel |
| emf-mcp | `backend/emf-mcp/` | Built from source | Preliminary | EMF/OSGi backends: generic model tools over MCP, an OAuth resource server for per-user MCP access, and the `/.well-known/skailify.json` manifest |
| jpa-mcp | `backend/jpa-mcp/` | Built from source | Preliminary | Spring Boot apps with JPA: chosen entities as read-only MCP tools (describe, list, get, query) with Skaile action metadata from annotations |

"Preliminary" means the adapter works but its interface may still change.

## Building

The JavaScript adapters (`frontend/*`, and any JavaScript adapter under `backend/*`) share one
[bun](https://bun.sh) workspace rooted here, and are published to npm under `@skaile/`; see
[docs/releasing.md](docs/releasing.md):

```sh
bun install
```

Java adapters build with their own committed wrapper (`./mvnw` or `./gradlew`), so they need only a
JDK 17 or later. Each adapter's README has its own build and test commands.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions need a DCO sign-off on every commit. Please follow
the [code of conduct](CODE_OF_CONDUCT.md), and report security problems as described in
[SECURITY.md](SECURITY.md).

## License

Apache-2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE), with one exception: `backend/emf-mcp/` is
EPL-2.0 and carries its own `LICENSE` file.
