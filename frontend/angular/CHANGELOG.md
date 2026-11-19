# @skaile/skailify-angular

## 0.2.0

### Minor Changes

- [#15](https://github.com/skaile-ai/skailify-adapters/pull/15) [`0c660d2`](https://github.com/skaile-ai/skailify-adapters/commit/0c660d246e6d1730be6bfd7259b9525f74706250) Thanks [@peteralbert](https://github.com/peteralbert)! - An `assistant` option tells Skaile where to put its agent button over the app (`{ kind: "floating", corner, offset, size, accent }`), or to leave it out (`{ kind: "none" }`). `setAssistant(...)` changes it while the app runs. The peer `@skaile/workspaces` range now starts at 10.14.0, the first version that sends these hints.
