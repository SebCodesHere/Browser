import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launchXuvon, shutdown, type LaunchedApp } from "./helpers";

let instance: LaunchedApp | null = null;

test.afterEach(async () => {
  await shutdown(instance);
  instance = null;
});

function chromiumFixture(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xuvon-import-profile-"));
  fs.writeFileSync(
    path.join(directory, "Bookmarks"),
    JSON.stringify({
      roots: {
        bookmark_bar: {
          type: "folder",
          name: "Bookmarks bar",
          children: [
            {
              type: "url",
              name: "Xuvon Imported One",
              url: "https://example.com/one"
            },
            {
              type: "folder",
              name: "Imported folder",
              children: [
                {
                  type: "url",
                  name: "Xuvon Imported Two",
                  url: "https://example.org/two"
                }
              ]
            }
          ]
        }
      }
    })
  );
  fs.writeFileSync(
    path.join(directory, "Preferences"),
    JSON.stringify({
      homepage: "https://example.com/onboarding",
      homepage_is_newtabpage: false,
      session: { restore_on_startup: 5 }
    })
  );
  return directory;
}

test("onboards from a browser profile, imports bookmarks and settings, and remembers completion", async () => {
  const profile = chromiumFixture();
  instance = await launchXuvon({ onboarding: true });
  const { window: page, app, dataDir } = instance;

  await expect(page.locator(".welcome-hero")).toBeVisible();
  await expect(page.locator(".welcome-steps")).toContainText("Welcome");
  await page.getByRole("button", { name: "Set up Xuvon" }).click();
  await expect(page.locator(".welcome-panel")).toBeVisible();
  await expect(page.locator(".import-empty")).toBeVisible();

  await app.evaluate(async ({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, profile);

  await page.getByRole("button", { name: /Profile folder/ }).click();
  const source = page.locator('[data-testid="import-source"]').first();
  await expect(source).toBeVisible();
  await expect(source).toContainText("2 bookmarks");
  await expect(source.locator('input[type="checkbox"]')).toBeChecked();
  await expect(page.locator(".import-settings-field select")).not.toHaveValue("none");

  await page.getByRole("button", { name: /Import and continue/ }).click();
  await expect(page.locator('[data-testid="onboarding-results"]')).toBeVisible();
  await expect(page.locator('[data-testid="onboarding-results"]')).toContainText(
    "Your library is ready."
  );

  await page.getByRole("button", { name: "Start browsing" }).click();
  await expect(page.locator(".newtab")).toBeVisible();

  const bootstrap = await page.evaluate(() => window.xuvon.bootstrap());
  expect(bootstrap.onboardingCompleted).toBe(true);
  expect(bootstrap.settings.homepage).toBe("https://example.com/onboarding");
  expect(bootstrap.settings.startupBehavior).toBe("newtab");

  const bookmarks = await page.evaluate(() => window.xuvon.bookmarks.list("", undefined));
  expect(bookmarks.map((bookmark) => bookmark.title).sort()).toEqual([
    "Xuvon Imported One",
    "Xuvon Imported Two"
  ]);
  expect(bookmarks.find((bookmark) => bookmark.title === "Xuvon Imported Two")?.folder).toBe(
    "Bookmarks bar / Imported folder"
  );

  await shutdown(instance);
  instance = await launchXuvon({ dataDir, onboarding: true });
  await expect(instance.window.locator(".welcome-page")).toHaveCount(0);
  await expect(instance.window.locator(".newtab")).toBeVisible();

  await instance.window.evaluate(() =>
    window.xuvon.tabs.create({ internalUrl: "xuvon://settings", activate: true })
  );
  await instance.window.waitForSelector(".settings-page");
  const reopen = instance.window.getByRole("button", {
    name: /Import bookmarks & settings/
  });
  await reopen.scrollIntoViewIfNeeded();
  await reopen.click();
  await expect(instance.window.locator(".welcome-page")).toBeVisible();
});

test("detects a Chrome profile in the standard macOS home layout", async () => {
  test.skip(process.platform !== "darwin", "macOS profile layout test");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "xuvon-home-"));
  const profile = path.join(
    home,
    "Library",
    "Application Support",
    "Google",
    "Chrome",
    "Default"
  );
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(
    path.join(profile, "Bookmarks"),
    JSON.stringify({
      roots: {
        bookmark_bar: {
          type: "folder",
          name: "Bookmarks bar",
          children: [
            {
              type: "url",
              name: "Detected Chrome Bookmark",
              url: "https://example.com/detected"
            }
          ]
        }
      }
    })
  );
  fs.writeFileSync(
    path.join(profile, "Preferences"),
    JSON.stringify({
      homepage: "https://example.com/detected-home",
      homepage_is_newtabpage: false,
      session: { restore_on_startup: 5 }
    })
  );
  fs.writeFileSync(
    path.join(home, "Library", "Application Support", "Google", "Chrome", "Local State"),
    JSON.stringify({ profile: { info_cache: { Default: { name: "Person 1" } } } })
  );

  instance = await launchXuvon({
    onboarding: true,
    env: { HOME: home, XUVON_DETECT_BROWSERS: "1" }
  });
  const { window: page } = instance;
  await expect(page.locator(".welcome-hero")).toBeVisible();
  await page.getByRole("button", { name: "Set up Xuvon" }).click();
  await expect(page.locator(".welcome-panel")).toBeVisible();

  const source = page.locator('[data-testid="import-source"]').first();
  await expect(source).toBeVisible();
  await expect(source).toContainText("Google Chrome");
  await expect(source).toContainText("Person 1");
  await expect(source).toContainText("1 bookmark");
  await expect(page.locator(".import-settings-field select")).not.toHaveValue("none");

  await page.getByRole("button", { name: /Import and continue/ }).click();
  await expect(page.locator('[data-testid="onboarding-results"]')).toBeVisible();
  await page.getByRole("button", { name: "Start browsing" }).click();
  await expect(page.locator(".newtab")).toBeVisible();

  const bootstrap = await page.evaluate(() => window.xuvon.bootstrap());
  expect(bootstrap.settings.homepage).toBe("https://example.com/detected-home");
  const bookmarks = await page.evaluate(() => window.xuvon.bookmarks.list("", undefined));
  expect(bookmarks.map((bookmark) => bookmark.title)).toContain("Detected Chrome Bookmark");
});

