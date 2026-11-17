// SPDX-License-Identifier: Apache-2.0

// The app SDK's conformance checks, against a client wired the Angular way: provideSkailify, the Router navigation
// and an action offered from a component.
import { describe, it } from "bun:test";
import { Component, provideZonelessChangeDetection } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter, RouterOutlet } from "@angular/router";
import { noopLogger } from "@skaile/workspaces/app-sdk";
import { registerAppConformance } from "@skaile/workspaces/app-sdk/testing";
import * as z from "zod";
import { injectAgentAction, provideSkailify, SKAILIFY } from "../../src/index.ts";
import { routerNavigation } from "../../src/router.ts";

@Component({ selector: "t-page", template: `<p>page</p>` })
class PageComponent {}

@Component({ selector: "t-app", imports: [RouterOutlet], template: `<router-outlet />` })
class AppComponent {
  constructor() {
    injectAgentAction({
      name: "session.whoami",
      description: "Report who set off the current turn.",
      input: z.object({}),
      kind: "query",
      handler: async (_args, ctx) => ({ principal: ctx.principal }),
    });
  }
}

registerAppConformance(
  { describe, it },
  {
    title: "angular adapter conformance",
    connect: async (gateway) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideZonelessChangeDetection(),
          provideRouter([
            { path: "", component: PageComponent },
            { path: "cards/:cardId", component: PageComponent },
          ]),
          provideSkailify({
            appId: "kanban",
            transport: gateway.transport(),
            reconnect: { baseMs: 10, maxMs: 50 },
            settleTimeoutMs: 500,
            logger: noopLogger,
            navigation: routerNavigation([
              { id: "board", title: "Board", path: "" },
              { id: "card", title: "Card", path: "cards/:cardId", menu: false, params: { cardId: "the card to show" } },
            ]),
          }),
        ],
      });
      TestBed.createComponent(AppComponent).autoDetectChanges();
      const client = TestBed.inject(SKAILIFY);
      await client.start();
      return client;
    },
    view: { name: "app.navigate", input: { view: "card", params: { cardId: "card-1" } } },
    principal: { name: "app.session.whoami" },
    effectClasses: { "app.navigate": "routine" },
  },
);
