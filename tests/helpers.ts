import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { _electron, type ElectronApplication, type Page } from "@playwright/test";

export const projectRoot = path.resolve(__dirname, "..");

export interface LaunchedApp {
  app: ElectronApplication;
  window: Page;
  dataDir: string;
}

export interface LaunchOptions {
  dataDir?: string;
  env?: Record<string, string>;
  /** Keep the first-run welcome page open for onboarding tests. */
  onboarding?: boolean;
}

export async function launchXuvon(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const dataDir = options.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "xuvon-e2e-"));
  const app = await _electron.launch({
    args: [projectRoot],
    cwd: projectRoot,
    env: {
      ...process.env,
      XUVON_DATA_DIR: dataDir,
      XUVON_E2E: "1",
      XUVON_DETECT_BROWSERS: "0",
      ...options.env
    }
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".app-shell", { timeout: 45_000 });
  if (!options.onboarding) {
    // Most tests are about the browser, not first-run setup. Complete the
    // onboarding marker through the real IPC path and return the welcome tab
    // to a normal new tab.
    await page.evaluate(async () => {
      const boot = await window.xuvon.bootstrap();
      if (boot.onboardingCompleted) return;
      await window.xuvon.onboarding.complete();
      const welcome = boot.tabs.tabs.find((tab) => tab.internalUrl === "xuvon://welcome");
      if (welcome) await window.xuvon.tabs.navigate(welcome.id, "xuvon://newtab");
    });
    await page.waitForFunction(async () => {
      const boot = await window.xuvon.bootstrap();
      const active = boot.tabs.tabs.find((tab) => tab.id === boot.tabs.activeTabId);
      return !active?.internalUrl || active.internalUrl !== "xuvon://welcome";
    });
  }
  return { app, window: page, dataDir };
}

export async function shutdown(instance: LaunchedApp | null): Promise<void> {
  if (!instance) return;
  await instance.app.close().catch(() => undefined);
}

export interface TestServer {
  baseUrl: string;
  downloadsDir: string;
  requests: string[];
  close(): Promise<void>;
}

export async function startServer(): Promise<TestServer> {
  const downloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "xuvon-downloads-"));
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push(url.pathname);
    if (url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        "<!doctype html><html><head><title>Xuvon Test Page</title></head><body><h1>Xuvon test page</h1><a href=\"/second\">Second</a><input id=\"field\"></body></html>"
      );
      return;
    }
    if (url.pathname === "/second") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        "<!doctype html><html><head><title>Second Page</title></head><body><h1>Second page</h1></body></html>"
      );
      return;
    }
    if (url.pathname === "/adblock-test") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        "<!doctype html><html><head><title>Adblock Test Page</title></head><body><h1>Adblock test</h1><script src=\"/app.js\"></script><script src=\"/pagead/banner.js\"></script><img src=\"/pixel.gif\" alt=\"\"></body></html>"
      );
      return;
    }
    if (url.pathname === "/pagead/landing") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        "<!doctype html><html><head><title>Pagead Landing</title></head><body><h1>Document path test</h1><script src=\"/app.js\"></script><script src=\"/pagead/banner.js\"></script></body></html>"
      );
      return;
    }
    if (url.pathname === "/app.js") {
      response.writeHead(200, { "Content-Type": "application/javascript" });
      response.end("window.__xuvonAppLoaded = true;");
      return;
    }
    if (url.pathname === "/pagead/banner.js") {
      response.writeHead(200, { "Content-Type": "application/javascript" });
      response.end("window.__xuvonAdLoaded = true;");
      return;
    }
    if (url.pathname === "/pixel.gif") {
      response.writeHead(200, { "Content-Type": "image/gif" });
      response.end(
        Buffer.from(
          "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
          "base64"
        )
      );
      return;
    }
    if (url.pathname === "/download") {
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="xuvon-test.txt"',
        "Content-Length": "24"
      });
      response.end("downloaded by xuvon test");
      return;
    }
    if (url.pathname === "/private-data") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Set-Cookie": "xuvon_e2e=1; Max-Age=3600; Path=/"
      });
      response.end(
        "<!doctype html><html><head><title>Cookie Page</title></head><body><h1>cookie</h1></body></html>"
      );
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("not found");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    downloadsDir,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      })
  };
}

export async function activeTabId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const bootstrap = await window.xuvon.bootstrap();
    const id = bootstrap.tabs.activeTabId;
    if (!id) throw new Error("No active tab.");
    return id;
  });
}

export async function waitForTabUrl(
  page: Page,
  predicate: string,
  timeout = 20_000
): Promise<void> {
  await page.waitForFunction(
    async (needle) => {
      const bootstrap = await window.xuvon.bootstrap();
      return bootstrap.tabs.tabs.some((tab) => tab.url.includes(needle as string));
    },
    predicate,
    { timeout }
  );
}
