// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "tsdown";

// ESM + declarations into dist/. Dependencies and peer dependencies stay external. The core client is bundled in, so
// an app that serves this package through its import map needs no entry for the core.
export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "browser",
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: true,
});
