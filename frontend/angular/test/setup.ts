// SPDX-License-Identifier: Apache-2.0

// A DOM and Angular's JIT compiler for the tests: the components compile at runtime.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
await import("@angular/compiler");
const { getTestBed } = await import("@angular/core/testing");
const { BrowserTestingModule, platformBrowserTesting } = await import("@angular/platform-browser/testing");
getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting(), { teardown: { destroyAfterEach: true } });
