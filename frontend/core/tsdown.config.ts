// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "tsdown";

export default defineConfig([
  // ESM + declarations into dist/. Dependencies and peer dependencies stay external.
  {
    entry: ["src/index.ts"],
    format: "esm",
    platform: "browser",
    target: "es2022",
    dts: true,
    sourcemap: true,
    clean: true,
  },
  // One file for a <script> tag: everything bundled in, on the global `Skailify`.
  {
    entry: { skailify: "src/iife.ts" },
    format: "iife",
    globalName: "Skailify",
    platform: "browser",
    target: "es2022",
    deps: { alwaysBundle: [/.*/], onlyBundle: false },
    minify: true,
    sourcemap: true,
    clean: false,
  },
]);
