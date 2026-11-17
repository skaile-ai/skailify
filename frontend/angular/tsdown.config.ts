// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "tsdown";

// ESM + declarations into dist/, one entry per export. Modules the entries share (the client and
// the injection token) go into a shared chunk, so every entry sees the same instances.
// Dependencies and peer dependencies stay external.
export default defineConfig({
  entry: ["src/index.ts", "src/ngrx.ts", "src/router.ts", "src/ngrx-signals.ts"],
  format: "esm",
  platform: "browser",
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: true,
});
