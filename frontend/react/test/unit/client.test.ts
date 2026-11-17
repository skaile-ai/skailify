// SPDX-License-Identifier: Apache-2.0

import { afterEach, expect, test } from "bun:test";
import { type AppLogger, type AppTransport, noopLogger } from "@skaile/workspaces/app-sdk";
import { createFakeGateway, type FakeGateway } from "@skaile/workspaces/app-sdk/testing";
import * as z from "zod";
import { createSkailify, type Skailify, type SkailifyOptions } from "../../src/index.ts";

let gateway: FakeGateway | undefined;
let client: Skailify | undefined;

afterEach(async () => {
  await client?.close();
  await gateway?.close();
  client = undefined;
  gateway = undefined;
});

async function connected(options: Partial<SkailifyOptions> = {}): Promise<{ gateway: FakeGateway; client: Skailify }> {
  gateway = createFakeGateway();
  client = createSkailify({ appId: "test", transport: gateway.transport(), reconnect: false, logger: noopLogger, ...options });
  await client.start();
  return { gateway, client };
}

const noInput = z.object({});

async function until(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("standalone, the client does not connect and keeps its registrations", async () => {
  const resolveParams = () => Promise.reject(new Error("must not be called"));
  client = createSkailify({ appId: "test", windowRef: { parent: null, location: { search: "" } }, resolveParams, logger: noopLogger });
  client.registerAction({ name: "x.do", description: "Do x.", input: noInput, handler: async () => 1 });
  await client.start();
  expect(client.getSnapshot().status).toEqual({ state: "standalone" });
  expect(client.app).toBeNull();
  expect(client.getSnapshot().capabilities.map((c) => c.name)).toEqual(["app.get_view_state", "app.x.do"]);
});

test("embedded, it asks the host for params and hands out a fresh token on every connect", async () => {
  gateway = createFakeGateway();
  const g = gateway;
  const asked: string[] = [];
  const used: string[] = [];
  let n = 0;
  client = createSkailify({
    appId: "test",
    windowRef: { parent: {}, location: { search: "?skaileParentOrigin=https%3A%2F%2Fskaile.example" } },
    logger: noopLogger,
    reconnect: { baseMs: 5, maxMs: 10 },
    resolveParams: async (appId, origin) => {
      asked.push(`${appId}@${origin}`);
      return { appId, url: "wss://gw", token: `t${++n}` };
    },
    createTransport: (url, token): AppTransport => {
      expect(url).toBe("wss://gw");
      const inner = g.transport();
      return {
        connect: async () => {
          used.push(await token());
          return inner.connect();
        },
        disconnect: () => inner.disconnect(),
        send: (message) => inner.send(message),
        onMessage: (handler) => inner.onMessage(handler),
        onDisconnect: (handler) => inner.onDisconnect(handler),
        get connected() {
          return inner.connected;
        },
      };
    },
  });
  await client.start();
  expect(client.getSnapshot().status).toMatchObject({ state: "connected", sessionId: "fake-session" });
  g.drop();
  await g.waitFor((gw) => gw.helloCount === 2 && gw.bound);
  // the first connect reuses the token that came with the url; the reconnect asks the host again
  expect(used).toEqual(["t1", "t2"]);
  expect(asked).toEqual(["test@https://skaile.example", "test@https://skaile.example"]);
});

test("a handshake failure shows in the status and the log, and start() does not reject", async () => {
  client = createSkailify({
    appId: "test",
    windowRef: { parent: {}, location: { search: "?skaileParentOrigin=https://h" } },
    logger: noopLogger,
    resolveParams: () => Promise.reject(new Error("host did not answer")),
  });
  await client.start();
  expect(client.getSnapshot().status).toEqual({ state: "error", message: "host did not answer" });
  expect(client.getSnapshot().activity[0]).toMatchObject({ label: "connect failed", error: true });
});

test("actions take relative names; a full name is refused", async () => {
  const { client } = await connected();
  expect(() => client.registerAction({ name: "app.x.do", description: "x", input: noInput, handler: async () => 1 })).toThrow(
    /write "x.do"/,
  );
});

test("actions registered and removed after connect reach the gateway", async () => {
  const { gateway, client } = await connected();
  const remove = client.registerAction({
    name: "orders.approve",
    description: "Approve an order.",
    input: z.object({ id: z.string() }),
    kind: "effect",
    requiresApproval: true,
    effectClass: "privileged",
    handler: async ({ id }) => ({ approved: id }),
  });
  await gateway.waitFor((g) => g.capabilities.has("app.orders.approve"));
  gateway.expectRegistered("app.orders.approve", { requiresApproval: true, effectClass: "privileged" });
  remove();
  await gateway.waitFor((g) => !g.capabilities.has("app.orders.approve"));
});

test("a later action with the same name replaces the earlier one", async () => {
  const { gateway, client } = await connected();
  client.registerAction({ name: "x.do", description: "first", input: noInput, kind: "query", handler: async () => 1 });
  client.registerAction({ name: "x.do", description: "second", input: noInput, kind: "query", handler: async () => 2 });
  await gateway.waitFor((g) => g.capabilities.get("app.x.do")?.description === "second");
  expect(await gateway.invoke("app.x.do")).toBe(2);
});

test("removing the later action with a name offers the earlier one again", async () => {
  const { gateway, client } = await connected();
  client.registerAction({ name: "x.do", description: "first", input: noInput, kind: "query", handler: async () => 1 });
  const second = client.registerAction({ name: "x.do", description: "second", input: noInput, kind: "query", handler: async () => 2 });
  await gateway.waitFor((g) => g.capabilities.get("app.x.do")?.description === "second");
  second();
  await gateway.waitFor((g) => g.capabilities.get("app.x.do")?.description === "first");
  expect(await gateway.invoke("app.x.do")).toBe(1);
});

test("an effect class above routine without approval is logged and never registered", async () => {
  const errors: string[] = [];
  const logger: AppLogger = { ...noopLogger, error: (message: string) => errors.push(message) };
  const { gateway, client } = await connected({ logger });
  client.registerAction({ name: "mail.send", description: "Send mail.", input: noInput, effectClass: "external", handler: async () => 1 });
  expect(errors.some((e) => e.includes("app.mail.send not registered"))).toBe(true);
  expect(gateway.capabilities.has("app.mail.send")).toBe(false);
  expect(gateway.refused).toHaveLength(0);
});

test("an effect reports the view and settles; the handler gets the principal", async () => {
  const { gateway, client } = await connected();
  const view = client.registerView({ id: "list", title: "Orders" });
  client.registerAction({
    name: "orders.open",
    description: "Open an order.",
    input: z.object({ id: z.string() }),
    handler: async ({ id }, ctx) => {
      view.update({ id: `order/${id}`, title: `Order ${id}` });
      return { principal: ctx.principal };
    },
  });
  await gateway.waitFor((g) => g.capabilities.has("app.orders.open"));
  const result = await gateway.invoke("app.orders.open", { id: "o7" }, { principal: { kind: "human", userId: "u1" } });
  expect(result).toEqual({ principal: { kind: "human", userId: "u1" } });
  const settled = await gateway.waitForSettled();
  expect(settled.report?.viewId).toBe("order/o7");
  const phases = gateway.frames.map((f) => f.message.type).filter((t) => t === "view_loading" || t === "view_settled");
  expect(phases.at(-1)).toBe("view_settled");
});

test("a thrown handler comes back as an error, is logged, and the view still settles", async () => {
  const { gateway, client } = await connected();
  client.registerAction({ name: "x.fail", description: "Fail.", input: noInput, handler: async () => {
    throw new Error("nope");
  } });
  await gateway.waitFor((g) => g.capabilities.has("app.x.fail"));
  expect(await gateway.invoke("app.x.fail")).toEqual({ error: "nope" });
  await gateway.waitForSettled();
  expect(client.getSnapshot().activity[0]).toMatchObject({ direction: "out", label: "x.fail", detail: "nope", error: true });
});

test("get_view_state waits for a loading view and returns the exposed state", async () => {
  const { gateway, client } = await connected();
  const view = client.registerView({ id: "orders", loading: true });
  client.registerState("orders", () => [{ id: "o1" }]);
  setTimeout(() => view.update({ id: "orders", state: { shown: 1 } }), 30);
  const state = (await gateway.invoke("app.get_view_state")) as Record<string, unknown>;
  expect(state).toMatchObject({
    view: { id: "orders", state: { shown: 1 } },
    state: { orders: [{ id: "o1" }] },
    settled: true,
  });
  expect(state.actions).toContain("app.test.get_view_state");
});

test("get_view_state says settled: false when a view is still loading at the timeout", async () => {
  const { gateway, client } = await connected();
  const view = client.registerView({ id: "slow", loading: true });
  const state = await gateway.invoke("app.get_view_state", { timeoutMs: 20 });
  expect(state).toMatchObject({ view: { id: "slow" }, settled: false });
  // no settled while the view is still loading; it comes when the view stops loading
  expect(gateway.view.phase).toBe("loading");
  view.update({ id: "slow" });
  await gateway.waitFor((g) => g.view.phase === "settled");
});

test("a view that starts and stops loading sends loading, then settled", async () => {
  const { gateway, client } = await connected();
  const view = client.registerView({ id: "v" });
  await gateway.waitFor((g) => g.view.report?.viewId === "v");
  const since = gateway.frames.length;
  view.update({ id: "v", loading: true });
  await gateway.waitFor((g) => g.view.phase === "loading");
  view.update({ id: "v" });
  await gateway.waitFor((g) => g.view.phase === "settled");
  const types = gateway.frames.slice(since).map((f) => f.message.type);
  expect(types).toEqual(["view_loading", "view_settled"]);
  // within one tick nothing visibly loaded, so nothing is sent
  view.update({ id: "v", loading: true });
  view.update({ id: "v" });
  await Promise.resolve();
  expect(gateway.frames.length).toBe(since + 2);
});

test("navigate shows a view through the app's navigation and answers its state", async () => {
  let shown = "";
  const { gateway } = await connected({
    navigation: {
      views: () => [{ id: "board" }, { id: "card", params: { cardId: "the card" } }],
      navigate: (view, params) => {
        shown = `${view}:${params.cardId ?? ""}`;
      },
      current: () => shown.split(":")[0] || undefined,
    },
  });
  expect(await gateway.invoke("app.list_views")).toMatchObject({ views: [{ id: "board" }, { id: "card" }] });
  const state = await gateway.invoke("app.navigate", { view: "card", params: { cardId: "c1" } });
  expect(shown).toBe("card:c1");
  expect(state).toMatchObject({ view: { id: "card" }, settled: true });
  expect(await gateway.invoke("app.navigate", { view: "nope" })).toEqual({ error: "no view nope; views: board, card" });
});

test("without navigation there is no list_views or navigate", async () => {
  const { gateway } = await connected();
  expect([...gateway.capabilities.keys()]).toEqual(["app.get_view_state"]);
});

test("after a dropped socket the client re-registers what is registered now", async () => {
  gateway = createFakeGateway();
  client = createSkailify({ appId: "test", transport: gateway.transport(), reconnect: { baseMs: 5, maxMs: 10 }, logger: noopLogger });
  await client.start();
  client.registerAction({ name: "x.do", description: "x", input: noInput, kind: "query", handler: async () => 1 });
  await gateway.waitFor((g) => g.capabilities.has("app.x.do"));
  gateway.drop();
  await gateway.waitFor((g) => g.helloCount === 2 && g.capabilities.has("app.x.do"));
  expect(client.getSnapshot().activity.map((a) => a.label)).toContain("disconnected");
});

test("an effect says loading while its handler runs", async () => {
  const { gateway, client } = await connected();
  let phaseInHandler = "";
  client.registerAction({ name: "x.do", description: "x", input: noInput, handler: async () => {
    await gateway.waitFor((g) => g.view.phase === "loading");
    phaseInHandler = gateway.view.phase ?? "";
    return 1;
  } });
  await gateway.waitFor((g) => g.capabilities.has("app.x.do"));
  await gateway.invoke("app.x.do");
  expect(phaseInHandler).toBe("loading");
  await gateway.waitForSettled();
});

test("parallel effects: no settled until the last one is done", async () => {
  const { gateway, client } = await connected();
  let release = () => {};
  const slowDone = new Promise<void>((r) => {
    release = r;
  });
  client.registerAction({ name: "x.slow", description: "slow", input: noInput, handler: async () => {
    await slowDone;
    return "slow";
  } });
  client.registerAction({ name: "x.fast", description: "fast", input: noInput, handler: async () => "fast" });
  await gateway.waitFor((g) => g.capabilities.has("app.x.slow") && g.capabilities.has("app.x.fast"));
  const slow = gateway.invoke("app.x.slow");
  await gateway.waitFor((g) => g.view.phase === "loading");
  const since = gateway.frames.length;
  expect(await gateway.invoke("app.x.fast")).toBe("fast");
  await new Promise((r) => setTimeout(r, 30));
  expect(gateway.frames.slice(since).some((f) => f.message.type === "view_settled")).toBe(false);
  expect(gateway.view.phase).toBe("loading");
  release();
  expect(await slow).toBe("slow");
  await gateway.waitFor((g) => g.view.phase === "settled");
});

test("with animation frames paused (a background tab), calls still finish within their timeout", async () => {
  const g = globalThis as { requestAnimationFrame?: unknown };
  const saved = g.requestAnimationFrame;
  g.requestAnimationFrame = () => 0; // never calls back
  try {
    const { gateway, client } = await connected();
    client.registerAction({ name: "x.do", description: "x", input: noInput, handler: async () => 1 });
    await gateway.waitFor((gw) => gw.capabilities.has("app.x.do"));
    const started = Date.now();
    expect(await gateway.invoke("app.get_view_state", { timeoutMs: 20 }, { timeoutMs: 500 })).toMatchObject({ settled: true });
    expect(await gateway.invoke("app.x.do", {}, { timeoutMs: 500 })).toBe(1);
    await gateway.waitForSettled({ timeoutMs: 500 });
    expect(Date.now() - started).toBeLessThan(400);
  } finally {
    g.requestAnimationFrame = saved;
  }
});

test("a view that stops loading while disconnected is settled after the reconnect", async () => {
  gateway = createFakeGateway();
  client = createSkailify({ appId: "test", transport: gateway.transport(), reconnect: { baseMs: 20, maxMs: 20 }, logger: noopLogger });
  await client.start();
  const view = client.registerView({ id: "v", loading: true });
  await gateway.waitFor((g) => g.view.phase === "loading");
  gateway.drop();
  view.update({ id: "v", state: { done: true } });
  await gateway.waitFor((g) => g.helloCount === 2 && g.bound);
  await gateway.waitFor((g) => g.view.phase === "settled");
  expect(gateway.view.report).toMatchObject({ viewId: "v", state: { done: true } });
});

test("navigate waits for a view stuck loading once, not twice", async () => {
  const { gateway, client } = await connected({
    settleTimeoutMs: 150,
    navigation: { views: () => [{ id: "slow" }], navigate: () => {} },
  });
  client.registerView({ id: "slow", loading: true });
  const started = Date.now();
  expect(await gateway.invoke("app.navigate", { view: "slow" })).toMatchObject({ settled: false });
  const elapsed = Date.now() - started;
  expect(elapsed).toBeGreaterThanOrEqual(140);
  expect(elapsed).toBeLessThan(280);
});

test("descriptions and get_view_state name capabilities the way the agent calls them", async () => {
  const { gateway, client } = await connected({ navigation: { views: () => [{ id: "a" }], navigate: () => {} } });
  expect(gateway.capabilities.get("app.navigate")?.description).toContain("app.test.list_views");
  expect(gateway.capabilities.get("app.list_views")?.description).toContain("app.test.navigate");
  expect(client.getSnapshot().capabilities.find((c) => c.name === "app.navigate")?.agentName).toBe("app.test.navigate");
  const state = (await gateway.invoke("app.get_view_state")) as { actions: string[] };
  expect(state.actions.sort()).toEqual(["app.test.get_view_state", "app.test.list_views", "app.test.navigate"]);
});

test("a name the gateway would drop for its length is logged and never registered", async () => {
  const errors: string[] = [];
  const { gateway, client } = await connected({ logger: { ...noopLogger, error: (m: string) => errors.push(m) } });
  client.registerAction({ name: `x.${"a".repeat(60)}`, description: "long", input: noInput, kind: "query", handler: async () => 1 });
  await Promise.resolve();
  expect(errors.some((e) => e.includes("longer than 64"))).toBe(true);
  expect([...gateway.capabilities.keys()]).toEqual(["app.get_view_state"]);
});

test("when reconnecting gives up, the status says so", async () => {
  gateway = createFakeGateway();
  client = createSkailify({
    appId: "test",
    transport: gateway.transport(),
    reconnect: { maxAttempts: 1, baseMs: 5, maxMs: 5 },
    logger: noopLogger,
  });
  await client.start();
  await gateway.close();
  const c = client;
  await until(() => c.getSnapshot().status.state === "error");
  expect(c.getSnapshot().status).toEqual({ state: "error", message: "reconnect gave up" });
});

test("without reconnect, a dropped connection is an error, not reconnecting", async () => {
  const { gateway, client } = await connected();
  gateway.drop();
  await gateway.waitFor(() => client.getSnapshot().status.state === "error");
  expect(client.getSnapshot().status).toEqual({ state: "error", message: "connection lost" });
});

test("close() before start() leaves it closed, and start() then does nothing", async () => {
  gateway = createFakeGateway();
  client = createSkailify({ appId: "test", transport: gateway.transport(), logger: noopLogger });
  await client.close();
  await client.start();
  expect(client.getSnapshot().status).toEqual({ state: "closed" });
  expect(gateway.helloCount).toBe(0);
});

test("enabled: false never connects, not even over a transport", async () => {
  const { gateway, client } = await connected({ enabled: false });
  expect(client.getSnapshot().status).toEqual({ state: "standalone" });
  expect(gateway.helloCount).toBe(0);
});

test("a view whose state is not JSON-serialisable is reported with an error state, and the connection comes up", async () => {
  const g = createFakeGateway();
  const c = createSkailify({ appId: "kanban", transport: g.transport(), reconnect: false, logger: noopLogger });
  c.registerView({ id: "v", state: { big: 1n } });
  await c.start();
  expect(c.getSnapshot().status.state).toBe("connected");
  await g.waitFor((gw) => gw.view.report?.viewId === "v");
  expect(g.view.report?.state).toEqual({ error: "state is not JSON-serialisable" });
  await c.close();
  await g.close();
});
