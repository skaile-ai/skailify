// SPDX-License-Identifier: Apache-2.0

/**
 * A kanban board made agent-controllable with this adapter: the board says it
 * is on screen (`useAgentView`), exposes its cards (`useAgentState`) and offers
 * four actions (`useAgentAction`), deleting only with the user's approval. The
 * side panel shows the connection, the capabilities and the agent's calls,
 * read from the adapter's hooks.
 */
import { useSyncExternalStore } from "react";
import * as z from "zod";
import {
  useAgentAction,
  useAgentState,
  useAgentView,
  useSkailifyActivity,
  useSkailifyCapabilities,
  useSkailifyStatus,
} from "../../src/index.ts";
import { type BoardStore, COLUMNS } from "./board-store.ts";

const column = z.enum(["todo", "doing", "done"]);
const columnHint = COLUMNS.map((c) => `"${c.id}" (${c.title})`).join(", ");

const addInput = z.object({
  columnId: column.describe("Target column"),
  title: z.string().min(1).describe("Short card title"),
  description: z.string().optional().describe("Optional longer description"),
});
const moveInput = z.object({
  cardId: z.string().describe("Id of the card to move, from get_view_state"),
  toColumnId: column.describe("Destination column"),
});
const updateInput = z
  .object({
    cardId: z.string().describe("Id of the card to edit"),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
  })
  .refine((v) => v.title !== undefined || v.description !== undefined, { message: "provide title and/or description" });
const removeInput = z.object({ cardId: z.string().describe("Id of the card to remove") });

export function KanbanApp({ board }: { board: BoardStore }) {
  const cards = useSyncExternalStore(board.subscribe, board.getSnapshot);

  useAgentView({ id: "board", title: "Kanban board", state: { cards: cards.length } });
  useAgentState(
    "board",
    COLUMNS.map((col) => ({
      id: col.id,
      title: col.title,
      cards: cards.filter((c) => c.columnId === col.id).map(({ id, title, description }) => ({ id, title, description })),
    })),
  );

  useAgentAction({
    name: "board.add_card",
    displayName: "Add a card",
    description: `Add a new card to a column. columnId is one of: ${columnHint}.`,
    input: addInput,
    kind: "effect",
    audience: ["llm", "user"],
    handler: async (input) => ({ cardId: board.addCard(input).id }),
  });
  useAgentAction({
    name: "board.move_card",
    displayName: "Move a card",
    description: `Move a card to another column. toColumnId is one of: ${columnHint}.`,
    input: moveInput,
    kind: "effect",
    audience: ["llm", "user"],
    handler: async ({ cardId, toColumnId }) => {
      const card = board.moveCard(cardId, toColumnId);
      return { cardId: card.id, columnId: card.columnId };
    },
  });
  useAgentAction({
    name: "board.update_card",
    displayName: "Edit a card",
    description: "Change a card's title and/or description. At least one of them must be given.",
    input: updateInput,
    kind: "effect",
    audience: ["llm", "user"],
    handler: async ({ cardId, title, description }) => ({ cardId: board.updateCard(cardId, { title, description }).id }),
  });
  useAgentAction({
    name: "board.remove_card",
    displayName: "Delete a card",
    description: "Remove a card from the board by id.",
    input: removeInput,
    kind: "effect",
    requiresApproval: true,
    audience: ["llm", "user"],
    handler: async ({ cardId }) => {
      board.removeCard(cardId);
      return { removed: cardId };
    },
  });

  return (
    <div className="app">
      <section className="board" aria-label="Kanban board">
        {COLUMNS.map((col) => (
          <div className="column" key={col.id} data-column={col.id}>
            <h2>{col.title}</h2>
            {cards
              .filter((c) => c.columnId === col.id)
              .map((card) => (
                <article className="card" key={card.id} data-card={card.id}>
                  <div className="card-title">{card.title}</div>
                  {card.description && <div className="card-desc">{card.description}</div>}
                </article>
              ))}
          </div>
        ))}
      </section>
      <AgentPanel />
    </div>
  );
}

function AgentPanel() {
  const status = useSkailifyStatus();
  const capabilities = useSkailifyCapabilities();
  const activity = useSkailifyActivity();
  return (
    <aside className="side">
      <div className="pill" data-status={status.state}>
        {status.state}
      </div>
      <ul className="caps">
        {capabilities.map((cap) => (
          <li key={cap.name}>
            <code>{cap.name}</code> {cap.kind}
            {cap.requiresApproval && " (approval)"}
          </li>
        ))}
      </ul>
      <ul className="activity">
        {activity.map((a) => (
          <li key={a.id} className={a.direction}>
            {a.label} {a.detail}
          </li>
        ))}
      </ul>
    </aside>
  );
}
