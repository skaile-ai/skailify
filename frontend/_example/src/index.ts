// SPDX-License-Identifier: Apache-2.0

// A minimal adapter: one capability that changes the view and one that
// reports who invoked it. It exists to exercise the adapter CI workflow.
import {
  type AppTransport,
  createSkaileApp,
  defineAppCapability,
  type ReconnectOptions,
  type SkaileApp,
} from "@skaile/workspaces/app-sdk";
import * as z from "zod";

export interface ExampleAppOptions {
  transport: AppTransport;
  reconnect?: ReconnectOptions | false;
}

export function createExampleApp(options: ExampleAppOptions): SkaileApp {
  const app = createSkaileApp({
    appId: "example",
    transport: options.transport,
    reconnect: options.reconnect,
  });

  app.registerCapability(
    defineAppCapability({
      name: "app.example.open",
      description: "Open a record in the example view.",
      input: z.object({ id: z.string() }),
      kind: "effect",
      handler: async ({ id }) => {
        app.loading("opening record");
        app.reportView({ viewId: `record/${id}`, title: `Record ${id}` });
        app.settled();
        return { opened: id };
      },
    }),
  );

  app.registerCapability(
    defineAppCapability({
      name: "app.example.whoami",
      description: "Report who set off the current turn.",
      input: z.object({}),
      kind: "query",
      handler: async (_args, ctx) => ({ principal: ctx.principal }),
    }),
  );

  return app;
}
