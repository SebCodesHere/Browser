import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeTheme,
  protocol,
  screen,
  shell
} from "electron";
import { ADBLOCK_INFO } from "../shared/adblock";
import type {
  AppInfo,
  Bootstrap,
  BrowserEvent,
  BrowserImportSource,
  ClearResult,
  DownloadItem,
  ExtensionInfo,
  FindState,
  ImportCommitResult,
  ImportPickerKind,
  ImportPreview,
  ImportPreviewRequest,
  Notice,
  Settings,
  SettingsBundle,
  SettingsMutation,
  SettingsPatch,
  TabsSnapshot,
  TabMode,
  TorState,
  UiCommand
} from "../shared/types";
import {
  CoreApi,
  CoreClient,
  resolveDataDirectory
} from "./core";
import { DownloadManager } from "./downloads";
import { ExtensionsManager } from "./extensions";
import { detectBrowserSources, sourcesFromPath } from "./importers";
import { registerIpcHandlers } from "./ipc";
import { closeLogger, getLogFile, initLogger, log } from "./logger";
import { buildAppMenu } from "./menu";
import { SessionManager } from "./sessions";
import { TabManager } from "./tabs";
import { TorController } from "./tor";

const DEV_SERVER_URL = "http://127.0.0.1:5173";
const isDev = process.env.XUVON_DEV === "1";
const isE2E = process.env.XUVON_E2E === "1";

app.setName("Xuvon Browser");
if (process.env.XUVON_DATA_DIR) {
  app.setPath("userData", path.resolve(process.env.XUVON_DATA_DIR));
}
app.enableSandbox();
if (process.platform === "win32") {
  app.setAppUserModelId("app.xuvon.browser");
}
app.commandLine.appendSwitch("force-color-profile", "srgb");

// Wallpapers are served from the user data directory through a private scheme.
// Only validated `wallpaper-*` image files can be read; the renderer never
// receives a filesystem path it can turn into arbitrary file access.
const WALLPAPER_SCHEME = "xuvon-asset";
const WALLPAPER_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp"]);
protocol.registerSchemesAsPrivileged([
  {
    scheme: WALLPAPER_SCHEME,
    privileges: { standard: true, secure: true, stream: true }
  }
]);

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

let core: CoreClient | null = null;
let api: CoreApi;
let sessions: SessionManager;
let downloads: DownloadManager;
let extensions: ExtensionsManager;
let tor: TorController;
let tabManager: TabManager;
let mainWindow: BrowserWindow | null = null;

let settingsBundle: SettingsBundle;
let settings: Settings;
let providers: SettingsBundle["providers"];
let onboardingCompleted = false;
let uiLoaded = false;
let startupTorCheckStarted = false;
let windowStateTimer: NodeJS.Timeout | null = null;
let shutdownPromise: Promise<void> | null = null;
let exitAllowed = false;

function currentWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function sendEvent(event: BrowserEvent): void {
  const window = currentWindow();
  if (!uiLoaded || !window || window.webContents.isDestroyed()) return;
  window.webContents.send("xuvon:event", event);
}

function sendCommand(command: UiCommand): void {
  sendEvent({ type: "command", command });
}

function notify(notice: Omit<Notice, "id">): void {
  sendEvent({ type: "notice", notice: { id: randomUUID(), ...notice } });
}

function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  log("warn", "action failed", { message });
  notify({ tone: "error", message });
}

function emitTabs(snapshot: TabsSnapshot): void {
  sendEvent({ type: "tabs", tabs: snapshot });
}

function emitFind(find: FindState): void {
  sendEvent({ type: "find", find });
}

function emitDownloads(items: DownloadItem[]): void {
  sendEvent({ type: "downloads", downloads: items });
}

function emitSettings(): void {
  sendEvent({ type: "settings", settings, providers });
}

function emitTor(state: TorState): void {
  sendEvent({ type: "tor", tor: state });
}

