# @skaile/skailify-react

## 0.2.0

### Minor Changes

- [#15](https://github.com/skaile-ai/skailify-adapters/pull/15) [`0c660d2`](https://github.com/skaile-ai/skailify-adapters/commit/0c660d246e6d1730be6bfd7259b9525f74706250) Thanks [@peteralbert](https://github.com/peteralbert)! - An `assistant` option tells Skaile where to put its agent button over the app (`{ kind: "floating", corner, offset, size, accent }`), or to leave it out (`{ kind: "none" }`). `setAssistant(...)` changes it while the app runs. The peer `@skaile/workspaces` range now starts at 10.14.0, the first version that sends these hints.

## 0.1.1

### Patch Changes

- [#13](https://github.com/skaile-ai/skailify-adapters/pull/13) [`087a5a6`](https://github.com/skaile-ai/skailify-adapters/commit/087a5a60ba39c6bb7d6b9071ef9d698b2ffdbde1) Thanks [@peteralbert](https://github.com/peteralbert)! - Connect, and answer `get_view_state` in full, even when a view's state or a `useAgentState` value is not JSON-serialisable (a `BigInt`, a cycle). Such a value is replaced by `{ error: "state is not JSON-serialisable" }`, and the error is logged once per view. Before, the client ended in `error` on connect.
