import { expect, test } from "@playwright/test";
import {
  launchXuvon,
  shutdown,
  startServer,
  type LaunchedApp,
  type TestServer
} from "./helpers";

let instance: LaunchedApp | null = null;
let server: TestServer | null = null;

test.beforeAll(async () => {
  server = await startServer();
});

test.beforeEach(() => {
  if (server) server.requests.length = 0;
});

test.afterEach(async () => {
  await shutdown(instance);
  instance = null;
});

test.afterAll(async () => {
  await server?.close();
  server = null;
});

async function activeTab(page: LaunchedApp["window"]) {
  return page.evaluate(async () => {
    const bootstrap = await window.xuvon.bootstrap();
    return bootstrap.tabs.tabs.find((tab) => tab.id === bootstrap.tabs.activeTabId) ?? null;
  });
}

async function navigate(page: LaunchedApp["window"], url: string): Promise<void> {
  await page.locator(".address-input").fill(url);
  await page.locator(".address-input").press("Enter");
}

async function scriptResult(
  app: LaunchedApp["app"],
  url: string,
  script: string
): Promise<unknown> {
  return app.evaluate(
    async ({ webContents }, input) => {
      const target = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL() === input.url);
      if (!target) return "missing-web-contents";
      return target.executeJavaScript(input.script);
    },
    { url, script }
  );
}

test("blocks bundled ad and tracker requests before they reach the network", async () => {
  instance = await launchXuvon();
  const { window: page, app } = instance;
  const target = `${server!.baseUrl}/adblock-test`;

  await navigate(page, target);

  await expect
    .poll(async () => (await activeTab(page))?.blockedCount ?? 0, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);
  await expect.poll(() => server!.requests.includes("/app.js"), { timeout: 20_000 }).toBe(true);
  expect(server!.requests).not.toContain("/pagead/banner.js");
  expect(server!.requests).not.toContain("/pixel.gif");

  expect(await scriptResult(app, target, "Boolean(window.__xuvonAppLoaded)")).toBe(true);
  expect(await scriptResult(app, target, "Boolean(window.__xuvonAdLoaded)")).toBe(false);

  await expect(page.locator(".shield-badge")).toHaveText(/\d+/);
  await page.locator(".shield-button").click();
  const panel = page.locator(".shield-panel");
  await expect(panel).toBeVisible();
  await expect(page.locator(".shield-site-host")).toHaveText("127.0.0.1");
  await expect(page.locator(".shield-site-count")).toContainText("This tab");
  await expect(page.locator(".shield-site-row .toggle")).toHaveAttribute("aria-checked", "true");

  // The panel must reserve layout space beside the native web view; an HTML
  // overlay here would be covered by Chromium's WebContentsView.
  const viewport = await page.locator(".browser-viewport").boundingBox();
  const panelBox = await panel.boundingBox();
  expect(viewport).not.toBeNull();
  expect(panelBox).not.toBeNull();
  expect(viewport!.x + viewport!.width).toBeLessThanOrEqual(panelBox!.x + 1);

  // Also inspect the native child view, not just the renderer layout. This is
  // the actual z-order boundary that hid the old HTML popover.
  const nativeBounds = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win.contentView.children.map((child) => child.getBounds());
  });
  expect(nativeBounds.length).toBeGreaterThan(0);
  for (const bounds of nativeBounds) {
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(panelBox!.x + 1);
  }
});

test("subresource-only patterns do not block a matching top-level document", async () => {
  instance = await launchXuvon();
  const { window: page, app } = instance;
  const target = `${server!.baseUrl}/pagead/landing`;

  await navigate(page, target);

  await expect
    .poll(() => server!.requests.includes("/pagead/landing"), { timeout: 20_000 })
    .toBe(true);
  await expect.poll(() => server!.requests.includes("/app.js"), { timeout: 20_000 }).toBe(true);
  expect(server!.requests).not.toContain("/pagead/banner.js");
  expect(await scriptResult(app, target, "Boolean(window.__xuvonAppLoaded)")).toBe(true);
  expect(await scriptResult(app, target, "Boolean(window.__xuvonAdLoaded)")).toBe(false);
  await expect
    .poll(async () => (await activeTab(page))?.blockedCount ?? 0, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(1);
});

test("pausing the shield for one site allows that site's ad requests after reload", async () => {
  instance = await launchXuvon();
  const { window: page, app } = instance;
  const target = `${server!.baseUrl}/adblock-test`;

  await navigate(page, target);
  await expect
    .poll(async () => (await activeTab(page))?.blockedCount ?? 0, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);

  await page.locator(".shield-button").click();
  const siteToggle = page.locator(".shield-site-row .toggle");
  await expect(siteToggle).toHaveAttribute("aria-checked", "true");
  await siteToggle.click();

  await expect
    .poll(() =>
      page.evaluate(async () => (await window.xuvon.bootstrap()).settings.adblockAllowlist)
    )
    .toContain("127.0.0.1");

  await page.evaluate(async () => {
    const bootstrap = await window.xuvon.bootstrap();
    if (bootstrap.tabs.activeTabId) {
      await window.xuvon.tabs.reload(bootstrap.tabs.activeTabId);
    }
  });

  await expect
    .poll(() => server!.requests.includes("/pagead/banner.js"), { timeout: 20_000 })
    .toBe(true);
  expect(server!.requests).toContain("/pixel.gif");
  expect(await scriptResult(app, target, "Boolean(window.__xuvonAdLoaded)")).toBe(true);
  await expect
    .poll(async () => (await activeTab(page))?.blockedCount ?? 0)
    .toBe(0);
});

test("privacy settings disclose the supported syntax, limits, and list attribution", async () => {
  instance = await launchXuvon();
  const { window: page } = instance;

  await page.evaluate(() =>
    window.xuvon.tabs.create({ internalUrl: "xuvon://settings", activate: true })
  );
  await page.waitForSelector(".settings-nav");
  await page.getByRole("button", { name: "Privacy" }).click();

  const disclosure = page.locator(".adblock-syntax");
  await expect(disclosure).toContainText("Supported rule syntax, lists, and limits");
  await disclosure.locator("summary").click();
  await expect(disclosure).toContainText("Supported");
  await expect(disclosure).toContainText("$domain=example.com|~shop.example.com");
  await expect(disclosure).toContainText("Not supported");
  await expect(disclosure).toContainText("Full EasyList, uBlock Origin, or Adblock Plus compatibility");
  await expect(disclosure).toContainText("original Xuvon data");
  await expect(disclosure).toContainText("EasyList and uBlock Origin list data are not bundled");
  await expect(disclosure).toContainText("Xuvon does not download filter lists");
});

test("disabling the blocker globally lets ad requests through", async () => {
  instance = await launchXuvon();
  const { window: page, app } = instance;
  const target = `${server!.baseUrl}/adblock-test`;

  await page.evaluate(() => window.xuvon.settings.update({ adblockEnabled: false }));
  await navigate(page, target);

  await expect
    .poll(() => server!.requests.includes("/pagead/banner.js"), { timeout: 20_000 })
    .toBe(true);
  expect(await scriptResult(app, target, "Boolean(window.__xuvonAdLoaded)")).toBe(true);
  await expect
    .poll(async () => (await activeTab(page))?.blockedCount ?? 0)
    .toBe(0);

  await page.locator(".shield-button").click();
  await expect(page.locator(".shield-status-copy")).toContainText("Turned off everywhere");
  await expect(page.locator(".shield-global-row .toggle")).toHaveAttribute("aria-checked", "false");
});
