// SPDX-License-Identifier: Apache-2.0

/**
 * The kanban board's state, as plain NgRx: actions, a reducer and selectors. Free of Skailify: the app's buttons
 * dispatch these actions, and `kanban.app.ts` offers the same actions to the agent.
 */
import { createActionGroup, createFeature, createReducer, createSelector, on, props } from "@ngrx/store";

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

export const BoardActions = createActionGroup({
  source: "Board",
  events: {
    "Add Card": props<{ columnId: ColumnId; title: string; description?: string }>(),
    "Move Card": props<{ cardId: string; columnId: ColumnId }>(),
    "Update Card": props<{ cardId: string; title?: string; description?: string }>(),
    "Remove Card": props<{ cardId: string }>(),
    Reset: props<{ cards: Card[] }>(),
  },
});

export interface BoardState {
  cards: Card[];
  seq: number;
}

export function initialBoard(cards: Card[] = defaultCards()): BoardState {
  return { cards, seq: cards.length };
}

export const boardFeature = createFeature({
  name: "board",
  reducer: createReducer(
    initialBoard(),
    on(BoardActions.addCard, (s, { columnId, title, description }) => ({
      seq: s.seq + 1,
      cards: [...s.cards, { id: `card-${s.seq + 1}`, title, description: description ?? "", columnId }],
    })),
    on(BoardActions.moveCard, (s, { cardId, columnId }) => ({
      ...s,
      cards: s.cards.map((c) => (c.id === cardId ? { ...c, columnId } : c)),
    })),
    on(BoardActions.updateCard, (s, { cardId, title, description }) => ({
      ...s,
      cards: s.cards.map((c) => (c.id === cardId ? { ...c, title: title ?? c.title, description: description ?? c.description } : c)),
    })),
    on(BoardActions.removeCard, (s, { cardId }) => ({ ...s, cards: s.cards.filter((c) => c.id !== cardId) })),
    on(BoardActions.reset, (_s, { cards }) => initialBoard(cards)),
  ),
});

export const { selectCards } = boardFeature;

/** What the agent reads: ids, titles and columns, not whole records. */
export const selectBoardSummary = createSelector(selectCards, (cards) =>
  COLUMNS.map((col) => ({
    id: col.id,
    title: col.title,
    cards: cards.filter((c) => c.columnId === col.id).map((c) => ({ id: c.id, title: c.title })),
  })),
);

export function defaultCards(): Card[] {
  return [
    { id: "card-1", title: "Draft the client proposal", description: "Outline scope and timeline", columnId: "todo" },
    { id: "card-2", title: "Collect Q3 revenue figures", description: "From the finance export", columnId: "todo" },
    { id: "card-3", title: "Build the pitch deck", description: "Reuse the template", columnId: "doing" },
    { id: "card-4", title: "Kickoff call notes", description: "Shared with the team", columnId: "done" },
  ];
}
