import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron, expect, test } from "@playwright/test";
import { projectRoot } from "./helpers";

// Runs only when a packaged build exists (npm run package:dir) or when
// XUVON_PACKAGED_APP points at the executable. This verifies that the bundled
// Rust sidecar is found through process.resourcesPath.

function resolvePackagedExecutable(): string | null {
  const override = process.env.XUVON_PACKAGED_APP;
  if (override && fs.existsSync(override)) return override;

  const releaseDir = path.join(projectRoot, "release");
  if (!fs.existsSync(releaseDir)) return null;

  const candidates: string[] = [];
  for (const entry of fs.readdirSync(releaseDir)) {
    if (!entry.startsWith("mac")) continue;
    candidates.push(
      path.join(releaseDir, entry, "Xuvon Browser.app", "Contents", "MacOS", "Xuvon Browser")
    );
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

const executable = resolvePackagedExecutable();

test.describe("packaged build", () => {
  test.skip(!executable, "No packaged app found. Run `npm run package:dir` first.");
  test.setTimeout(120_000);

  test("boots with the bundled Rust core", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "xuvon-packaged-"));

    const app = await _electron.launch({
      executablePath: executable!,
      env: {
        ...process.env,
        XUVON_DATA_DIR: dataDir,
        XUVON_E2E: "1",
        XUVON_DETECT_BROWSERS: "0"
      }
    });

    try {
      const page = await app.firstWindow();
      await page.waitForSelector(".app-shell", { timeout: 60_000 });

      await page.evaluate(async () => {
        const boot = await window.xuvon.bootstrap();
        if (boot.onboardingCompleted) return;
        await window.xuvon.onboarding.complete();
        const welcome = boot.tabs.tabs.find((tab) => tab.internalUrl === "xuvon://welcome");
        if (welcome) await window.xuvon.tabs.navigate(welcome.id, "xuvon://newtab");
      });
      const bootstrap = await page.evaluate(() => window.xuvon.bootstrap());
      expect(bootstrap.app.name).toBe("Xuvon Browser");
      expect(bootstrap.tabs.tabs).toHaveLength(1);
      expect(bootstrap.settings.searchProvider).toBe("duckduckgo");
      await expect(page.locator(".newtab")).toBeVisible();
    } finally {
      await app.close().catch(() => undefined);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
