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

| Adapter | Folder | Status | What it does |
|---|---|---|---|
| angular | `frontend/angular/` | Available | Angular 20 to 22 apps, zoneless or zone.js: views, state and actions declared with `inject*` functions; NgRx Store actions and selectors, NgRx SignalStore methods and state; Angular Router navigation |
| react | `frontend/react/` | Available | React 18/19 apps, router-agnostic: views, exposed state and actions declared with hooks, over the Skaile app channel |
| vue-tsm | `frontend/vue-tsm/` | Available | Vue 3 apps on the tsm module runtime: views, lists, UIModel forms and view actions over the Skaile app channel |
| emf-mcp | `backend/emf-mcp/` | Preliminary | EMF/OSGi backends: generic model tools over MCP, an OAuth resource server for per-user MCP access, and the `/.well-known/skailify.json` manifest |

"Preliminary" means the adapter works but its interface may still change.

## Building

The JavaScript adapters share one [bun](https://bun.sh) workspace rooted here:

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
