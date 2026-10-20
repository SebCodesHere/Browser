/** Types shared by the Electron host, preload bridge, and React UI. */

export type ThemeSetting = "system" | "light" | "dark";
export type StartupBehavior = "newtab" | "restore" | "homepage";
export type CookiePolicy = "allow_all" | "block_third_party" | "session_only";
export type AccentTheme =
  | "mint"
  | "peach"
  | "sky"
  | "lilac"
  | "rose"
  | "sunset"
  | "custom";
export type WallpaperId = "none" | "aurora" | "dunes" | "grid" | "mist" | "custom";
export type TabMode = "normal" | "private" | "tor";

export interface Settings {
  version: number;
  theme: ThemeSetting;
  searchProvider: string;
  customSearchName: string;
  customSearchUrl: string;
  homepage: string;
  startupBehavior: StartupBehavior;
  downloadDirectory: string;
  askWhereToSave: boolean;
  tabSleepEnabled: boolean;
  tabSleepMinutes: number;
  devMode: boolean;
  cookiePolicy: CookiePolicy;
  clearDataOnExit: boolean;
  sendDoNotTrack: boolean;
  torEnabled: boolean;
  torProxy: string;
  extensionsEnabled: boolean;
  adblockEnabled: boolean;
  adblockAllowlist: string[];
  accentTheme: AccentTheme;
  accentColor: string;
  wallpaperId: WallpaperId;
  wallpaperPath: string;
}

export type SettingsPatch = Partial<Omit<Settings, "version">>;

export interface SearchProvider {
  id: string;
  name: string;
  description: string;
  searchUrl: string;
  privacyNote: string;
  builtIn: boolean;
}

export interface SettingsBundle {
  settings: Settings;
  providers: SearchProvider[];
}

/** A browser profile or file discovered by the Electron host. */
export interface BrowserImportSource {
  id: string;
  browser: string;
  profile: string;
  label: string;
  bookmarksPath: string | null;
  settingsPath: string | null;
  origin: "detected" | "file" | "folder";
}

export type BrowserImportFormat =
  | "chromium"
  | "firefox"
  | "safari"
  | "html"
  | "mixed"
  | "unknown";

export interface ImportBookmarkSample {
  title: string;
  url: string;
  folder: string;
}

export interface ImportBookmarksPreview {
  count: number;
  folderCount: number;
  invalid: number;
  duplicates: number;
  sample: ImportBookmarkSample[];
}

export interface ImportSettingsPreview {
  homepage?: string;
  startupBehavior?: StartupBehavior;
  notes: string[];
}

/** Read-only preview produced by the Rust import engine. */
export interface ImportPreview {
  format: BrowserImportFormat;
  bookmarks: ImportBookmarksPreview | null;
  settings: ImportSettingsPreview | null;
  warnings: string[];
}

export interface ImportCommitResult {
  imported: number;
  skipped: number;
  invalid: number;
  folders: number;
}

export interface ImportPreviewRequest {
  bookmarksPath?: string | null;
  settingsPath?: string | null;
}

export type ImportPickerKind = "file" | "folder";

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  folder: string;
  createdAt: string;
  updatedAt: string;
}

export interface BookmarkFolder {
  name: string;
  count: number;
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  lastVisitedAt: string;
  visitCount: number;
}

export interface HistoryPage {
  entries: HistoryEntry[];
  total: number;
}

export interface DownloadItem {
  id: string;
  filename: string;
  url: string;
  path: string;
  state: "progressing" | "paused" | "completed" | "cancelled" | "interrupted";
  receivedBytes: number;
  totalBytes: number;
  danger: boolean;
  isPrivate: boolean;
  startedAt: string;
  updatedAt: string;
  error?: string | null;
  canResume: boolean;
  active: boolean;
}

export interface ExtensionInfo {
  id: string;
  name: string;
  version: string;
  path: string;
  enabled: boolean;
  installedAt: string;
  loaded: boolean;
  permissions: string[];
  manifestVersion: number | null;
  loadError?: string | null;
}

export interface PageError {
  kind: "network" | "certificate" | "crash" | "proxy" | "blocked" | "unknown";
  code: number | string;
  title: string;
  description: string;
  url: string;
  retryable: boolean;
}

export interface TabState {
  id: string;
  title: string;
  url: string;
  internalUrl: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  secure: boolean | null;
  favicon: string | null;
  mode: TabMode;
  sleeping: boolean;
  crashed: boolean;
  audible: boolean;
  muted: boolean;
  error: PageError | null;
  /** Requests the ad blocker cancelled in this tab since the last full navigation. */
  blockedCount: number;
}

export interface TabsSnapshot {
  tabs: TabState[];
  activeTabId: string | null;
  closedTabCount: number;
}

export interface FindState {
  tabId: string | null;
  active: boolean;
  query: string;
  activeMatch: number;
  matches: number;
}

export interface TorState {
  enabled: boolean;
  proxy: string;
  status: "disabled" | "checking" | "available" | "unavailable";
  message?: string | null;
  exitIp?: string | null;
  checkedAt?: string | null;
}

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chromium: string;
  node: string;
  platform: string;
  arch: string;
  dataDir: string;
  downloadsDir: string;
  logPath: string;
  isPackaged: boolean;
  torAvailable: boolean;
}

export interface Bootstrap {
  app: AppInfo;
  settings: Settings;
  providers: SearchProvider[];
  tabs: TabsSnapshot;
  downloads: DownloadItem[];
  tor: TorState;
  extensions: ExtensionInfo[];
  adblock: AdblockInfo;
  onboardingCompleted: boolean;
}

