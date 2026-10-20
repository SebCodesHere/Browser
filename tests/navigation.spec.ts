import { expect, test } from "@playwright/test";
import { launchXuvon, shutdown, startServer, type LaunchedApp, type TestServer } from "./helpers";

let instance: LaunchedApp | null = null;
let server: TestServer | null = null;

test.beforeAll(async () => {
  server = await startServer();
});

test.afterEach(async () => {
  await shutdown(instance);
  instance = null;
});

test.afterAll(async () => {
  await server?.close();
  server = null;
});

test("navigates from the address bar and records exactly one normal-history visit", async () => {
  instance = await launchXuvon();
  const { window: page } = instance;
  const baseUrl = server!.baseUrl;

  await page.locator(".address-input").fill(`${baseUrl}/`);
  await page.locator(".address-input").press("Enter");

  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const bootstrap = await window.xuvon.bootstrap();
          const active = bootstrap.tabs.tabs.find((tab) => tab.id === bootstrap.tabs.activeTabId);
          return active?.title ?? "";
        }),
      { timeout: 20_000 }
    )
    .toBe("Xuvon Test Page");

  await expect
    .poll(async () =>
      page.evaluate(
        async (url) => (await window.xuvon.history.list(url, 10, 0)).entries.length,
        baseUrl
      )
    )
    .toBe(1);

  const entry = await page.evaluate(
    async (url) => (await window.xuvon.history.list(url, 10, 0)).entries[0],
    baseUrl
  );
  expect(entry.visitCount).toBe(1);
});

test("shows an error page for an unreachable host instead of a blank view", async () => {
  instance = await launchXuvon();
  const { window: page } = instance;

  await page.locator(".address-input").fill("http://127.0.0.1:1/");
  await page.locator(".address-input").press("Enter");

  await expect(page.locator(".error-card")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".error-card")).toContainText(/refused|couldn't|can't be reached/i);
  await expect(page.locator(".error-url")).toContainText("127.0.0.1:1");
});

test("blocks onion destinations before they reach the network stack", async () => {
  instance = await launchXuvon();
  const { window: page } = instance;

  const direct = await page.evaluate(async () => {
    const id = await window.xuvon.tabs.create({ activate: true });
    try {
      await window.xuvon.tabs.navigate(id, "http://duckduckgo.onion/");
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    } finally {
      await window.xuvon.tabs.close(id);
    }
  });
  expect(direct?.toLowerCase()).toContain("onion");
});
