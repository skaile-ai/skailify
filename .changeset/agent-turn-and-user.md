---
"@skaile/skailify-core": minor
"@skaile/skailify-react": minor
"@skaile/skailify-angular": minor
"@skaile/skailify-vue-tsm": minor
---

Apps can hand work to the agent and read the signed-in user. The core client gets `requestAgentTurn({ text, context })`, which starts an agent turn as the signed-in user's message and rejects with an `AppTurnRefusedError` naming the reason, and `user` (also in the snapshot) with `onUserChange`. React adds `useRequestAgentTurn()` and `useSkailifyUser()`, Angular `injectRequestAgentTurn()` and `injectSkailifyUser()` (a signal), and vue-tsm `requestAgentTurn()`, `useSkailifyUser()` (a computed ref) and the same on its handle. The peer `@skaile/workspaces` range moves to ^10.17.0, the first version with these.
