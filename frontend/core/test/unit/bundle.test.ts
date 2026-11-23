// SPDX-License-Identifier: Apache-2.0

// The `<script>` bundle, as a page without a bundler loads it: run as a classic script, it puts `Skailify` on the
// global object, and that client connects to the fake gateway with nothing else on the page.
import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { noopLogger } from "@skaile/workspaces/app-sdk";
import { createFakeGateway, type FakeGateway } from "@skaile/workspaces/app-sdk/testing";
import type * as Core from "../../src/index.ts";

const BUNDLE = new URL("../../dist/skailify.iife.js", import.meta.url);

type Global = typeof globalThis & { Skailify?: typeof Core };
let gateway: FakeGateway | undefined;
let client: Core.Skailify | undefined;

afterEach(async () => {
  await client?.close();
  await gateway?.close();
  client = undefined;
  gateway = undefined;
  delete (globalThis as Global).Skailify;
});

function loadBundle(): typeof Core {
  const code = readFileSync(BUNDLE, "utf8");
  // indirect eval runs it in the global scope, as a <script> tag would
  (0, eval)(code);
  const global = (globalThis as Global).Skailify;
  if (!global) throw new Error("the bundle did not define the global Skailify");
  return global;
}

test("the bundle defines the global Skailify with the client and zod", () => {
  const Skailify = loadBundle();
  expect(typeof Skailify.createSkailify).toBe("function");
  expect(typeof Skailify.agentAction).toBe("function");
  expect(typeof Skailify.skaileParentOrigin).toBe("function");
  expect(Skailify.MAX_WAIT_MS).toBe(10_000);
  expect(Skailify.z.object({ id: Skailify.z.string() }).parse({ id: "a" })).toEqual({ id: "a" });
});

test("standalone in a page of its own, the bundled client does not connect", async () => {
  const Skailify = loadBundle();
  client = Skailify.createSkailify({ appId: "deck", logger: noopLogger });
  await client.start();
  expect(client.getSnapshot().status).toEqual({ state: "standalone" });
});

test("the bundled client connects to the fake gateway, reports the view and answers a call", async () => {
  const Skailify = loadBundle();
  const { z } = Skailify;
  gateway = createFakeGateway();
  const g = gateway;
  let slide = 1;
  client = Skailify.createSkailify({ appId: "deck", transport: g.transport(), reconnect: false, logger: noopLogger });
  const view = client.registerView({ id: "slide-1", title: "Slide 1" });
  client.registerState("deck", () => ({ slide }));
  client.registerAction({
    name: "deck.go_to",
    description: "Show a slide by number.",
    input: z.object({ slide: z.number().int().min(1) }),
    kind: "effect",
    handler: async ({ slide: next }) => {
      slide = next;
      view.update({ id: `slide-${next}`, title: `Slide ${next}` });
      return { slide: next };
    },
  });
  await client.start();

  expect(client.getSnapshot().status).toMatchObject({ state: "connected" });
  expect([...g.capabilities.keys()]).toEqual(expect.arrayContaining(["app.get_view_state", "app.deck.go_to"]));
  await g.waitFor((gw) => gw.view.report?.viewId === "slide-1");

  expect(await g.invoke("app.deck.go_to", { slide: 3 })).toEqual({ slide: 3 });
  await g.waitFor((gw) => gw.view.report?.viewId === "slide-3");
  expect(await g.invoke("app.get_view_state")).toMatchObject({
    view: { id: "slide-3", title: "Slide 3" },
    state: { deck: { slide: 3 } },
    settled: true,
  });
});

test("the plain-HTML example runs on the bundle: it registers its view, state and action and stays standalone", async () => {
  const html = readFileSync(new URL("../../../_example/plain-html/index.html", import.meta.url), "utf8");
  document.body.innerHTML = html.slice(html.indexOf("<body>") + "<body>".length, html.indexOf("</body>"));
  const scripts = [...document.querySelectorAll("script")];
  expect(scripts[0]?.getAttribute("src")).toBe("../../core/dist/skailify.iife.js");
  loadBundle();
  (0, eval)(scripts[1]?.textContent ?? "");
  client = (globalThis as Global & { skailify?: Core.Skailify }).skailify;
  if (!client) throw new Error("the example did not create its client");

  await client.start();
  expect(client.getSnapshot().status).toEqual({ state: "standalone" });
  expect(client.getSnapshot().capabilities.map((c) => c.agentName)).toEqual(["app.deck.get_view_state", "app.deck.slides.go_to"]);
  expect(client.currentView()).toEqual({ id: "slide-1", title: "Welcome" });

  (document.getElementById("next") as HTMLButtonElement).click();
  expect(client.currentView()).toEqual({ id: "slide-2", title: "What the agent sees" });
  expect(client.readState()).toEqual({ deck: { slide: 2, slides: 3 } });
  delete (globalThis as Global & { skailify?: unknown }).skailify;
  document.body.innerHTML = "";
});
