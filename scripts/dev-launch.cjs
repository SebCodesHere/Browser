// Manual launch helper: builds nothing, launches the packaged-mode app
// (dist/ + dist-electron/ + target/debug) and captures screenshots.
//
//   node scripts/dev-launch.cjs [shot-name] [route]
//
// Routes: newtab (default), settings, history, bookmarks, downloads, about.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("playwright");

const name = process.argv[2] ?? "newtab";
const route = process.argv[3] ?? name;
const outDir = path.join(__dirname, "..", "screenshots");
fs.mkdirSync(outDir, { recursive: true });

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "xuvon-shot-"));

async function main() {
  const app = await _electron.launch({
    args: ["."],
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      XUVON_DATA_DIR: dataDir,
      XUVON_E2E: "1"
    }
  });

  try {
    const errors = [];
    const window = await app.firstWindow();
    window.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    window.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

    await window.waitForSelector(".app-shell", { timeout: 30000 });

    if (route && route !== "newtab") {
      await window.evaluate((target) => {
        return window.xuvon.tabs.create({ internalUrl: `xuvon://${target}`, activate: true });
      }, route);
      await window.waitForTimeout(700);
    }

    await window.waitForTimeout(700);
    const shot = path.join(outDir, `${name}.png`);
    await window.screenshot({ path: shot });

    const state = await window.evaluate(async () => {
      const bootstrap = await window.xuvon.bootstrap();
      const theme = document.documentElement.dataset.theme ?? "?";
      const bodyRect = document.body.getBoundingClientRect();
      return {
        theme,
        body: { width: bodyRect.width, height: bodyRect.height },
        tabs: bootstrap.tabs.tabs.map((tab) => ({
          id: tab.id,
          url: tab.url,
          mode: tab.mode,
          active: tab.active,
          title: tab.title
        })),
        text: document.body.innerText.slice(0, 600)
      };
    });

    console.log(JSON.stringify({ shot, errors, state }, null, 2));
  } finally {
    await app.close().catch(() => undefined);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
