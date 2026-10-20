import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type {
  Bookmark,
  BookmarkFolder,
  DownloadItem,
  ExtensionInfo,
  HistoryPage,
  ImportCommitResult,
  ImportPreview,
  ImportPreviewRequest,
  SearchProvider,
  Settings,
  SettingsBundle,
  SettingsPatch,
  TorState
} from "../shared/types";
import { log, logCoreStderr } from "./logger";

export class CoreRpcError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "CoreRpcError";
    this.code = code;
    this.details = details;
  }
}

interface RpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: string; message?: string; details?: unknown };
  method?: string;
  params?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export type CoreNavigationMode = "normal" | "private" | "tor";

export interface CoreResolution {
  kind: "url" | "search" | "internal";
  url: string;
  displayUrl: string;
  providerName: string | null;
  isLocal: boolean;
}

export interface CoreWorkspaceTab {
  url: string;
  title: string;
  pinned: boolean;
}

export interface CoreWorkspace {
  tabs: CoreWorkspaceTab[];
  activeIndex: number;
}

export interface CoreDownload {
  id: string;
  url: string;
  filename: string;
  path: string;
  state: DownloadItem["state"];
  receivedBytes: number;
  totalBytes: number;
  danger: boolean;
  startedAt: string;
  updatedAt: string;
  error?: string | null;
}

export interface CoreExtension {
  id: string;
  name: string;
  version: string;
  path: string;
  enabled: boolean;
  installedAt: string;
}

function resolveCoreBinary(): string {
  const executable = process.platform === "win32" ? "xuvon-core.exe" : "xuvon-core";
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "bin", executable);
  }
  const root = app.getAppPath();
  const candidates = [
    path.join(root, "target", "debug", executable),
    path.join(root, "core", "target", "debug", executable),
    path.join(root, "target", "release", executable),
    path.join(root, "core", "target", "release", executable)
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      "The Xuvon core binary is missing. Run `npm run build:core` before starting the browser."
    );
  }
  return found;
}

export function resolveDataDirectory(): string {
  return process.env.XUVON_DATA_DIR || app.getPath("userData");
}

export class CoreClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private stdoutBuffer = "";
  private stopping = false;
  private started = false;
  readonly dataDir: string;

  constructor(
    dataDir: string,
    private readonly onUnexpectedExit: (error: Error) => void
  ) {
    this.dataDir = dataDir;
  }

  async start(): Promise<void> {
    if (this.started) return;
    const binary = resolveCoreBinary();
    if (!fs.existsSync(binary)) {
      throw new Error(`Xuvon core not found at ${binary}`);
    }
    fs.mkdirSync(this.dataDir, { recursive: true });

    const child = spawn(binary, ["--data-dir", this.dataDir], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        XUVON_DATA_DIR: this.dataDir
      }
    });
    this.child = child;
    this.started = true;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consumeStdout(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (line.trim()) logCoreStderr(line);
      }
    });

    child.once("error", (error) => {
      log("error", "core process error", { message: error.message });
      this.failAll(new Error(`Xuvon core failed to start: ${error.message}`));
      if (!this.stopping) this.onUnexpectedExit(error);
    });

    child.once("exit", (code, signal) => {
      this.child = null;
      this.started = false;
      clearTimeout(this.readyTimer);
      log("warn", "core exited", { code, signal });
      this.failAll(new Error("The Xuvon core process stopped unexpectedly."));
      if (!this.stopping) {
        this.onUnexpectedExit(
          new Error(`The Xuvon core process exited (${signal ?? code ?? "unknown"}).`)
        );
      }
    });

    await this.request("app.ping", null, 10_000);
    log("info", "core connected", { dataDir: this.dataDir });
  }

  private readyTimer: NodeJS.Timeout | undefined;

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    if (this.stdoutBuffer.length > 8 * 1024 * 1024) {
      this.stdoutBuffer = "";
      this.failAll(new Error("The Xuvon core sent an oversized response."));
      return;
    }
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.stdoutBuffer.slice(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line.trim()) this.handleLine(line);
      newline = this.stdoutBuffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let response: RpcResponse;
    try {
      response = JSON.parse(line) as RpcResponse;
    } catch {
      log("warn", "invalid core JSON");
      return;
    }
    if (response.method) {
      return;
    }
    if (typeof response.id !== "number") return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    if (response.error) {
      pending.reject(
        new CoreRpcError(
          response.error.code ?? "core_error",
          response.error.message ?? "The Xuvon core returned an error.",
          response.error.details
        )
      );
      return;
    }
    pending.resolve(response.result);
  }

  request<T = unknown>(
    method: string,
    params: unknown = {},
    timeoutMs = 15_000
  ): Promise<T> {
    if (!this.child || !this.started) {
      return Promise.reject(new Error("The Xuvon core is not running."));
    }
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CoreRpcError("timeout", `Xuvon core timed out while handling ${method}.`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer
      });
      this.child?.stdin.write(`${payload}\n`, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  private failAll(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    this.stopping = true;
    const child = this.child;
    try {
      await this.request("app.shutdown", null, 1_500);
    } catch {
      // The process may already be closing.
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!child.killed) child.kill("SIGTERM");
        resolve();
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      if (child.exitCode !== null) {
        clearTimeout(timer);
        resolve();
      }
    });
    this.child = null;
    this.started = false;
  }
}

