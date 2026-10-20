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

test("persists settings in the Rust core across a restart", async () => {
  instance = await launchXuvon();
  const dataDir = instance.dataDir;

  await instance.window.evaluate(() =>
    window.xuvon.settings.update({ theme: "dark", searchProvider: "brave" })
  );
  const before = await instance.window.evaluate(() => window.xuvon.bootstrap());
  expect(before.settings.theme).toBe("dark");
  expect(before.settings.searchProvider).toBe("brave");

  await shutdown(instance);
  instance = await launchXuvon({ dataDir });
  const after = await instance.window.evaluate(() => window.xuvon.bootstrap());
  expect(after.settings.theme).toBe("dark");
  expect(after.settings.searchProvider).toBe("brave");
});

test("rejects unknown search providers and invalid settings patches", async () => {
  instance = await launchXuvon();
  const { window: page } = instance;

  const unknownProvider = await page.evaluate(async () => {
    try {
      await window.xuvon.settings.update({ searchProvider: "not-a-provider" });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(unknownProvider).toBeTruthy();

  const invalidTheme = await page.evaluate(async () => {
    try {
      // @ts-expect-error deliberately invalid at the typed boundary
      await window.xuvon.settings.update({ theme: "neon" });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(invalidTheme).toBeTruthy();
});

test("honours session-only cookies in the normal profile", async () => {
  instance = await launchXuvon();
  const { window: page, app } = instance;

  await page.evaluate(() => window.xuvon.settings.update({ cookiePolicy: "session_only" }));
  await page.locator(".address-input").fill(`${server!.baseUrl}/private-data`);
  await page.locator(".address-input").press("Enter");

  await expect
    .poll(
      async () =>
        app.evaluate(async ({ session }, url) => {
          const cookies = await session
            .fromPartition("persist:xuvon-normal")
            .cookies.get({ url });
          return cookies.map((cookie) => ({
            name: cookie.name,
            session: cookie.session,
            expirationDate: cookie.expirationDate ?? null
          }));
        }, `${server!.baseUrl}/private-data`),
      { timeout: 20_000 }
    )
    .toContainEqual({ name: "xuvon_e2e", session: true, expirationDate: null });
});