test("imports a bookmarks HTML export chosen as a file", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xuvon-import-html-"));
  const file = path.join(directory, "bookmarks.html");
  fs.writeFileSync(
    file,
    `<!DOCTYPE NETSCAPE-Bookmark-file-1>
    <DL><p>
      <DT><H3>From another browser</H3>
      <DL><p>
        <DT><A HREF="https://example.net/html-one">HTML One</A>
        <DT><A HREF="https://example.net/html-two">HTML Two</A>
      </DL><p>
    </DL><p>`
  );

  instance = await launchXuvon({ onboarding: true });
  const { window: page, app } = instance;
  await expect(page.locator(".welcome-hero")).toBeVisible();
  await page.getByRole("button", { name: "Set up Xuvon" }).click();
  await expect(page.locator(".welcome-panel")).toBeVisible();

  await app.evaluate(async ({ dialog }, bookmarksFile) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [bookmarksFile]
    });
  }, file);

  await page.getByRole("button", { name: /Choose file/ }).click();
  const source = page.locator('[data-testid="import-source"]').first();
  await expect(source).toBeVisible();
  await expect(source).toContainText("2 bookmarks");
  await expect(source).toContainText("HTML export");

  await page.getByRole("button", { name: /Import and continue/ }).click();
  await expect(page.locator('[data-testid="onboarding-results"]')).toBeVisible();
  await page.getByRole("button", { name: "Start browsing" }).click();
  await expect(page.locator(".newtab")).toBeVisible();

  const bookmarks = await page.evaluate(() => window.xuvon.bookmarks.list("", undefined));
  expect(bookmarks.map((bookmark) => bookmark.url).sort()).toEqual([
    "https://example.net/html-one",
    "https://example.net/html-two"
  ]);
});

test("opens macOS Full Disk Access settings from onboarding", async () => {
  test.skip(process.platform !== "darwin", "Full Disk Access is macOS-only");
  instance = await launchXuvon({ onboarding: true });
  const { window: page, app } = instance;

  await expect(page.locator(".welcome-hero")).toBeVisible();
  await page.getByRole("button", { name: "Set up Xuvon" }).click();
  await expect(page.locator(".welcome-panel")).toBeVisible();

  // Opening the real pane would take over the desktop during tests. Stub only
  // the OS hand-off; the IPC validation and UI flow still run for real.
  await app.evaluate(({ shell }) => {
    const testGlobal = globalThis as typeof globalThis & {
      __xuvonExternalUrls?: string[];
    };
    testGlobal.__xuvonExternalUrls = [];
    (shell as unknown as {
      openExternal: (url: string) => Promise<void>;
    }).openExternal = async (url: string) => {
      testGlobal.__xuvonExternalUrls?.push(url);
    };
  });

  const button = page.getByTestId("allow-disk-access");
  await expect(button).toBeVisible();
  await expect(button).toContainText("Allow disk access");
  await button.click();

  const notice = page.getByTestId("disk-access-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(
    "macOS does not let an app grant this permission itself"
  );
  await expect(notice.getByRole("button", { name: /Check again/ })).toBeVisible();

  const urls = await app.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          __xuvonExternalUrls?: string[];
        }
      ).__xuvonExternalUrls ?? []
  );
  expect(urls).toEqual([
    "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
  ]);
});