/**
 * Thin typed facade over the Rust JSON-RPC contract. The Rust core is
 * authoritative for persistence and policy decisions.
 */
export class CoreApi {
  constructor(private readonly client: CoreClient) {}

  raw(): CoreClient {
    return this.client;
  }

  async info(): Promise<{ version: string; protocol: number; dataDir: string }> {
    return this.client.request("app.info", null);
  }

  async getSettings(): Promise<SettingsBundle> {
    return this.client.request("settings.get", null);
  }

  async updateSettings(patch: SettingsPatch): Promise<SettingsBundle> {
    return this.client.request("settings.update", patch);
  }

  async resetSettings(): Promise<SettingsBundle> {
    return this.client.request("settings.reset", null);
  }

  async onboardingStatus(): Promise<{ completed: boolean }> {
    return this.client.request("onboarding.status", null);
  }

  async completeOnboarding(): Promise<{ completed: boolean }> {
    return this.client.request("onboarding.complete", null);
  }

  async previewImport(input: ImportPreviewRequest): Promise<ImportPreview> {
    return this.client.request("imports.preview", input);
  }

  async importBookmarks(bookmarksPath: string): Promise<ImportCommitResult> {
    return this.client.request("imports.commit", { bookmarksPath });
  }

  async resolveNavigation(input: string, mode: CoreNavigationMode): Promise<CoreResolution> {
    return this.client.request("navigation.resolve", { input, mode });
  }

  async validateTorProxy(proxy: string): Promise<string> {
    const result = await this.client.request<{ proxy: string }>("tor.validateProxy", { proxy });
    return result.proxy;
  }

  async listBookmarks(query = "", folder?: string): Promise<Bookmark[]> {
    const result = await this.client.request<{ bookmarks: Bookmark[] }>("bookmarks.list", {
      query,
      folder: folder ?? null
    });
    return result.bookmarks;
  }

  async findBookmark(url: string): Promise<Bookmark | null> {
    const result = await this.client.request<{ bookmark: Bookmark | null }>("bookmarks.find", {
      url
    });
    return result.bookmark;
  }

  async createBookmark(input: {
    url: string;
    title?: string;
    folder?: string;
  }): Promise<Bookmark> {
    const result = await this.client.request<{ bookmark: Bookmark }>(
      "bookmarks.create",
      input
    );
    return result.bookmark;
  }

  async updateBookmark(
    id: string,
    patch: { title?: string; url?: string; folder?: string }
  ): Promise<Bookmark> {
    const result = await this.client.request<{ bookmark: Bookmark }>("bookmarks.update", {
      id,
      ...patch
    });
    return result.bookmark;
  }

  async removeBookmark(id: string): Promise<void> {
    await this.client.request("bookmarks.delete", { id });
  }

  async bookmarkFolders(): Promise<BookmarkFolder[]> {
    const result = await this.client.request<{ folders: BookmarkFolder[] }>(
      "bookmarks.folders",
      null
    );
    return result.folders;
  }

