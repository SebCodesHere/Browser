import { expect, test } from "@playwright/test";
import { launchXuvon, shutdown, type LaunchedApp } from "./helpers";

let instance: LaunchedApp | null = null;

test.afterEach(async () => {
  await shutdown(instance);
  instance = null;
});

test("fails closed when no Tor daemon is available", async () => {
  instance = await launchXuvon();
  const { window: page } = instance;

  const message = await page.evaluate(async () => {
    try {
      await window.xuvon.tor.setEnabled(true);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(message).toBeTruthy();
  expect(message).toMatch(/tor/i);

  const bootstrap = await page.evaluate(() => window.xuvon.bootstrap());
  expect(bootstrap.settings.torEnabled).toBe(false);
  expect(bootstrap.tor.status).not.toBe("available");
});

test("reports an unavailable circuit instead of pretending to proxy", async () => {
  instance = await launchXuvon();
  const { window: page } = instance;

  const state = await page.evaluate(() => window.xuvon.tor.check());
  expect(state.status).toBe("unavailable");
  expect(state.message).toBeTruthy();

  const torTab = await page.evaluate(async () => {
    try {
      await window.xuvon.tabs.create({ mode: "tor", activate: true });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(torTab).toBeTruthy();
});