function emitExtensions(list: ExtensionInfo[]): void {
  sendEvent({ type: "extensions", extensions: list });
}

async function listExtensions(): Promise<ExtensionInfo[]> {
  try {
    return await extensions.list();
  } catch (error) {
    log("warn", "could not list extensions", {
      message: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}

async function refreshExtensions(): Promise<void> {
  emitExtensions(await listExtensions());
}

function activeTabId(): string | null {
  return tabManager?.getActiveTabId() ?? null;
}

function withActiveTab(action: (tabId: string) => Promise<void> | void): void {
  const id = activeTabId();
  if (!id) return;
  try {
    void Promise.resolve(action(id)).catch(reportError);
  } catch (error) {
    reportError(error);
  }
}

async function createNewTab(mode?: TabMode): Promise<void> {
  await tabManager.create({ activate: true, mode });
  sendCommand({ kind: "focus-address" });
}

async function openInternalRoute(route: string): Promise<void> {
  sendCommand({ kind: "close-overlays" });
  await tabManager.openInternal(route, { reuse: true, activate: true });
}

async function bookmarkCurrentPage(): Promise<void> {
  const active = tabManager.getActiveTab();
  if (!active || active.internalUrl || !/^https?:/i.test(active.url)) {
    notify({ tone: "warning", message: "Open a web page before bookmarking it." });
    return;
  }
  if (active.mode === "private") {
    notify({
      tone: "warning",
      message: "Bookmarks are not created from private tabs, so private pages do not leave persistent traces."
    });
    return;
  }
  const existing = await api.findBookmark(active.url);
  if (existing) {
    notify({ tone: "info", message: "This page is already bookmarked." });
    sendCommand({ kind: "open-library", pane: "bookmarks" });
    return;
  }
  const tab = tabManager.snapshot().tabs.find((entry) => entry.id === active.id);
  await api.createBookmark({
    url: active.url,
    title: tab?.title || active.url
  });
  notify({ tone: "success", message: "Bookmark added." });
  sendCommand({ kind: "open-library", pane: "bookmarks" });
}

async function confirmAction(options: {
  title: string;
  message: string;
  detail: string;
  confirmLabel: string;
  type?: "question" | "warning";
}): Promise<boolean> {
  if (isE2E) return true;
  const window = currentWindow();
  const dialogOptions = {
    type: options.type ?? ("question" as const),
    title: options.title,
    message: options.message,
    detail: options.detail,
    buttons: ["Cancel", options.confirmLabel],
    defaultId: 1,
    cancelId: 0,
    noLink: true
  };
  const result = window
    ? await dialog.showMessageBox(window, dialogOptions)
    : await dialog.showMessageBox(dialogOptions);
  return result.response === 1;
}

async function clearHistoryEntries(): Promise<boolean> {
  const confirmed = await confirmAction({
    title: "Clear history?",
    message: "Delete the browsing history stored by Xuvon?",
    detail:
      "This removes visited page titles and addresses from the Rust history database. Open tabs, bookmarks, and downloaded files are kept.",
    confirmLabel: "Clear history"
  });
  if (!confirmed) return false;
  await api.clearHistory();
  notify({ tone: "success", message: "Browsing history cleared." });
  return true;
}

async function clearBrowsingData(): Promise<ClearResult> {
  const confirmed = await confirmAction({
    title: "Clear browsing data?",
    message: "Clear history, cookies, site storage, and cache for the normal profile?",
    detail:
      "Private and Tor tabs use isolated in-memory sessions and are cleared when they close. Bookmarks and downloaded files are kept. This can sign you out of websites.",
    confirmLabel: "Clear browsing data",
    type: "warning"
  });
  if (!confirmed) return { cleared: false };
  await api.clearHistory();
  await sessions.clearNormal("all");
  notify({ tone: "success", message: "Browsing data cleared for the normal profile." });
  return { cleared: true };
}

async function chooseDownloadDirectory(): Promise<SettingsBundle | null> {
  const window = currentWindow();
  const result = window
    ? await dialog.showOpenDialog(window, {
        title: "Choose a download folder",
        defaultPath: settings.downloadDirectory || app.getPath("downloads"),
        properties: ["openDirectory", "createDirectory"]
      })
    : await dialog.showOpenDialog({
        title: "Choose a download folder",
        defaultPath: settings.downloadDirectory || app.getPath("downloads"),
        properties: ["openDirectory", "createDirectory"]
      });
  if (result.canceled || !result.filePaths[0]) return null;
  return updateSettings({ downloadDirectory: result.filePaths[0] });
}

function wallpaperDirectory(): string {
  return path.join(resolveDataDirectory(), "wallpapers");
}

function isWallpaperFile(name: string): boolean {
  // Mirrors core/src/settings.rs::is_wallpaper_filename. Only generated
  // wallpaper-* image names are servable; no paths, separators, or traversal.
  if (name.length > 200 || !name.startsWith("wallpaper-")) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  const extension = `.${name.slice(dot + 1).toLowerCase()}`;
  if (!WALLPAPER_EXTENSIONS.has(extension)) return false;
  return /^[A-Za-z0-9_-]+$/.test(name.slice(0, dot));
}

function wallpaperMime(name: string): string {
  switch (path.extname(name).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".avif":
      return "image/avif";
    case ".bmp":
      return "image/bmp";
    default:
      return "image/png";
  }
}

async function deleteWallpaperFile(name: string): Promise<void> {
  if (!isWallpaperFile(name)) return;
  await fs.promises.rm(path.join(wallpaperDirectory(), name), { force: true }).catch((error) => {
    log("warn", "could not delete wallpaper file", { message: String(error) });
  });
}

async function chooseWallpaper(): Promise<SettingsBundle | null> {
  const window = currentWindow();
  const options: Electron.OpenDialogOptions = {
    title: "Choose a wallpaper",
    defaultPath: app.getPath("pictures"),
    properties: ["openFile"],
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp"] }
    ]
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return null;

  const source = result.filePaths[0];
  const extension = path.extname(source).toLowerCase();
  if (!WALLPAPER_EXTENSIONS.has(extension)) {
    throw new Error("Choose a PNG, JPEG, WebP, GIF, AVIF, or BMP image.");
  }
  const stat = await fs.promises.stat(source).catch(() => null);
  if (!stat || !stat.isFile()) throw new Error("That wallpaper file could not be read.");
  if (stat.size > 30 * 1024 * 1024) {
    throw new Error("Choose a wallpaper smaller than 30 MB.");
  }

  const directory = wallpaperDirectory();
  await fs.promises.mkdir(directory, { recursive: true });
  // Normalize .jpeg to .jpg so the stored name is predictable.
  const filename = `wallpaper-${randomUUID()}${extension === ".jpeg" ? ".jpg" : extension}`;
  await fs.promises.copyFile(source, path.join(directory, filename));
  try {
    // applySettings removes the previous custom file when the path changes.
    return await updateSettings({ wallpaperId: "custom", wallpaperPath: filename });
  } catch (error) {
    await deleteWallpaperFile(filename);
    throw error;
  }
}

async function removeWallpaper(): Promise<SettingsBundle> {
  const previous = settings.wallpaperPath;
  const bundle = await updateSettings({ wallpaperId: "none", wallpaperPath: "" });
  if (previous) await deleteWallpaperFile(previous);
  return bundle;
}

function registerWallpaperProtocol(): void {
  protocol.handle(WALLPAPER_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "wallpaper") {
        return new Response("Not found", { status: 404 });
      }
      const name = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      if (!isWallpaperFile(name)) {
        return new Response("Not found", { status: 404 });
      }
      const data = await fs.promises.readFile(path.join(wallpaperDirectory(), name));
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: {
          "content-type": wallpaperMime(name),
          "cache-control": "no-store",
          "content-security-policy": "default-src 'none'"
        }
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

async function updateSettings(patch: SettingsPatch): Promise<SettingsBundle> {
  if (patch.torProxy !== undefined && settings.torEnabled) {
    throw new Error("Disable Tor before changing the proxy address.");
  }
  if (
    patch.downloadDirectory !== undefined &&
    patch.downloadDirectory.trim().length > 0 &&
    !path.isAbsolute(patch.downloadDirectory)
  ) {
    throw new Error("The download folder must be an absolute path.");
  }
  const next = await api.updateSettings(patch);
  await applySettings(next);
  return next;
}

async function applySettings(next: SettingsBundle): Promise<void> {
  const previous = settings;
  settingsBundle = next;
  settings = next.settings;
  providers = next.providers;
  nativeTheme.themeSource = settings.theme;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#0b1220" : "#eef3f8");
  }
  tor.updateSettings(settings);
  buildMenuNow();
  emitSettings();

  if (previous.wallpaperPath && previous.wallpaperPath !== settings.wallpaperPath) {
    void deleteWallpaperFile(previous.wallpaperPath);
  }

  if (previous.extensionsEnabled !== settings.extensionsEnabled) {
    try {
      if (settings.extensionsEnabled) await extensions.loadAll();
      else await extensions.unloadAll();
    } catch (error) {
      log("warn", "could not apply extension toggle", {
        message: error instanceof Error ? error.message : String(error)
      });
      notify({
        tone: "warning",
        message: `Extension setting changed, but Chromium reported: ${
          error instanceof Error ? error.message : String(error)
        }`
      });
    }
    await refreshExtensions();
  }
}

async function resetAllSettings(): Promise<SettingsBundle> {
  if (settings.torEnabled) {
    await setTorEnabled(false);
  }
  const next = await api.resetSettings();
  await applySettings(next);
  notify({ tone: "success", message: "Settings restored to their defaults." });
  return next;
}

async function setTorEnabled(enabled: boolean): Promise<SettingsMutation> {
  if (enabled === settings.torEnabled) {
    return { settings: settingsBundle, tor: tor.getState() };
  }

  if (!enabled) {
    const next = await api.updateSettings({ torEnabled: false });
    await applySettings(next);
    await tabManager.convertTabsMode("normal");
    await sessions.clearTor();
    await downloads.clearSource("tor");
    emitDownloads(downloads.snapshot());
    notify({ tone: "info", message: "Tor routing disabled. Tabs now use a direct connection." });
    return { settings: settingsBundle, tor: tor.getState() };
  }

  const confirmed = await confirmAction({
    title: "Route browsing through Tor?",
    message: "Xuvon will verify the Tor proxy and route new and existing normal tabs through it.",
    detail: [
      `Proxy: ${settings.torProxy}`,
      "Tor is designed to reduce network-level identification. It does not make you anonymous: logins, downloads, browser fingerprinting, and the sites you visit can still identify you.",
      "Onion services are always blocked. This build routes clear-web traffic only.",
      "Existing normal tabs will reload in an isolated in-memory Tor session."
    ].join("\n\n"),
    confirmLabel: "Enable Tor",
    type: "warning"
  });
  if (!confirmed) {
    return { settings: settingsBundle, tor: tor.getState() };
  }

  const state = await tor.check();
  if (state.status !== "available") {
    throw new Error(
      state.message ??
        "Tor could not be verified. Xuvon will not route traffic directly while Tor is enabled."
    );
  }

  const next = await api.updateSettings({ torEnabled: true });
  await applySettings(next);
  await tabManager.convertTabsMode("tor");
  notify({ tone: "success", message: "Tor routing enabled with a verified circuit." });
  return { settings: settingsBundle, tor: tor.getState() };
}

async function checkStartupTor(): Promise<void> {
  if (startupTorCheckStarted || !settings.torEnabled) return;
  startupTorCheckStarted = true;
  try {
    const state = await tor.check();
    if (state.status !== "available") {
      notify({
        tone: "warning",
        message:
          state.message ??
          "Tor is enabled but could not be verified. Xuvon will block navigation rather than connect directly."
      });
    }
  } catch (error) {
    log("warn", "startup Tor check failed", { message: String(error) });
  }
}

function buildMenuNow(): void {
  if (!mainWindow || !tabManager || !settings) return;
  const menu = buildAppMenu(
    {
      newTab: () => void createNewTab().catch(reportError),
      newPrivateTab: () => void createNewTab("private").catch(reportError),
      closeTab: () => withActiveTab((id) => tabManager.close(id)),
      reopenClosedTab: () => void tabManager.reopenClosed().catch(reportError),
      back: () => withActiveTab((id) => tabManager.back(id)),
      forward: () => withActiveTab((id) => tabManager.forward(id)),
      reload: () => withActiveTab((id) => tabManager.reload(id)),
      forceReload: () => withActiveTab((id) => tabManager.reload(id, true)),
      stop: () => withActiveTab((id) => tabManager.stop(id)),
      home: () => withActiveTab((id) => tabManager.home(id)),
      focusAddress: () => sendCommand({ kind: "focus-address" }),
      find: () => sendCommand({ kind: "focus-find" }),
      toggleDevTools: () => withActiveTab((id) => tabManager.toggleDevTools(id)),
      zoomIn: () => tabManager.zoom(0.5),
      zoomOut: () => tabManager.zoom(-0.5),
      resetZoom: () => tabManager.resetZoom(),
      toggleFullscreen: () => {
        if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
      },
      openSettings: () => void openInternalRoute("xuvon://settings").catch(reportError),
      openHistory: () => void openInternalRoute("xuvon://history").catch(reportError),
      openBookmarks: () => void openInternalRoute("xuvon://bookmarks").catch(reportError),
      openDownloads: () => void openInternalRoute("xuvon://downloads").catch(reportError),
      bookmarkPage: () => void bookmarkCurrentPage().catch(reportError),
      clearBrowsingData: () => void clearBrowsingData().catch(reportError),
      openDataDirectory: () => void openDataDirectory().catch(reportError),
      showAbout: () => void openInternalRoute("xuvon://about").catch(reportError),
      quit: () => requestShutdown()
    },
    settings.devMode
  );
  Menu.setApplicationMenu(menu);
}

function appInfo(): AppInfo {
  return {
    name: "Xuvon Browser",
    version: app.getVersion(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    dataDir: core?.dataDir ?? resolveDataDirectory(),
    downloadsDir: settings.downloadDirectory || app.getPath("downloads"),
    logPath: getLogFile(),
    isPackaged: app.isPackaged,
    torAvailable: tor?.getState().status === "available"
  };
}

async function bootstrap(): Promise<Bootstrap> {
  const list = await listExtensions();
  return {
    app: appInfo(),
    settings,
    providers,
    tabs: tabManager.snapshot(),
    downloads: downloads.snapshot(),
    tor: tor.getState(),
    extensions: list,
    adblock: ADBLOCK_INFO,
    onboardingCompleted
  };
}

async function completeOnboarding(): Promise<{ completed: boolean }> {
  const result = await api.completeOnboarding();
  onboardingCompleted = result.completed;
  return result;
}

async function chooseImportSources(kind: ImportPickerKind): Promise<BrowserImportSource[]> {
  const window = currentWindow();
  const options: Electron.OpenDialogOptions =
    kind === "folder"
      ? {
          title: "Choose a browser profile folder",
          defaultPath: app.getPath("home"),
          properties: ["openDirectory"]
        }
      : {
          title: "Choose browser bookmarks or settings",
          defaultPath: app.getPath("home"),
          properties: ["openFile"],
          filters: [
            {
              name: "Browser data",
              extensions: ["html", "htm", "json", "sqlite", "sqlite3", "db", "plist", "js"]
            },
            { name: "All files", extensions: ["*"] }
          ]
        };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return [];
  return sourcesFromPath(result.filePaths[0], kind);
}

async function previewImport(input: ImportPreviewRequest): Promise<ImportPreview> {
  return api.previewImport(input);
}

async function commitImport(bookmarksPath: string): Promise<ImportCommitResult> {
  return api.importBookmarks(bookmarksPath);
}

async function openDataDirectory(): Promise<void> {
  const dataDir = core?.dataDir ?? resolveDataDirectory();
  await fs.promises.mkdir(dataDir, { recursive: true });
  const error = await shell.openPath(dataDir);
  if (error) throw new Error(error);
}

const FULL_DISK_ACCESS_URLS = [
  // The legacy preference-pane URL is redirected by System Settings on
  // Ventura and later and remains the most widely supported deep link.
  "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
  // Current ExtensionKit pane identifier, used as a fallback on newer macOS.
  "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles"
] as const;

async function openFullDiskAccessSettings(): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("Full Disk Access is a macOS privacy setting.");
  }
  for (const url of FULL_DISK_ACCESS_URLS) {
    try {
      await shell.openExternal(url);
      return;
    } catch (error) {
      log("warn", "could not open Full Disk Access settings", {
        url,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  throw new Error(
    "macOS could not open Full Disk Access settings. Open System Settings → Privacy & Security → Full Disk Access manually."
  );
}

function windowStatePath(): string {
  return path.join(app.getPath("userData"), "window-state.json");
}

function readWindowState(): WindowState | null {
  try {
    const value = JSON.parse(fs.readFileSync(windowStatePath(), "utf8")) as Partial<WindowState>;
    if (
      typeof value.width !== "number" ||
      typeof value.height !== "number" ||
      !Number.isFinite(value.width) ||
      !Number.isFinite(value.height)
    ) {
      return null;
    }
    const width = Math.max(960, Math.min(4000, Math.round(value.width)));
    const height = Math.max(640, Math.min(3000, Math.round(value.height)));
    const state: WindowState = {
      width,
      height,
      maximized: Boolean(value.maximized)
    };
    if (typeof value.x === "number" && typeof value.y === "number") {
      const visible = screen.getAllDisplays().some((display) => {
        const area = display.workArea;
        return (
          value.x! + 120 > area.x &&
          value.y! + 80 > area.y &&
          value.x! < area.x + area.width - 80 &&
          value.y! < area.y + area.height - 50
        );
      });
      if (visible) {
        state.x = Math.round(value.x);
        state.y = Math.round(value.y);
      }
    }
    return state;
  } catch {
    return null;
  }
}

function saveWindowState(): void {
  const window = currentWindow();
  if (!window) return;
  try {
    const bounds = window.getNormalBounds();
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: window.isMaximized()
    };
    fs.writeFileSync(windowStatePath(), JSON.stringify(state, null, 2));
  } catch (error) {
    log("warn", "could not save window state", { message: String(error) });
  }
}

function scheduleWindowStateSave(): void {
  if (windowStateTimer) clearTimeout(windowStateTimer);
  windowStateTimer = setTimeout(() => {
    windowStateTimer = null;
    saveWindowState();
  }, 500);
}

function uiHtmlPath(): string {
  return path.join(app.getAppPath(), "dist", "index.html");
}

function isTrustedUiUrl(raw: string): boolean {
  try {
    if (isDev) {
      const url = new URL(raw);
      const dev = new URL(DEV_SERVER_URL);
      return url.origin === dev.origin;
    }
    const withoutHash = raw.split(/[?#]/)[0];
    return withoutHash === pathToFileURL(uiHtmlPath()).href;
  } catch {
    return false;
  }
}

function createMainWindow(): BrowserWindow {
  const state = readWindowState();
  const window = new BrowserWindow({
    width: state?.width ?? 1320,
    height: state?.height ?? 860,
    ...(state?.x !== undefined && state?.y !== undefined
      ? { x: state.x, y: state.y }
      : {}),
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "Xuvon",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0b1220" : "#eef3f8",
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 18, y: 18 }
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
      devTools: true,
      backgroundThrottling: true
    }
  });

  window.once("ready-to-show", () => {
    if (state?.maximized) window.maximize();
    window.show();
    window.focus();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && tabManager) {
      void tabManager.create({ url, activate: true }).catch(reportError);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isTrustedUiUrl(url)) return;
    event.preventDefault();
    if (/^https?:/i.test(url) && tabManager) {
      void tabManager.create({ url, activate: true }).catch(reportError);
    }
  });

  window.webContents.on("did-finish-load", () => {
    uiLoaded = true;
    emitTabs(tabManager.snapshot());
    emitDownloads(downloads.snapshot());
    emitSettings();
    emitTor(tor.getState());
    void refreshExtensions();
    if (settings.torEnabled) void checkStartupTor();
  });

  window.on("resize", scheduleWindowStateSave);
  window.on("move", scheduleWindowStateSave);
  window.on("maximize", scheduleWindowStateSave);
  window.on("unmaximize", scheduleWindowStateSave);

  window.on("close", (event) => {
    if (exitAllowed) return;
    event.preventDefault();
    void requestShutdown();
  });

  window.on("closed", () => {
    mainWindow = null;
    if (!exitAllowed) void requestShutdown();
  });

  return window;
}

async function loadUi(window: BrowserWindow): Promise<void> {
  if (isDev) {
    await window.loadURL(DEV_SERVER_URL);
  } else {
    await window.loadFile(uiHtmlPath());
  }
}

async function boot(): Promise<void> {
  initLogger();
  log("info", "starting Xuvon", {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    dev: isDev
  });

  const dataDir = resolveDataDirectory();
  registerWallpaperProtocol();
  core = new CoreClient(dataDir, (error) => {
    if (exitAllowed) return;
    log("error", "Rust core stopped", { message: error.message });
    notify({
      tone: "error",
      message:
        "The Xuvon Rust core stopped unexpectedly. Open pages remain visible, but saving settings, history, and bookmarks is unavailable. Restart Xuvon to recover."
    });
  });
  await core.start();
  api = new CoreApi(core);

  settingsBundle = await api.getSettings();
  settings = settingsBundle.settings;
  providers = settingsBundle.providers;
  nativeTheme.themeSource = settings.theme;

  downloads = new DownloadManager({
    api,
    getSettings: () => settings,
    getWindow: currentWindow,
    onChanged: emitDownloads,
    notify
  });
  await downloads.init();

  sessions = new SessionManager({
    getSettings: () => settings,
    downloads,
    notify,
    onRequestBlocked: (webContentsId) => {
      if (webContentsId !== null) tabManager?.noteAdblockBlocked(webContentsId);
    }
  });
  sessions.normal();

  extensions = new ExtensionsManager({
    api,
    getSettings: () => settings,
    session: () => sessions.normal(),
    getWindow: currentWindow
  });
  await extensions.loadAll();

  tor = new TorController(settings, api, emitTor);

  mainWindow = createMainWindow();

  tabManager = new TabManager(
    mainWindow,
    api,
    sessions,
    tor,
    () => settings,
    {
      emitTabs,
      emitFind,
      notify,
      privateSessionClosed: async () => {
        await sessions.clearPrivate();
        await downloads.clearSource("private");
        emitDownloads(downloads.snapshot());
      }
    }
  );

  registerIpcHandlers({
    api,
    downloads,
    extensions,
    tor,
    getWindow: currentWindow,
    getTabs: () => tabManager,
    getSettings: () => settings,
    bootstrap,
    showAppMenu: async () => {
      const menu = Menu.getApplicationMenu();
      const window = currentWindow();
      if (menu && window) menu.popup({ window });
    },
    openSettings: () => openInternalRoute("xuvon://settings"),
    openDataDirectory,
    openFullDiskAccessSettings,
    chooseDownloadDirectory,
    chooseWallpaper,
    removeWallpaper,
    clearBrowsingData,
    clearHistory: clearHistoryEntries,
    quit: () => requestShutdown(),
    updateSettings,
    resetSettings: resetAllSettings,
    setTorEnabled,
    extensionsChanged: emitExtensions,
    detectBrowserSources,
    chooseImportSources,
    previewImport,
    commitImport,
    completeOnboarding
  });

  buildMenuNow();
  try {
    onboardingCompleted = (await api.onboardingStatus()).completed;
  } catch (error) {
    log("warn", "could not read onboarding state", { message: String(error) });
  }
  await tabManager.initialize();
  if (!onboardingCompleted) {
    // A fresh profile starts with one new-tab tab. Reuse it for onboarding
    // instead of leaving an extra blank tab behind. Restored sessions keep
    // their tabs and receive a separate welcome tab.
    const existing = tabManager.snapshot().tabs;
    const onlyTab = existing.length === 1 ? existing[0] : null;
    if (onlyTab?.internalUrl === "xuvon://newtab") {
      await tabManager.navigate(onlyTab.id, "xuvon://welcome");
    } else {
      await tabManager.openInternal("xuvon://welcome");
    }
  }
  log("info", "tabs initialized", { count: tabManager.snapshot().tabs.length });

  try {
    await loadUi(mainWindow);
  } catch (error) {
    log("error", "could not load the Xuvon UI", {
      message: error instanceof Error ? error.message : String(error)
    });
    dialog.showErrorBox(
      "Xuvon could not open its interface",
      `${error instanceof Error ? error.message : String(error)}\n\nThe browser will now close.`
    );
    await requestShutdown();
    return;
  }

  log("info", "Xuvon ready");
}

function withTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  return Promise.race([
    promise.then(
      () => undefined,
      (error) => {
        log("warn", "shutdown step failed", {
          message: error instanceof Error ? error.message : String(error)
        });
      }
    ),
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    })
  ]);
}

function requestShutdown(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    log("info", "shutting down");
    if (windowStateTimer) {
      clearTimeout(windowStateTimer);
      windowStateTimer = null;
    }
    saveWindowState();
    if (tabManager) await withTimeout(tabManager.shutdown(), 2500);
    if (sessions) await withTimeout(sessions.clearOnExit(), 4000);
    if (core) await withTimeout(core.stop(), 3000);
    closeLogger();
    exitAllowed = true;
    app.exit(0);
  })();
  return shutdownPromise;
}

const gotLock = isE2E || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = currentWindow();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  app.on("before-quit", (event) => {
    if (exitAllowed) return;
    event.preventDefault();
    void requestShutdown();
  });

  app.on("window-all-closed", () => {
    if (!exitAllowed) void requestShutdown();
  });

  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });

  app.on("activate", () => {
    const window = currentWindow();
    if (window) {
      window.show();
      window.focus();
    }
  });

  process.on("uncaughtException", (error) => {
    log("error", "uncaught exception", { message: error.message, stack: error.stack });
  });
  process.on("unhandledRejection", (reason) => {
    log("error", "unhandled rejection", {
      message: reason instanceof Error ? reason.message : String(reason)
    });
  });

  void app
    .whenReady()
    .then(boot)
    .catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      log("error", "startup failed", { message });
      try {
        if (core) await withTimeout(core.stop(), 2000);
      } catch {
        // Best effort.
      }
      closeLogger();
      dialog.showErrorBox(
        "Xuvon could not start",
        `${message}\n\nIf the Rust core is missing, run \`npm run build:core\` and try again.`
      );
      app.exit(1);
    });
}
