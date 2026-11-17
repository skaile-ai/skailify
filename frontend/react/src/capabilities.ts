// SPDX-License-Identifier: Apache-2.0

/**
 * The generic capabilities every React app gets: read what the user sees, and,
 * when the app hands in its navigation, list the views and show one. They are
 * router-agnostic: the app says what its views are and how to show one.
 */
import * as z from "zod";
import { type AgentAction, agentAction, jsonSafe, SETTLES_ITSELF, type Skailify } from "./client.ts";

/** A view (page, screen) of the app, as the agent sees it in `list_views`. */
export interface ViewDescriptor {
  /** The id `navigate` takes */
  id: string;
  title?: string;
  /** false for views reached only from another view; default true */
  menu?: boolean;
  /** Parameters the view takes in `navigate`, e.g. `{ cardId: "the card to open" }` */
  params?: Record<string, string>;
}

/** How the agent finds and shows the app's views. Wire it to your router; see the README for react-router. */
export interface Navigation {
  /** The app's views; called on every request, so it always answers the current set */
  views: () => ViewDescriptor[];
  /** Shows a view. May return before the view has rendered: the client waits for it to settle. */
  navigate: (viewId: string, params: Record<string, string>) => void | Promise<void>;
  /** The id of the view on screen, for apps whose views do not call `useAgentView` */
  current?: () => string | undefined;
}

/** What `get_view_state` and `navigate` answer. */
export interface ViewState {
  view: { id: string; title?: string; state?: unknown } | null;
  /** What the mounted components expose with `useAgentState`, by name */
  state: Record<string, unknown>;
  /** The actions available now, by the name the agent calls them (`app.<appId>.<name>`) */
  actions: string[];
  /** false when a view was still loading when the wait timed out: read again */
  settled: boolean;
}

export function viewState(client: Skailify, settled: boolean): ViewState {
  const view = client.currentView();
  return {
    view: view ? { id: view.id, title: view.title, state: jsonSafe(view.state) } : null,
    state: client.readState(),
    actions: client.getSnapshot().capabilities.map((c) => c.agentName),
    settled: settled && !client.loading(),
  };
}

const settledNote =
  "When settled is false a view was still loading when the wait timed out: the state may be incomplete, so read it again with get_view_state.";

export function genericCapabilities(client: Skailify, navigation: Navigation | undefined): AgentAction[] {
  const name = client.agentName;
  const generic: AgentAction[] = [
    agentAction({
      name: "get_view_state",
      displayName: "Read what the user sees",
      description:
        `Read the current state of the ${client.appId} app: the view on screen (id, title and a summary of what it shows), ` +
        "the state the app exposes to agents, and the actions available now. Call this first, and again after acting. " +
        `It waits until no view is loading. ${settledNote}`,
      kind: "query",
      input: z.object({
        timeoutMs: z.number().int().min(0).optional().describe("How long to wait at most for a loading view, in ms"),
      }),
      handler: async ({ timeoutMs }) => viewState(client, await client.settle(timeoutMs)),
    }),
  ];
  if (!navigation) return generic;

  generic.push(
    agentAction({
      name: "list_views",
      displayName: "List the views",
      description:
        `List the views (pages) of the ${client.appId} app: id, title, whether it is in the menu, and the parameters it takes. ` +
        `Use the id with ${name("navigate")}.`,
      kind: "query",
      input: z.object({}),
      handler: async () => ({ current: client.currentView()?.id ?? null, views: navigation.views() }),
    }),
    // navigate waits for the view itself, to answer the state after it; the wrapper must not wait a second time
    {
      ...agentAction({
      name: "navigate",
      displayName: "Show a view",
      description:
        `Show a view of the app, with the parameters it takes (see ${name("list_views")}). ` +
        `Waits until the view has loaded, then returns the view state. ${settledNote}`,
      kind: "effect",
      input: z.object({
        view: z.string().describe("View id from list_views"),
        params: z.record(z.string(), z.string()).optional().describe("Parameters of the view, by name"),
      }),
      handler: async ({ view, params }) => {
        const views = navigation.views();
        if (!views.some((v) => v.id === view)) {
          throw new Error(`no view ${view}; views: ${views.map((v) => v.id).join(", ") || "none"}`);
        }
        await navigation.navigate(view, params ?? {});
        return viewState(client, await client.settle());
      },
      }),
      [SETTLES_ITSELF]: true,
    },
  );
  return generic;
}
