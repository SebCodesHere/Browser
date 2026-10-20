import fs from "node:fs";
import path from "node:path";
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

test("downloads a file through Chromium and records it in the Rust core", async () => {
  instance = await launchXuvon();
  const { window: page } = instance;
  const downloadsDir = server!.downloadsDir;

  await page.evaluate(
    (directory) =>
      window.xuvon.settings.update({ downloadDirectory: directory, askWhereToSave: false }),
    downloadsDir
  );

  await page.locator(".address-input").fill(`${server!.baseUrl}/download`);
  await page.locator(".address-input").press("Enter");

  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const items = await window.xuvon.downloads.list();
          const match = items.find((item) => item.filename === "xuvon-test.txt");
          return match ? { state: match.state, active: match.active, path: match.path } : null;
        }),
      { timeout: 30_000 }
    )
    .toMatchObject({ state: "completed", active: false });

  const recorded = await page.evaluate(async () => {
    const items = await window.xuvon.downloads.list();
    return items.find((item) => item.filename === "xuvon-test.txt") ?? null;
  });
  expect(recorded?.path).toBe(path.join(downloadsDir, "xuvon-test.txt"));
  expect(fs.existsSync(recorded!.path)).toBe(true);
  expect(fs.readFileSync(recorded!.path, "utf8")).toBe("downloaded by xuvon test");

  await page.evaluate(() =>
    window.xuvon.tabs.create({ internalUrl: "xuvon://downloads", activate: true })
  );
  await expect(page.locator(".download-card")).toHaveCount(1);
  await expect(page.locator(".download-card")).toContainText("xuvon-test.txt");
  await expect(page.locator(".download-state")).toContainText(/completed/i);

  await page.evaluate(() => window.xuvon.downloads.clearFinished());
  await expect
    .poll(async () => page.evaluate(async () => (await window.xuvon.downloads.list()).length))
    .toBe(0);
});
