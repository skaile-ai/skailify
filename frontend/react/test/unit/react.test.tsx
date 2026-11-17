// SPDX-License-Identifier: Apache-2.0

import { afterEach, expect, test } from "bun:test";
import { noopLogger } from "@skaile/workspaces/app-sdk";
import { createFakeGateway, type FakeGateway } from "@skaile/workspaces/app-sdk/testing";
import { StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as z from "zod";
import { createSkailify, type Skailify, SkailifyProvider, useAgentAction, useAgentView } from "../../src/index.ts";
import { createBoardStore } from "../kanban/board-store.ts";
import { KanbanApp } from "../kanban/KanbanApp.tsx";

let gateway: FakeGateway | undefined;
let client: Skailify | undefined;
let root: Root | undefined;
let container: HTMLElement | undefined;

afterEach(async () => {
  root?.unmount();
  container?.remove();
  await client?.close();
  await gateway?.close();
  root = client = gateway = container = undefined;
});

async function mount(ui: React.ReactNode): Promise<{ gateway: FakeGateway; client: Skailify; container: HTMLElement }> {
  gateway = createFakeGateway();
  client = createSkailify({ appId: "kanban", transport: gateway.transport(), reconnect: false, logger: noopLogger });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const c = client;
  // StrictMode mounts every effect twice, as React does in development
  root.render(
    <StrictMode>
      <SkailifyProvider client={c}>{ui}</SkailifyProvider>
    </StrictMode>,
  );
  await client.start();
  return { gateway, client, container };
}

const KANBAN_CAPABILITIES = [
  "app.get_view_state",
  "app.board.add_card",
  "app.board.move_card",
  "app.board.update_card",
  "app.board.remove_card",
];

test("the kanban registers its actions and reports its view", async () => {
  const { gateway } = await mount(<KanbanApp board={createBoardStore()} />);
  await gateway.waitFor((g) => KANBAN_CAPABILITIES.every((name) => g.capabilities.has(name)));
  expect([...gateway.capabilities.keys()].sort()).toEqual([...KANBAN_CAPABILITIES].sort());
  gateway.expectRegistered("app.board.remove_card", { requiresApproval: true, kind: "effect" });
  gateway.expectRegistered("app.board.add_card", { kind: "effect" });
  await gateway.waitFor((g) => g.view.report?.viewId === "board");
  expect(gateway.view.report).toMatchObject({ viewId: "board", title: "Kanban board", state: { cards: 4 } });
});

test("the agent reads the board, adds and moves cards, and the DOM follows", async () => {
  const board = createBoardStore();
  const { gateway, container } = await mount(<KanbanApp board={board} />);
  await gateway.waitFor((g) => g.capabilities.has("app.board.add_card"));

  const state = (await gateway.invoke("app.get_view_state")) as { state: { board: { id: string; cards: { id: string }[] }[] } };
  expect(state.state.board.map((c) => c.cards.length)).toEqual([2, 1, 1]);

  const added = (await gateway.invoke("app.board.add_card", { columnId: "todo", title: "QA the deck" })) as { cardId: string };
  const view = await gateway.waitForSettled();
  expect(view.report?.state).toEqual({ cards: 5 });
  expect(container.querySelector(`[data-column="todo"] [data-card="${added.cardId}"]`)?.textContent).toContain("QA the deck");

  await gateway.invoke("app.board.move_card", { cardId: "card-3", toColumnId: "done" });
  await gateway.waitForSettled();
  expect(container.querySelector('[data-column="done"] [data-card="card-3"]')).not.toBeNull();
});

test("invalid input and unknown cards come back as errors the agent can read", async () => {
  const { gateway } = await mount(<KanbanApp board={createBoardStore()} />);
  await gateway.waitFor((g) => g.capabilities.has("app.board.update_card"));
  const refused = (await gateway.invoke("app.board.update_card", { cardId: "card-1" })) as { error: string };
  expect(refused.error).toContain("provide title and/or description");
  expect(await gateway.invoke("app.board.remove_card", { cardId: "card-99" })).toEqual({ error: 'no card with id "card-99"' });
});

test("the activity panel and status pill show the agent's calls", async () => {
  const { gateway, container } = await mount(<KanbanApp board={createBoardStore()} />);
  await gateway.waitFor((g) => g.capabilities.has("app.board.remove_card"));
  await gateway.invoke("app.board.remove_card", { cardId: "card-1" });
  await gateway.waitForSettled();
  expect(container.querySelector(".pill")?.getAttribute("data-status")).toBe("connected");
  const lines = [...container.querySelectorAll(".activity li")].map((li) => li.textContent);
  expect(lines.slice(0, 2)).toEqual(['board.remove_card {"removed":"card-1"}', 'board.remove_card {"cardId":"card-1"}']);
  expect(container.querySelector(".caps")?.textContent).toContain("app.board.remove_card effect (approval)");
});

function Detail({ id }: { id: string }) {
  useAgentView({ id: `detail/${id}`, title: `Detail ${id}` });
  useAgentAction({
    name: "detail.close",
    description: "Close the detail.",
    input: z.object({}),
    handler: async () => ({ closed: id }),
  });
  return <p>detail {id}</p>;
}

function Shell() {
  const [open, setOpen] = useState<string | null>(null);
  useAgentView({ id: "home" });
  useAgentAction({
    name: "detail.open",
    description: "Open a detail.",
    input: z.object({ id: z.string() }),
    handler: async ({ id }) => {
      setOpen(id);
      return { opening: id, wasOpen: open };
    },
  });
  return open ? <Detail id={open} /> : <p>home</p>;
}

test("a component's actions and view live as long as it is mounted, and handlers see the latest state", async () => {
  const { gateway } = await mount(<Shell />);
  await gateway.waitFor((g) => g.capabilities.has("app.detail.open"));
  expect(gateway.capabilities.has("app.detail.close")).toBe(false);

  expect(await gateway.invoke("app.detail.open", { id: "a" })).toEqual({ opening: "a", wasOpen: null });
  expect((await gateway.waitForSettled()).report?.viewId).toBe("detail/a");
  await gateway.waitFor((g) => g.capabilities.has("app.detail.close"));

  // the handler is not re-registered on re-render, yet sees the state of the last render
  expect(await gateway.invoke("app.detail.open", { id: "b" })).toEqual({ opening: "b", wasOpen: "a" });
  expect((await gateway.waitForSettled()).report?.viewId).toBe("detail/b");
  const registrations = gateway.frames.filter(
    (f) => f.message.type === "capability_register" && JSON.stringify(f.message).includes("app.detail.open"),
  );
  expect(registrations).toHaveLength(1);
});

test("unmounting removes the actions from the agent's catalog and the view falls back", async () => {
  const { gateway } = await mount(<Shell />);
  await gateway.waitFor((g) => g.capabilities.has("app.detail.open"));
  await gateway.invoke("app.detail.open", { id: "a" });
  await gateway.waitFor((g) => g.capabilities.has("app.detail.close"));
  root!.unmount();
  root = undefined;
  await gateway.waitFor((g) => !g.capabilities.has("app.detail.open") && !g.capabilities.has("app.detail.close"));
  await gateway.waitFor((g) => g.view.report?.viewId === "kanban");
});

function Outer() {
  useAgentView({ id: "board" });
  return <Inner />;
}

function Inner() {
  useAgentView({ id: "card/7", title: "Card 7" });
  return <p>card</p>;
}

test("a view and the view it contains, mounted together, report the inner one", async () => {
  const { gateway, client } = await mount(<Outer />);
  await gateway.waitFor((g) => g.view.report?.viewId === "card/7");
  expect(client.currentView()?.id).toBe("card/7");
});

function Described({ text }: { text: string }) {
  useAgentAction({ name: "x.do", description: text, input: z.object({}), kind: "query", handler: async () => text });
  return null;
}

test("a changed declaration registers the action again", async () => {
  const { gateway } = await mount(<Described text="first" />);
  await gateway.waitFor((g) => g.capabilities.get("app.x.do")?.description === "first");
  const c = client!;
  root!.render(
    <StrictMode>
      <SkailifyProvider client={c}>
        <Described text="second" />
      </SkailifyProvider>
    </StrictMode>,
  );
  await gateway.waitFor((g) => g.capabilities.get("app.x.do")?.description === "second");
  expect(await gateway.invoke("app.x.do")).toBe("second");
});

function Unserialisable() {
  useAgentView({ id: "v", state: { big: 1n } });
  return <p>still rendered</p>;
}

test("view state that is not JSON-serialisable does not break rendering", async () => {
  const { container } = await mount(<Unserialisable />);
  await new Promise((r) => setTimeout(r, 20));
  expect(container.textContent).toBe("still rendered");
});
