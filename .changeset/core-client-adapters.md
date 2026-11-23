---
"@skaile/skailify-react": patch
"@skaile/skailify-angular": patch
"@skaile/skailify-vue-tsm": patch
---

The Skailify client now lives in `@skaile/skailify-core`, a framework-free package. The React and Angular adapters depend on it and re-export the same API as before (`SkailifyOptions` gains the optional `rendered` and `zone` hooks the Angular adapter already had); vue-tsm bundles the parts it shares, so an import map needs no new entry.
