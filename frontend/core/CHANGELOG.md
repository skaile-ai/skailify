# @skaile/skailify-core

## 0.2.0

### Minor Changes

- [#24](https://github.com/skaile-ai/skailify/pull/24) [`0b4d26d`](https://github.com/skaile-ai/skailify/commit/0b4d26d2ce2de938de28e6c384fbe75d27cb0e05) Thanks [@peteralbert](https://github.com/peteralbert)! - Apps can hand work to the agent and read the signed-in user. The core client gets `requestAgentTurn({ text, context })`, which starts an agent turn as the signed-in user's message and rejects with an `AppTurnRefusedError` naming the reason, and `user` (also in the snapshot) with `onUserChange`. React adds `useRequestAgentTurn()` and `useSkailifyUser()`, Angular `injectRequestAgentTurn()` and `injectSkailifyUser()` (a signal), and vue-tsm `requestAgentTurn()`, `useSkailifyUser()` (a computed ref) and the same on its handle. The peer `@skaile/workspaces` range moves to ^10.17.0, the first version with these.
