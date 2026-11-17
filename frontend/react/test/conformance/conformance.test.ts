// SPDX-License-Identifier: Apache-2.0

import { describe, it } from "bun:test";
import { noopLogger } from "@skaile/workspaces/app-sdk";
import { registerAppConformance } from "@skaile/workspaces/app-sdk/testing";
import * as z from "zod";
import { createSkailify } from "../../src/index.ts";

registerAppConformance(
  { describe, it },
  {
    title: "react adapter conformance",
    connect: async (gateway) => {
      let current = "board";
      const skailify = createSkailify({
        appId: "kanban",
        transport: gateway.transport(),
        reconnect: { baseMs: 10, maxMs: 50 },
        settleTimeoutMs: 500,
        logger: noopLogger,
        navigation: {
          views: () => [
            { id: "board", title: "Board" },
            { id: "card", title: "Card", menu: false, params: { cardId: "the card to show" } },
          ],
          navigate: (view) => {
            current = view;
          },
          current: () => current,
        },
      });
      skailify.registerAction({
        name: "session.whoami",
        description: "Report who set off the current turn.",
        input: z.object({}),
        kind: "query",
        handler: async (_args, ctx) => ({ principal: ctx.principal }),
      });
      await skailify.start();
      return skailify;
    },
    view: { name: "app.navigate", input: { view: "card", params: { cardId: "card-1" } } },
    principal: { name: "app.session.whoami" },
    effectClasses: { "app.navigate": "routine" },
  },
);
