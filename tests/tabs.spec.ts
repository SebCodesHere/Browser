import { expect, test } from "@playwright/test";
import { launchXuvon, shutdown, type LaunchedApp } from "./helpers";

let instance: LaunchedApp | null = null;

test.afterEach(async () => {
  await shutdown(instance);
  instance = null;
});

test("creates, activates, closes, and reopens tabs", async () => {
  instance = await launchXuvon();
  const { window: page } = instance;

  await expect(page.locator(".browser-tab")).toHaveCount(1);

  const historyId = await page.evaluate(() =>
    window.xuvon.tabs.create({ internalUrl: "xuvon://history", activate: true })
  );
  await expect(page.locator(".browser-tab")).toHaveCount(2);
  await expect(page.locator(".browser-tab.is-active")).toContainText("History");

  await page.locator(".browser-tab.is-active .tab-close").click();
  await expect(page.locator(".browser-tab")).toHaveCount(1);

  await page.evaluate(() => window.xuvon.tabs.reopenClosed());
  await expect(page.locator(".browser-tab")).toHaveCount(2);

  const tabs = await page.evaluate(async () => (await window.xuvon.bootstrap()).tabs.tabs);
  expect(tabs.map((tab) => tab.internalUrl)).toContain("xuvon://history");
  expect(tabs.some((tab) => tab.id === historyId)).toBe(false);
});

test("keeps private tabs isolated from the normal session", async () => {
  instance = await launchXuvon();
  const { window: page } = instance;

  const privateId = await page.evaluate(() =>
    window.xuvon.tabs.create({ mode: "private", activate: true })
  );
  const state = await page.evaluate(async () => (await window.xuvon.bootstrap()).tabs.tabs);
  const privateTab = state.find((tab) => tab.id === privateId);
  expect(privateTab?.mode).toBe("private");
  expect(privateTab?.favicon).toBeNull();
  await expect(page.locator(".address-shell.mode-private")).toBeVisible();

  await page.evaluate((id) => window.xuvon.tabs.close(id), privateId);
  await expect(page.locator(".address-shell.mode-private")).toHaveCount(0);
  await expect
    .poll(async () =>
      page.evaluate(async () =>
        (await window.xuvon.bootstrap()).tabs.tabs.some((tab) => tab.mode === "private")
      )
    )
    .toBe(false);
});

test("rejects invalid tab creation input at the IPC boundary", async () => {
  instance = await launchXuvon();
  const { window: page } = instance;

  const message = await page.evaluate(async () => {
    try {
      await window.xuvon.tabs.create({ mode: "tor", activate: true });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(message).toContain("Tor");
});