  async listHistory(query = "", limit = 250, offset = 0): Promise<HistoryPage> {
    return this.client.request("history.list", { query, limit, offset });
  }

  async topSites(limit = 8): Promise<HistoryPage["entries"]> {
    const result = await this.client.request<{ sites: HistoryPage["entries"] }>(
      "history.topSites",
      { limit }
    );
    return result.sites;
  }

  async addHistory(url: string, title: string, isPrivate: boolean): Promise<void> {
    await this.client.request("history.add", { url, title, private: isPrivate });
  }

  async updateHistoryTitle(url: string, title: string): Promise<void> {
    await this.client.request("history.updateTitle", { url, title });
  }

  async removeHistory(id: string): Promise<void> {
    await this.client.request("history.delete", { id });
  }

  async clearHistory(): Promise<void> {
    await this.client.request("history.clear", null);
  }

  async listDownloads(): Promise<CoreDownload[]> {
    const result = await this.client.request<{ downloads: CoreDownload[] }>(
      "downloads.list",
      { limit: 250 }
    );
    return result.downloads;
  }

  async createDownload(input: {
    id: string;
    url: string;
    filename: string;
    path: string;
    totalBytes: number;
    danger: boolean;
  }): Promise<CoreDownload> {
    const result = await this.client.request<{ download: CoreDownload }>(
      "downloads.create",
      input
    );
    return result.download;
  }

  async updateDownload(input: {
    id: string;
    state?: DownloadItem["state"];
    receivedBytes?: number;
    totalBytes?: number;
    error?: string | null;
  }): Promise<void> {
    await this.client.request("downloads.update", input);
  }

  async removeDownload(id: string): Promise<void> {
    await this.client.request("downloads.delete", { id });
  }

  async clearFinishedDownloads(): Promise<void> {
    await this.client.request("downloads.clearFinished", null);
  }

  async getWorkspace(): Promise<CoreWorkspace> {
    const result = await this.client.request<{ workspace: CoreWorkspace }>(
      "workspace.get",
      null
    );
    return result.workspace;
  }

  async saveWorkspace(workspace: CoreWorkspace): Promise<void> {
    await this.client.request("workspace.save", { workspace });
  }

  async clearWorkspace(): Promise<void> {
    await this.client.request("workspace.clear", null);
  }

  async listExtensions(): Promise<CoreExtension[]> {
    const result = await this.client.request<{ extensions: CoreExtension[] }>(
      "extensions.list",
      null
    );
    return result.extensions;
  }

  async addExtension(input: {
    id: string;
    name: string;
    version: string;
    path: string;
    enabled: boolean;
  }): Promise<CoreExtension> {
    const result = await this.client.request<{ extension: CoreExtension }>(
      "extensions.add",
      input
    );
    return result.extension;
  }

  async setExtensionEnabled(id: string, enabled: boolean): Promise<CoreExtension> {
    const result = await this.client.request<{ extension: CoreExtension }>(
      "extensions.setEnabled",
      { id, enabled }
    );
    return result.extension;
  }

  async removeExtension(id: string): Promise<void> {
    await this.client.request("extensions.remove", { id });
  }
}

export function settingsFromBundle(bundle: SettingsBundle): Settings {
  return bundle.settings;
}

export function providersFromBundle(bundle: SettingsBundle): SearchProvider[] {
  return bundle.providers;
}

export function torStateFromSettings(settings: Settings): TorState {
  return {
    enabled: settings.torEnabled,
    proxy: settings.torProxy,
    status: settings.torEnabled ? "unavailable" : "disabled",
    message: settings.torEnabled ? "Checking the Tor proxy…" : null,
    exitIp: null,
    checkedAt: null
  };
}

export function mapExtension(
  record: CoreExtension,
  extra: Partial<ExtensionInfo> = {}
): ExtensionInfo {
  return {
    ...record,
    loaded: false,
    permissions: [],
    manifestVersion: null,
    loadError: null,
    ...extra
  };
}

export function mapDownload(
  record: CoreDownload,
  extra: Partial<DownloadItem> = {}
): DownloadItem {
  return {
    ...record,
    error: record.error ?? null,
    isPrivate: false,
    canResume: false,
    active: false,
    ...extra
  };
}
