// SPDX-License-Identifier: Apache-2.0

/** The board's filter, as an NgRx SignalStore: what the user typed in the search box. */
import { patchState, signalStore, withMethods, withState } from "@ngrx/signals";

export const FilterStore = signalStore(
  withState({ query: "" }),
  withMethods((store) => ({
    setQuery(query: string): void {
      patchState(store, { query });
    },
    clear(): void {
      patchState(store, { query: "" });
    },
  })),
);
