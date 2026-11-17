# @skaile/skailify-react

## 0.1.1

### Patch Changes

- [#13](https://github.com/skaile-ai/skailify-adapters/pull/13) [`087a5a6`](https://github.com/skaile-ai/skailify-adapters/commit/087a5a60ba39c6bb7d6b9071ef9d698b2ffdbde1) Thanks [@peteralbert](https://github.com/peteralbert)! - Connect, and answer `get_view_state` in full, even when a view's state or a `useAgentState` value is not JSON-serialisable (a `BigInt`, a cycle). Such a value is replaced by `{ error: "state is not JSON-serialisable" }`, and the error is logged once per view. Before, the client ended in `error` on connect.
