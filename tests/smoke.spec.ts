import { expect, test } from "@playwright/test";
import { launchXuvon, shutdown, type LaunchedApp } from "./helpers";

let instance: LaunchedApp | null = null;

test.afterEach(async () => {
  await shutdown(instance);
  instance = null;
});

test("boots to the new tab page with a working Rust core", async () => {
  instance = await launchXuvon();
  const { window: page } = instance;

  await expect(page.locator(".newtab")).toBeVisible();
  await expect(page.locator(".newtab-hero h1")).toBeVisible();
  await expect(page.locator(".hero-search")).toBeVisible();

  const bootstrap = await page.evaluate(() => window.xuvon.bootstrap());
  expect(bootstrap.app.name).toBe("Xuvon Browser");
  expect(bootstrap.app.platform).toBe(process.platform);
  expect(bootstrap.tabs.tabs).toHaveLength(1);
  expect(bootstrap.tabs.tabs[0].internalUrl).toBe("xuvon://newtab");
  expect(bootstrap.settings.searchProvider).toBe("duckduckgo");
  expect(bootstrap.providers.length).toBeGreaterThanOrEqual(4);
});

test("renders every internal page without renderer errors", async () => {
  instance = await launchXuvon();
  const { window: page } = instance;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const pages: Array<[string, string, string]> = [
    ["xuvon://settings", ".settings-page", "Settings"],
    ["xuvon://history", ".internal-scroll", "History"],
    ["xuvon://bookmarks", ".internal-scroll", "Bookmarks"],
    ["xuvon://downloads", ".internal-scroll", "Downloads"],
    ["xuvon://about", ".about-hero", "Xuvon Browser"]
  ];

  for (const [route, selector, heading] of pages) {
    await page.evaluate(
      (target) => window.xuvon.tabs.create({ internalUrl: target, activate: true }),
      route
    );
    await expect(page.locator(selector)).toBeVisible();
    await expect(page.locator(".page-heading h1")).toHaveText(heading);
  }

  expect(errors).toEqual([]);
});

test("switches settings theme from the renderer without reloading", async () => {
  instance = await launchXuvon();
  const { window: page } = instance;

  await page.evaluate(() =>
    window.xuvon.tabs.create({ internalUrl: "xuvon://settings", activate: true })
  );
  await expect(page.locator(".settings-page")).toBeVisible();
  await page.evaluate(() => window.xuvon.settings.update({ theme: "light" }));
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const bootstrap = await page.evaluate(() => window.xuvon.bootstrap());
  expect(bootstrap.settings.theme).toBe("dark");
});
