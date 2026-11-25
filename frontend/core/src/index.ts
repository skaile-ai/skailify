// SPDX-License-Identifier: Apache-2.0

/**
 * `@skaile/skailify-core`: the framework-free Skailify client. It makes an app agent-controllable inside a Skaile
 * session, over the Skailify app channel, without a UI framework: the app creates one client with its app id (and,
 * optionally, its navigation), and registers the views, state and actions it offers.
 *
 * ```ts
 * const skailify = createSkailify({ appId: "deck" });
 * skailify.registerView({ id: "slide-1", title: "Title slide" });
 * void skailify.start();
 * ```
 *
 * The React and Angular adapters wrap this client. For a page without a bundler, `dist/skailify.iife.js` exposes
 * the same exports as the global `Skailify`.
 */
export { z } from "zod";
export type {
  AppAssistantCorner,
  AppAssistantPresentation,
  AppSessionRole,
  AppTurnFailureReason,
  AppTurnRequest,
  AppUser,
} from "@skaile/workspaces/app-sdk";
export { AppTurnRefusedError } from "@skaile/workspaces/app-sdk";
export {
  type Navigation,
  type ViewDescriptor,
  type ViewState,
  viewState,
} from "./capabilities.ts";
export {
  type ActivityEntry,
  type AgentAction,
  agentAction,
  type CapabilityInfo,
  type ConnectionStatus,
  createSkailify,
  MAX_WAIT_MS,
  type Skailify,
  type SkailifyOptions,
  type SkailifySnapshot,
  skaileParentOrigin,
  type ViewRegistration,
} from "./client.ts";
