// SPDX-License-Identifier: Apache-2.0

/**
 * The React bindings: a provider for the page's client, and hooks with which a
 * component tells the agent what it shows and what it can do, for as long as
 * it is mounted.
 */
import { createContext, type ReactNode, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as z from "zod";
import type { ActivityEntry, AgentAction, CapabilityInfo, ConnectionStatus, Skailify, ViewRegistration } from "./client.ts";

const SkailifyContext = createContext<Skailify | null>(null);

/**
 * Makes the page's client available to the hooks. The provider does not start or close the client: call
 * `start()` once where the app boots, so React's double mount in development does not connect twice.
 */
export function SkailifyProvider({ client, children }: { client: Skailify; children?: ReactNode }) {
  return <SkailifyContext.Provider value={client}>{children}</SkailifyContext.Provider>;
}

/** The client of the nearest {@link SkailifyProvider}. */
export function useSkailify(): Skailify {
  const client = useContext(SkailifyContext);
  if (!client) throw new Error("skailify: no client; wrap the app in <SkailifyProvider client={...}>");
  return client;
}

/** The connection status, for a status pill. */
export function useSkailifyStatus(): ConnectionStatus {
  const client = useSkailify();
  return useSyncExternalStore(client.subscribe, () => client.getSnapshot().status);
}

/** The latest calls and connection events, newest first. */
export function useSkailifyActivity(): readonly ActivityEntry[] {
  const client = useSkailify();
  return useSyncExternalStore(client.subscribe, () => client.getSnapshot().activity);
}

/** The capabilities the agent sees now, with their full names. */
export function useSkailifyCapabilities(): readonly CapabilityInfo[] {
  const client = useSkailify();
  return useSyncExternalStore(client.subscribe, () => client.getSnapshot().capabilities);
}

const schemaKeys = new WeakMap<z.ZodTypeAny, string>();
function schemaKey(schema: z.ZodTypeAny | undefined): string {
  if (!schema) return "";
  let key = schemaKeys.get(schema);
  if (key === undefined) {
    try {
      key = JSON.stringify(z.toJSONSchema(schema, { unrepresentable: "any" }));
    } catch {
      key = String(Math.random());
    }
    schemaKeys.set(schema, key);
  }
  return key;
}

/** What tells one declaration from another, so a re-render with the same declaration does not re-register it. */
function declarationKey(action: AgentAction): string {
  const { handler: _handler, input, output, ...rest } = action;
  return JSON.stringify([rest, schemaKey(input), schemaKey(output)]);
}

/**
 * Offers an action to the agent while the component is mounted. The handler always sees the latest render's
 * props and state; the action is registered again only when its declaration (name, description, schema, approval)
 * changes. Declare the input schema outside the component where you can: it is then converted only once.
 *
 * Mark every action that changes data with `requiresApproval: true`, so the platform asks the user first.
 */
export function useAgentAction<T extends z.ZodTypeAny, R extends z.ZodTypeAny | undefined = undefined>(action: AgentAction<T, R>): void {
  const client = useSkailify();
  const latest = useRef(action);
  latest.current = action;
  const key = declarationKey(action as unknown as AgentAction);
  useEffect(
    () =>
      client.registerAction({
        ...latest.current,
        handler: (args, ctx) => latest.current.handler(args, ctx),
      } as AgentAction<T, R>),
    [client, key],
  );
}

/**
 * Tells the agent this view is on screen while the component is mounted: its id, title, a small summary of what it
 * shows, and whether it is still loading. Pass `loading: true` while the view fetches what it shows: the agent waits
 * for it before it reads the screen.
 */
export function useAgentView(view: ViewRegistration): void {
  const client = useSkailify();
  const registration = useRef<ReturnType<Skailify["registerView"]> | null>(null);
  // Taken at the first render: a parent renders before the child it contains, so the child is on top even though
  // React runs the child's effects first.
  const [order] = useState(() => client.viewOrder());
  const key = viewKey(view);
  const latest = useRef(view);
  latest.current = view;

  useEffect(() => {
    registration.current = client.registerView(latest.current, order);
    return () => {
      registration.current?.remove();
      registration.current = null;
    };
  }, [client, order]);

  useEffect(() => {
    registration.current?.update(latest.current);
  }, [key]);
}

/** Compares a view across renders. State that is not JSON-serialisable never breaks rendering: the view is reported with an error state, and the error logged. */
function viewKey(view: ViewRegistration): string {
  try {
    return JSON.stringify([view.id, view.title, view.state, view.loading === true]);
  } catch {
    return JSON.stringify([view.id, view.title, String(Math.random()), view.loading === true]);
  }
}

/**
 * Exposes a piece of the component's state to the agent's `get_view_state`, under `name`, while the component is
 * mounted. Keep it small and JSON-serialisable: ids and labels, not whole records.
 */
export function useAgentState(name: string, value: unknown): void {
  const client = useSkailify();
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => client.registerState(name, () => latest.current), [client, name]);
}
