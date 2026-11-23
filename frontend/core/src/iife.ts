// SPDX-License-Identifier: Apache-2.0

/**
 * The entry of the `<script>` bundle, `dist/skailify.iife.js`: every export of the package, with zod and the app SDK
 * bundled in, on the global `Skailify`.
 *
 * ```html
 * <script src="skailify.iife.js"></script>
 * <script>
 *   const skailify = Skailify.createSkailify({ appId: "deck" });
 *   void skailify.start();
 * </script>
 * ```
 */
export * from "./index.ts";
