// SPDX-License-Identifier: Apache-2.0

/**
 * The kanban board's state: in the browser only, with a tiny observable for
 * `useSyncExternalStore`. Free of Skailify: the agent changes it through the
 * actions in `KanbanApp.tsx`, the same mutators a user's clicks would call.
 */

export type ColumnId = "todo" | "doing" | "done";

export interface Card {
  id: string;
  title: string;
  description: string;
  columnId: ColumnId;
}

export const COLUMNS: { id: ColumnId; title: string }[] = [
  { id: "todo", title: "To Do" },
  { id: "doing", title: "Doing" },
  { id: "done", title: "Done" },
];

export function createBoardStore(seed: Card[] = defaultCards()) {
  let cards = seed;
  let seq = seed.length;
  const listeners = new Set<() => void>();
  const commit = (next: Card[]) => {
    cards = next;
    for (const listener of [...listeners]) listener();
  };
  const find = (cardId: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (!card) throw new Error(`no card with id "${cardId}"`);
    return card;
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => cards,
    addCard(input: { columnId: ColumnId; title: string; description?: string }): Card {
      const card = { id: `card-${++seq}`, title: input.title, description: input.description ?? "", columnId: input.columnId };
      commit([...cards, card]);
      return card;
    },
    moveCard(cardId: string, columnId: ColumnId): Card {
      const card = { ...find(cardId), columnId };
      commit(cards.map((c) => (c.id === cardId ? card : c)));
      return card;
    },
    updateCard(cardId: string, patch: { title?: string; description?: string }): Card {
      const before = find(cardId);
      const card = { ...before, title: patch.title ?? before.title, description: patch.description ?? before.description };
      commit(cards.map((c) => (c.id === cardId ? card : c)));
      return card;
    },
    removeCard(cardId: string): void {
      find(cardId);
      commit(cards.filter((c) => c.id !== cardId));
    },
  };
}

export type BoardStore = ReturnType<typeof createBoardStore>;

export function defaultCards(): Card[] {
  return [
    { id: "card-1", title: "Draft the client proposal", description: "Outline scope and timeline", columnId: "todo" },
    { id: "card-2", title: "Collect Q3 revenue figures", description: "From the finance export", columnId: "todo" },
    { id: "card-3", title: "Build the pitch deck", description: "Reuse the template", columnId: "doing" },
    { id: "card-4", title: "Kickoff call notes", description: "Shared with the team", columnId: "done" },
  ];
}
