// SPDX-License-Identifier: Apache-2.0

/**
 * A kanban board made agent-controllable with this adapter. The board's state is an NgRx Store: the agent dispatches
 * the same four actions the app's buttons dispatch (deleting only with the user's approval) and reads the board through
 * a selector. The search box is an NgRx SignalStore the board offers while it is on screen. The side panel shows the
 * connection, the capabilities and the agent's calls, read from the adapter's signals.
 */
import { ChangeDetectionStrategy, Component, computed, type EnvironmentProviders, inject, type Provider } from "@angular/core";
import { provideStore, Store } from "@ngrx/store";
import * as z from "zod";
import {
  injectAgentView,
  injectSkailifyActivity,
  injectSkailifyCapabilities,
  injectSkailifyStatus,
  type ProvideSkailifyOptions,
  provideSkailify,
} from "../../src/index.ts";
import { provideSkailifyStore, storeActions } from "../../src/ngrx.ts";
import { exposeSignalStore } from "../../src/ngrx-signals.ts";
import { BoardActions, boardFeature, COLUMNS, selectBoardSummary, selectCards } from "./board.state.ts";
import { FilterStore } from "./filter.store.ts";

const column = z.enum(["todo", "doing", "done"]);
const columnHint = COLUMNS.map((c) => `"${c.id}" (${c.title})`).join(", ");

function requireCard(store: Store, cardId: string): void {
  if (!store.selectSignal(selectCards)().some((c) => c.id === cardId)) throw new Error(`no card with id "${cardId}"`);
}

/** The app's providers: the store, the client, and the store actions the agent may dispatch. */
export function kanbanProviders(skailify: Omit<ProvideSkailifyOptions, "appId">): Array<Provider | EnvironmentProviders> {
  return [
    provideStore({ [boardFeature.name]: boardFeature.reducer }),
    provideSkailify({ appId: "kanban", ...skailify }),
    provideSkailifyStore({
      state: { board: selectBoardSummary },
      actions: storeActions(BoardActions, {
        addCard: {
          displayName: "Add a card",
          description: `Add a new card to a column. columnId is one of: ${columnHint}.`,
          input: z.object({
            columnId: column.describe("Target column"),
            title: z.string().min(1).describe("Short card title"),
            description: z.string().optional().describe("Optional longer description"),
          }),
          result: (_props, store) => ({ cardId: store.selectSignal(selectCards)().at(-1)?.id }),
        },
        moveCard: {
          displayName: "Move a card",
          description: `Move a card to another column. columnId is one of: ${columnHint}.`,
          input: z.object({
            cardId: z.string().describe("Id of the card to move, from get_view_state"),
            columnId: column.describe("Destination column"),
          }),
          guard: ({ cardId }, store) => requireCard(store, cardId),
        },
        updateCard: {
          displayName: "Edit a card",
          description: "Change a card's title and/or description. At least one of them must be given.",
          input: z
            .object({
              cardId: z.string().describe("Id of the card to edit"),
              title: z.string().min(1).optional(),
              description: z.string().optional(),
            })
            .refine((v) => v.title !== undefined || v.description !== undefined, { message: "provide title and/or description" }),
          guard: ({ cardId }, store) => requireCard(store, cardId),
        },
        removeCard: {
          displayName: "Delete a card",
          description: "Remove a card from the board by id.",
          input: z.object({ cardId: z.string().describe("Id of the card to remove") }),
          requiresApproval: true,
          guard: ({ cardId }, store) => requireCard(store, cardId),
          result: ({ cardId }) => ({ removed: cardId }),
        },
      }),
    }),
  ];
}

@Component({
  selector: "kanban-agent-panel",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="side">
      <div class="pill" [attr.data-status]="status().state">{{ status().state }}</div>
      <ul class="caps">
        @for (cap of capabilities(); track cap.name) {
          <li><code>{{ cap.name }}</code> {{ cap.kind }}@if (cap.requiresApproval) { (approval)}</li>
        }
      </ul>
      <ul class="activity">
        @for (a of activity(); track a.id) {
          <li [class]="a.direction">{{ a.label }} {{ a.detail }}</li>
        }
      </ul>
    </aside>
  `,
})
export class AgentPanelComponent {
  readonly status = injectSkailifyStatus();
  readonly capabilities = injectSkailifyCapabilities();
  readonly activity = injectSkailifyActivity();
}

@Component({
  selector: "kanban-board",
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [FilterStore],
  template: `
    <input class="search" [value]="filter.query()" (input)="filter.setQuery($any($event.target).value)" />
    <section class="board" aria-label="Kanban board">
      @for (col of columns(); track col.id) {
        <div class="column" [attr.data-column]="col.id">
          <h2>{{ col.title }}</h2>
          @for (card of col.cards; track card.id) {
            <article class="card" [attr.data-card]="card.id">
              <div class="card-title">{{ card.title }}</div>
              <button class="remove" (click)="remove(card.id)">Delete</button>
            </article>
          }
        </div>
      }
    </section>
  `,
})
export class KanbanBoardComponent {
  private readonly store = inject(Store);
  readonly filter = inject(FilterStore);
  private readonly cards = this.store.selectSignal(selectCards);
  readonly columns = computed(() => {
    const query = this.filter.query().toLowerCase();
    return COLUMNS.map((col) => ({
      ...col,
      cards: this.cards().filter((c) => c.columnId === col.id && c.title.toLowerCase().includes(query)),
    }));
  });

  constructor() {
    injectAgentView(() => ({
      id: "board",
      title: "Kanban board",
      state: { cards: this.cards().length, query: this.filter.query() },
    }));
    exposeSignalStore(this.filter, {
      name: "filter",
      methods: {
        setQuery: {
          displayName: "Filter the cards",
          description: "Show only the cards whose title contains the text; an empty text shows all.",
          kind: "effect",
          input: z.object({ query: z.string().describe("Text to look for in card titles") }),
          args: ["query"],
        },
        clear: { displayName: "Clear the filter", description: "Show all cards again.", kind: "effect" },
      },
    });
  }

  remove(cardId: string): void {
    this.store.dispatch(BoardActions.removeCard({ cardId }));
  }
}

@Component({
  selector: "kanban-app",
  imports: [KanbanBoardComponent, AgentPanelComponent],
  template: `<div class="app"><kanban-board /><kanban-agent-panel /></div>`,
})
export class KanbanAppComponent {}
