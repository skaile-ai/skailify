// SPDX-License-Identifier: Apache-2.0

/**
 * `@skaile/skailify-angular`: makes an Angular app agent-controllable inside a Skaile session, over the Skailify app
 * channel. App-agnostic: the app provides one client with its app id (and, optionally, its navigation), and its
 * components register the views, state and actions they offer while they live.
 *
 * ```ts
 * bootstrapApplication(App, { providers: [provideSkailify({ appId: "kanban" })] });
 * ```
 *
 * The Router and NgRx bridges are in `@skaile/skailify-angular/router`, `/ngrx` and `/ngrx-signals`.
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
  type InjectOptions,
  injectAgentAction,
  injectAgentState,
  injectAgentView,
  injectRequestAgentTurn,
  injectSkailify,
  injectSkailifyActivity,
  injectSkailifyCapabilities,
  injectSkailifyStatus,
  injectSkailifyUser,
  type ProvideSkailifyOptions,
  provideSkailify,
  SKAILIFY,
} from "./angular";
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
  type Navigation,
  type ViewDescriptor,
  type ViewRegistration,
  type ViewState,
  viewState,
} from "@skaile/skailify-core";
