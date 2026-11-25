# @skaile/skailify-react

## 0.3.0

### Minor Changes

- [#24](https://github.com/skaile-ai/skailify/pull/24) [`0b4d26d`](https://github.com/skaile-ai/skailify/commit/0b4d26d2ce2de938de28e6c384fbe75d27cb0e05) Thanks [@peteralbert](https://github.com/peteralbert)! - Apps can hand work to the agent and read the signed-in user. The core client gets `requestAgentTurn({ text, context })`, which starts an agent turn as the signed-in user's message and rejects with an `AppTurnRefusedError` naming the reason, and `user` (also in the snapshot) with `onUserChange`. React adds `useRequestAgentTurn()` and `useSkailifyUser()`, Angular `injectRequestAgentTurn()` and `injectSkailifyUser()` (a signal), and vue-tsm `requestAgentTurn()`, `useSkailifyUser()` (a computed ref) and the same on its handle. The peer `@skaile/workspaces` range moves to ^10.17.0, the first version with these.

### Patch Changes

- Updated dependencies [[`0b4d26d`](https://github.com/skaile-ai/skailify/commit/0b4d26d2ce2de938de28e6c384fbe75d27cb0e05)]:
  - @skaile/skailify-core@0.2.0

## 0.2.1

### Patch Changes

- [#21](https://github.com/skaile-ai/skailify/pull/21) [`470ec91`](https://github.com/skaile-ai/skailify/commit/470ec9144dca6d0977fdfdf6c9c6219b08e0a763) Thanks [@peteralbert](https://github.com/peteralbert)! - The Skailify client now lives in `@skaile/skailify-core`, a framework-free package. The React and Angular adapters depend on it and re-export the same API as before (`SkailifyOptions` gains the optional `rendered` and `zone` hooks the Angular adapter already had); vue-tsm bundles the parts it shares, so an import map needs no new entry.

## 0.2.0

### Minor Changes

- [#15](https://github.com/skaile-ai/skailify-adapters/pull/15) [`0c660d2`](https://github.com/skaile-ai/skailify-adapters/commit/0c660d246e6d1730be6bfd7259b9525f74706250) Thanks [@peteralbert](https://github.com/peteralbert)! - An `assistant` option tells Skaile where to put its agent button over the app (`{ kind: "floating", corner, offset, size, accent }`), or to leave it out (`{ kind: "none" }`). `setAssistant(...)` changes it while the app runs. The peer `@skaile/workspaces` range now starts at 10.14.0, the first version that sends these hints.

## 0.1.1

### Patch Changes

- [#13](https://github.com/skaile-ai/skailify-adapters/pull/13) [`087a5a6`](https://github.com/skaile-ai/skailify-adapters/commit/087a5a60ba39c6bb7d6b9071ef9d698b2ffdbde1) Thanks [@peteralbert](https://github.com/peteralbert)! - Connect, and answer `get_view_state` in full, even when a view's state or a `useAgentState` value is not JSON-serialisable (a `BigInt`, a cycle). Such a value is replaced by `{ error: "state is not JSON-serialisable" }`, and the error is logged once per view. Before, the client ended in `error` on connect.
