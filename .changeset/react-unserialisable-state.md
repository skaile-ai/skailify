---
"@skaile/skailify-react": patch
---

Connect, and answer `get_view_state` in full, even when a view's state or a `useAgentState` value is not JSON-serialisable (a `BigInt`, a cycle). Such a value is replaced by `{ error: "state is not JSON-serialisable" }`, and the error is logged once per view. Before, the client ended in `error` on connect.
