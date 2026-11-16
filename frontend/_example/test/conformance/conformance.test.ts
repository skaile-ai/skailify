// SPDX-License-Identifier: Apache-2.0

import { describe, it } from "bun:test";
import { registerAppConformance } from "@skaile/workspaces/app-sdk/testing";
import { createExampleApp } from "../../src/index.ts";

registerAppConformance(
  { describe, it },
  {
    title: "example adapter conformance",
    connect: async (gateway) => {
      const app = createExampleApp({
        transport: gateway.transport(),
        reconnect: { baseMs: 10, maxMs: 50 },
      });
      await app.connect();
      return app;
    },
    view: { name: "app.example.open", input: { id: "r1" } },
    principal: { name: "app.example.whoami" },
  },
);
