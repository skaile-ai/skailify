// SPDX-License-Identifier: Apache-2.0

import { afterEach, expect, test } from "bun:test";
import { createFakeGateway, type FakeGateway } from "@skaile/workspaces/app-sdk/testing";
import { createExampleApp } from "../../src/index.ts";

let gateway: FakeGateway | undefined;

afterEach(async () => {
  await gateway?.close();
});

test("opening a record reports its view", async () => {
  gateway = createFakeGateway();
  const app = createExampleApp({ transport: gateway.transport(), reconnect: false });
  await app.connect();

  const result = await gateway.invoke("app.example.open", { id: "r7" });
  const view = await gateway.waitForSettled();

  expect(result).toEqual({ opened: "r7" });
  expect(view.report?.viewId).toBe("record/r7");
  await app.close();
});
