// SPDX-License-Identifier: Apache-2.0

/**
 * `@skaile/skailify-react`: makes a React app agent-controllable inside a Skaile session, over the Skailify app
 * channel. App-agnostic: the app creates one client with its app id (and, optionally, its navigation), and its
 * components register the views, state and actions they offer while they are mounted.
 *
 * ```tsx
 * const skailify = createSkailify({ appId: "kanban" });
 * void skailify.start();
 * root.render(<SkailifyProvider client={skailify}><App /></SkailifyProvider>);
 * ```
 */
export { z } from "zod";
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
export {
  SkailifyProvider,
  useAgentAction,
  useAgentState,
  useAgentView,
  useSkailify,
  useSkailifyActivity,
  useSkailifyCapabilities,
  useSkailifyStatus,
} from "./react.tsx";
