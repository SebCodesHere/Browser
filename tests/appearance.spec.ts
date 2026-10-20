import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launchXuvon, shutdown, type LaunchedApp } from "./helpers";

let instance: LaunchedApp | null = null;

// A 1x1 transparent PNG, enough to prove the custom protocol serves bytes.
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test.afterEach(async () => {
  await shutdown(instance);
  instance = null;
});

test("applies preset and custom accent themes", async () => {
  instance = await launchXuvon();
  const { window: page } = instance;

  await page.evaluate(() =>
    window.xuvon.settings.update({ theme: "dark", accentTheme: "peach" })
  );
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe("dark");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.accent))
    .toBe("peach");
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()
  );
  expect(accent.toLowerCase()).toBe("#ffd3be");

  await page.evaluate(() =>
    window.xuvon.settings.update({ accentTheme: "custom", accentColor: "#FF3366" })
  );
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.accent))
    .toBe("custom");
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--accent-custom")
          .trim()
          .toLowerCase()
      )
    )
    .toBe("#ff3366");

  const invalidColor = await page.evaluate(async () => {
    try {
      await window.xuvon.settings.update({ accentColor: "red" });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(invalidColor).toBeTruthy();
});

test("renders preset wallpapers and serves custom images through xuvon-asset", async () => {
  instance = await launchXuvon();
  const { window: page, dataDir } = instance;
  const name = "wallpaper-e2e.png";
  const wallpaperDir = path.join(dataDir, "wallpapers");
  fs.mkdirSync(wallpaperDir, { recursive: true });
  fs.writeFileSync(path.join(wallpaperDir, name), Buffer.from(TINY_PNG, "base64"));

  await page.evaluate(() => window.xuvon.settings.update({ wallpaperId: "aurora" }));
  await expect(page.locator('.newtab-wallpaper[data-wallpaper="aurora"]')).toHaveCount(1);

  await page.evaluate(
    (wallpaperName) =>
      window.xuvon.settings.update({
        wallpaperId: "custom",
        wallpaperPath: wallpaperName
      }),
    name
  );
  await expect(page.locator('.newtab-wallpaper[data-wallpaper="custom"]')).toHaveCount(1);

  const backgroundImage = await page
    .locator(".newtab-wallpaper")
    .evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(backgroundImage).toContain(`xuvon-asset://wallpaper/${name}`);

  const imageLoaded = await page.evaluate(async (wallpaperName) => {
    const image = new Image();
    const result = new Promise<boolean>((resolve) => {
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      window.setTimeout(() => resolve(false), 5000);
    });
    image.src = `xuvon-asset://wallpaper/${encodeURIComponent(wallpaperName)}`;
    return result;
  }, name);
  expect(imageLoaded).toBe(true);

  const rejected = await page.evaluate(async () => {
    try {
      await window.xuvon.settings.update({
        wallpaperId: "custom",
        wallpaperPath: "../../etc/passwd"
      });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(rejected).toBeTruthy();
});

test("imports and removes a custom wallpaper through the picker flow", async () => {
  instance = await launchXuvon();
  const { window: page, app, dataDir } = instance;
  const source = path.join(dataDir, "picked-wallpaper.png");
  fs.writeFileSync(source, Buffer.from(TINY_PNG, "base64"));

  // Stub only the native dialog. The copy, validation, settings update, and
  // deletion below run through the real IPC and main-process code paths.
  await app.evaluate(async ({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, source);

  const bundle = await page.evaluate(() => window.xuvon.app.chooseWallpaper());
  expect(bundle?.settings.wallpaperId).toBe("custom");
  const wallpaperName = bundle!.settings.wallpaperPath;
  expect(wallpaperName).toMatch(/^wallpaper-[0-9a-f-]+\.png$/);

  const copied = path.join(dataDir, "wallpapers", wallpaperName);
  expect(fs.existsSync(copied)).toBe(true);
  expect(fs.readFileSync(copied).equals(Buffer.from(TINY_PNG, "base64"))).toBe(true);
  expect(fs.existsSync(source)).toBe(true);

  await expect(page.locator('.newtab-wallpaper[data-wallpaper="custom"]')).toHaveCount(1);
  const imageLoaded = await page.evaluate(async (wallpaper) => {
    const image = new Image();
    const result = new Promise<boolean>((resolve) => {
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      window.setTimeout(() => resolve(false), 5000);
    });
    image.src = `xuvon-asset://wallpaper/${encodeURIComponent(wallpaper)}`;
    return result;
  }, wallpaperName);
  expect(imageLoaded).toBe(true);

  await page.evaluate(() => window.xuvon.app.removeWallpaper());
  await expect
    .poll(() =>
      page.evaluate(async () => (await window.xuvon.bootstrap()).settings.wallpaperId)
    )
    .toBe("none");
  await expect.poll(() => fs.existsSync(copied)).toBe(false);
});

test("exposes appearance controls and the AI authorship disclosure", async () => {
  instance = await launchXuvon();
  const { window: page } = instance;

  await page.evaluate(() =>
    window.xuvon.tabs.create({ internalUrl: "xuvon://settings", activate: true })
  );
  await page.waitForSelector(".settings-nav");
  await expect(page.locator(".accent-option")).toHaveCount(7);
  await expect(page.locator(".wallpaper-option")).toHaveCount(5);

  await page.getByRole("button", { name: "Aurora" }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => (await window.xuvon.bootstrap()).settings.wallpaperId)
    )
    .toBe("aurora");

  await page.evaluate(() =>
    window.xuvon.tabs.create({ internalUrl: "xuvon://about", activate: true })
  );
  await page.waitForSelector(".ai-disclosure");
  await expect(page.locator(".ai-disclosure")).toContainText("Made with AI");
  await expect(page.locator(".ai-disclosure")).toContainText(/vibecoded/i);
  await expect(page.locator(".about-signoff")).toContainText("Made with love by Seb <3");
});
