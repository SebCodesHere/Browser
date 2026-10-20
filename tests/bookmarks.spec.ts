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

test("creates, finds, lists, and removes a bookmark through the core", async () => {
  instance = await launchXuvon();
  const { window: page } = instance;
  const url = `${server!.baseUrl}/second`;

  const created = await page.evaluate(
    (target) => window.xuvon.bookmarks.create({ url: target, title: "Second Page" }),
    url
  );
  expect(created.id).toBeTruthy();
  expect(created.url).toBe(url);

  const found = await page.evaluate((target) => window.xuvon.bookmarks.find(target), url);
  expect(found?.title).toBe("Second Page");

  const listed = await page.evaluate(() => window.xuvon.bookmarks.list("second", undefined));
  expect(listed.some((bookmark) => bookmark.id === created.id)).toBe(true);

  await page.evaluate((id) => window.xuvon.bookmarks.remove(id), created.id);
  const after = await page.evaluate((target) => window.xuvon.bookmarks.find(target), url);
  expect(after).toBeNull();
});

test("renders the bookmarks page and toggles the toolbar star", async () => {
  instance = await launchXuvon();
  const { window: page } = instance;
  const url = `${server!.baseUrl}/`;

  await page.locator(".address-input").fill(url);
  await page.locator(".address-input").press("Enter");
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const bootstrap = await window.xuvon.bootstrap();
        const active = bootstrap.tabs.tabs.find((tab) => tab.id === bootstrap.tabs.activeTabId);
        return active?.title ?? "";
      })
    )
    .toBe("Xuvon Test Page");

  const star = page.getByRole("button", { name: "Bookmark this page" });
  await expect(star).toBeEnabled();
  await star.click();
  await expect(page.getByRole("button", { name: "Remove bookmark" })).toBeVisible();

  await page.evaluate(() =>
    window.xuvon.tabs.create({ internalUrl: "xuvon://bookmarks", activate: true })
  );
  await expect(page.locator(".bookmark-card")).toHaveCount(1);
  await expect(page.locator(".bookmark-card")).toContainText("Xuvon Test Page");
});

test("does not create bookmarks from private tabs", async () => {
  instance = await launchXuvon();
  const { window: page } = instance;

  await page.evaluate(() => window.xuvon.tabs.create({ mode: "private", activate: true }));
  const star = page.getByRole("button", { name: "Bookmark this page" });
  await expect(star).toBeDisabled();
});
