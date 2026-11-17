// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "tsdown";

// ESM + declarations into dist/. Dependencies and peer dependencies stay external.
export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "browser",
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: true,
});
