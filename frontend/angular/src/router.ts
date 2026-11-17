// SPDX-License-Identifier: Apache-2.0

/**
 * `@skaile/skailify-angular/router`: the agent's `list_views` and `navigate` over the Angular Router.
 *
 * ```ts
 * provideSkailify({
 *   appId: "kanban",
 *   navigation: routerNavigation([
 *     { id: "board", title: "Board", path: "" },
 *     { id: "card", title: "Card", path: "cards/:cardId", menu: false, params: { cardId: "the card to open" } },
 *   ]),
 * });
 * ```
 */
import { inject } from "@angular/core";
import { Router } from "@angular/router";
import type { Navigation, ViewDescriptor } from "./capabilities";

/** A view the agent may show, and the route that shows it. */
export interface RouteView extends ViewDescriptor {
  /**
   * The view's full path from the root, without the leading slash: `cards/:cardId`. For a child route, join the paths
   * of its parents: `orders` with a child `:orderId` is `orders/:orderId`. Each `:name` is filled from the parameter of
   * that name; parameters not in the path become query parameters.
   */
  path: string;
}

/** A navigation over the app's `Router`; pass it as `navigation` to `provideSkailify`. */
export function routerNavigation(views: readonly RouteView[]): () => Navigation {
  return () => {
    const router = inject(Router);
    return {
      views: () => views.map(({ path: _path, ...descriptor }) => descriptor),
      navigate: async (viewId, params) => {
        const view = views.find((v) => v.id === viewId);
        if (!view) throw new Error(`no view ${viewId}`);
        const segments = split(view.path);
        const inPath = new Set(segments.filter((s) => s.startsWith(":")).map((s) => s.slice(1)));
        const missing = [...inPath].filter((name) => !params[name]);
        if (missing.length) throw new Error(`view ${viewId} needs ${missing.join(", ")}`);
        const queryParams = Object.fromEntries(Object.entries(params).filter(([name]) => !inPath.has(name)));
        const tree = router.createUrlTree(["/", ...segments.map((s) => (s.startsWith(":") ? params[s.slice(1)] : s))], {
          queryParams,
        });
        const navigated = await router.navigateByUrl(tree);
        // false also when the URL is already on screen (onSameUrlNavigation "ignore"): that is not a failure
        if (!navigated && router.url !== router.serializeUrl(tree)) throw new Error(`navigation to ${router.serializeUrl(tree)} was cancelled (a guard, or a newer navigation)`);
      },
      current: () => {
        // the primary outlet's segments, without matrix params, query or fragment
        const path = (router.parseUrl(router.url).root.children["primary"]?.segments ?? []).map((s) => s.path);
        // of several matching views the most specific wins: cards/new before cards/:cardId, whatever the order
        let best: { id: string; params: number } | undefined;
        for (const v of views) {
          const pattern = split(v.path);
          if (!matches(pattern, path)) continue;
          const params = pattern.filter((s) => s.startsWith(":")).length;
          if (!best || params < best.params) best = { id: v.id, params };
        }
        return best?.id;
      },
    };
  };
}

function split(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

function matches(pattern: string[], path: string[]): boolean {
  return pattern.length === path.length && pattern.every((s, i) => s.startsWith(":") || s === path[i]);
}