/** Honest description of the bundled blocker rule set, surfaced in the UI. */
export interface AdblockInfo {
  ruleCount: number;
  blockRuleCount: number;
  exceptionRuleCount: number;
  hostRuleCount: number;
  patternRuleCount: number;
  rejectedRuleCount: number;
  listName: string;
  listVersion: string;
  license: string;
  updatedAt: string;
  syntaxVersion: number;
}

export type NoticeTone = "info" | "success" | "warning" | "error";

export type NoticeAction =
  | "retry-tor"
  | "open-downloads"
  | "open-settings-network"
  | "open-settings-privacy"
  | "open-settings-extensions";

export interface Notice {
  id: string;
  tone: NoticeTone;
  message: string;
  actionLabel?: string;
  action?: NoticeAction;
}

export type LibraryPane = "bookmarks" | "history" | "downloads";

export type UiCommand =
  | { kind: "focus-address" }
  | { kind: "focus-find" }
  | { kind: "open-library"; pane?: LibraryPane }
  | { kind: "close-overlays" }
  | { kind: "reopen-tab" };

export type BrowserEvent =
  | { type: "tabs"; tabs: TabsSnapshot }
  | { type: "find"; find: FindState }
  | { type: "downloads"; downloads: DownloadItem[] }
  | { type: "settings"; settings: Settings; providers: SearchProvider[] }
  | { type: "tor"; tor: TorState }
  | { type: "extensions"; extensions: ExtensionInfo[] }
  | { type: "command"; command: UiCommand }
  | { type: "notice"; notice: Notice };

export interface TabCreateInput {
  url?: string;
  internalUrl?: string;
  mode?: TabMode;
  activate?: boolean;
  index?: number;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BookmarkCreateInput {
  url: string;
  title?: string;
  folder?: string;
}

export interface BookmarkUpdateInput {
  title?: string;
  url?: string;
  folder?: string;
}

export interface FindOptions {
  forward?: boolean;
  findNext?: boolean;
}

export interface ClearResult {
  cleared: boolean;
}

export interface SettingsMutation {
  settings: SettingsBundle | null;
  tor?: TorState;
}

/** API exposed to the trusted Xuvon UI through the preload bridge. */
export interface XuvonApi {
  platform: string;
  versions: { electron: string; chrome: string };
  bootstrap(): Promise<Bootstrap>;
  onEvent(listener: (event: BrowserEvent) => void): () => void;

  app: {
    showMenu(): Promise<void>;
    openSettings(): Promise<void>;
    openDataDirectory(): Promise<void>;
    openFullDiskAccessSettings(): Promise<void>;
    chooseDownloadDirectory(): Promise<SettingsBundle | null>;
    chooseWallpaper(): Promise<SettingsBundle | null>;
    removeWallpaper(): Promise<SettingsBundle>;
    clearBrowsingData(): Promise<ClearResult>;
    setContentBounds(bounds: Rectangle | null, tabId: string | null): void;
    quit(): void;
  };

  tabs: {
    create(input?: TabCreateInput): Promise<string>;
    close(tabId: string): Promise<void>;
    activate(tabId: string): Promise<void>;
    navigate(tabId: string, input: string): Promise<void>;
    back(tabId: string): Promise<void>;
    forward(tabId: string): Promise<void>;
    reload(tabId: string, ignoreCache?: boolean): Promise<void>;
    stop(tabId: string): Promise<void>;
    home(tabId: string): Promise<void>;
    move(tabId: string, toIndex: number): Promise<void>;
    closeOthers(tabId: string): Promise<void>;
    reopenClosed(): Promise<void>;
    contextMenu(tabId: string): Promise<void>;
    toggleDevTools(tabId: string): Promise<void>;
    find(tabId: string, query: string, options?: FindOptions): Promise<void>;
    stopFind(tabId: string): Promise<void>;
  };

  settings: {
    update(patch: SettingsPatch): Promise<SettingsBundle>;
    reset(): Promise<SettingsBundle>;
  };

  onboarding: {
    complete(): Promise<{ completed: boolean }>;
  };

  imports: {
    detect(): Promise<BrowserImportSource[]>;
    choose(kind: ImportPickerKind): Promise<BrowserImportSource[]>;
    preview(input: ImportPreviewRequest): Promise<ImportPreview>;
    commit(bookmarksPath: string): Promise<ImportCommitResult>;
  };

  tor: {
    check(): Promise<TorState>;
    setEnabled(enabled: boolean): Promise<SettingsMutation>;
  };

  bookmarks: {
    list(query?: string, folder?: string): Promise<Bookmark[]>;
    find(url: string): Promise<Bookmark | null>;
    create(input: BookmarkCreateInput): Promise<Bookmark>;
    update(id: string, patch: BookmarkUpdateInput): Promise<Bookmark>;
    remove(id: string): Promise<void>;
    folders(): Promise<BookmarkFolder[]>;
  };

  history: {
    list(query?: string, limit?: number, offset?: number): Promise<HistoryPage>;
    topSites(limit?: number): Promise<HistoryEntry[]>;
    remove(id: string): Promise<void>;
    clear(): Promise<boolean>;
  };

  downloads: {
    list(): Promise<DownloadItem[]>;
    pause(id: string): Promise<void>;
    resume(id: string): Promise<void>;
    cancel(id: string): Promise<void>;
    open(id: string): Promise<void>;
    showInFolder(id: string): Promise<void>;
    remove(id: string): Promise<void>;
    clearFinished(): Promise<void>;
  };

  extensions: {
    list(): Promise<ExtensionInfo[]>;
    chooseAndAdd(): Promise<ExtensionInfo[]>;
    setEnabled(id: string, enabled: boolean): Promise<ExtensionInfo[]>;
    remove(id: string): Promise<ExtensionInfo[]>;
  };
}

declare global {
  interface Window {
    xuvon: XuvonApi;
  }
}
