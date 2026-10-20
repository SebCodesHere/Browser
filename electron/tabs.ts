import { randomUUID } from "node:crypto";
import {
  BrowserWindow,
  Menu,
  WebContentsView,
  clipboard,
  dialog,
  shell,
  type MenuItemConstructorOptions,
  type Rectangle,
  type Session,
  type WebContents
} from "electron";
import type {
  FindState,
  FindOptions,
  Notice,
  PageError,
  Settings,
  TabCreateInput,
  TabMode,
  TabState,
  TabsSnapshot
} from "../shared/types";
import type { CoreApi, CoreResolution, CoreWorkspace } from "./core";
import { CoreRpcError } from "./core";
import { log } from "./logger";
import type { SessionManager } from "./sessions";
import { TorUnavailableError, type TorController } from "./tor";

interface InternalTab {
  id: string;
  title: string;
  url: string;
  internalUrl: string | null;
  mode: TabMode;
  favicon: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  secure: boolean | null;
  sleeping: boolean;
  crashed: boolean;
  audible: boolean;
  muted: boolean;
  error: PageError | null;
  /** Ad/tracker requests cancelled in this tab since the last full load. */
  blockedCount: number;
  view: WebContentsView | null;
  webContents: WebContents | null;
  session: Session | null;
  lastActiveAt: number;
}

interface ClosedTab {
  url: string;
  title: string;
  mode: TabMode;
  internalUrl: string | null;
}

interface TabManagerCallbacks {
  emitTabs: (snapshot: TabsSnapshot) => void;
  emitFind: (state: FindState) => void;
  notify: (notice: Omit<Notice, "id">) => void;
  privateSessionClosed: () => Promise<void> | void;
}

interface InitialTab {
  url: string;
  title: string;
  internalUrl: string | null;
}

const MAX_TABS = 80;
const MAX_CLOSED_TABS = 25;
const MAX_WORKSPACE_TABS = 40;

const INTERNAL_TITLES: Record<string, string> = {
  newtab: "New Tab",
  settings: "Settings",
  bookmarks: "Bookmarks",
  history: "History",
  downloads: "Downloads",
  about: "About Xuvon",
  welcome: "Welcome to Xuvon"
};

export class TabManager {
  private readonly tabs = new Map<string, InternalTab>();
  private order: string[] = [];
  private activeId: string | null = null;
  private closedTabs: ClosedTab[] = [];
  private bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  private contentVisible = false;
  private htmlFullscreen = false;
  private findState: FindState = {
    tabId: null,
    active: false,
    query: "",
    activeMatch: 0,
    matches: 0
  };
  private privateCleanupTimer: NodeJS.Timeout | null = null;
  private workspaceTimer: NodeJS.Timeout | null = null;
  private sleepTimer: NodeJS.Timeout | null = null;
  private blockedEmitTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(
    private readonly window: BrowserWindow,
    private readonly api: CoreApi,
    private readonly sessions: SessionManager,
    private readonly tor: TorController,
    private readonly getSettings: () => Settings,
    private readonly callbacks: TabManagerCallbacks
  ) {}

  async initialize(): Promise<void> {
    const settings = this.getSettings();
    try {
      if (settings.startupBehavior === "restore" && !settings.torEnabled) {
        const workspace = await this.api.getWorkspace();
        const restored = await this.restoreWorkspace(workspace, settings);
        if (restored) {
          this.startSleepTimer();
          return;
        }
      }
    } catch (error) {
      log("warn", "workspace restore failed", { message: String(error) });
    }

    if (settings.startupBehavior === "homepage" && settings.torEnabled) {
      this.makeTab(this.defaultMode(), {
        internalUrl: "xuvon://newtab",
        activate: true
      });
      this.emit();
      this.startSleepTimer();
      return;
    }

    if (settings.startupBehavior === "homepage" && settings.homepage) {
      await this.create({ url: settings.homepage, activate: true });
      this.startSleepTimer();
      return;
    }

    this.makeTab(this.defaultMode(), { internalUrl: "xuvon://newtab", activate: true });
    this.emit();
    this.startSleepTimer();
  }

  private async restoreWorkspace(
    workspace: CoreWorkspace,
    settings: Settings
  ): Promise<boolean> {
    const restored: InitialTab[] = [];
    for (const tab of workspace.tabs.slice(0, MAX_WORKSPACE_TABS)) {
      const internal = isInternalUrl(tab.url);
      if (!internal && !isSafeWebUrl(tab.url)) continue;
      restored.push({
        url: internal ? normalizeInternal(tab.url) : tab.url,
        title: tab.title,
        internalUrl: internal ? normalizeInternal(tab.url) : null
      });
    }
    if (restored.length === 0) return false;

    for (let index = 0; index < restored.length; index += 1) {
      const item = restored[index];
      const isActive = Math.min(workspace.activeIndex, restored.length - 1) === index;
      const tab = this.makeTab("normal", {
        url: item.url,
        internalUrl: item.internalUrl,
        title: item.title || undefined,
        activate: false,
        sleeping: !isActive && !item.internalUrl
      });
      if (isActive) this.activeId = tab.id;
      void settings;
    }
    const active = this.activeId ? this.tabs.get(this.activeId) : null;
    if (active) {
      active.lastActiveAt = Date.now();
      if (!active.internalUrl && active.url) {
        try {
          await this.loadWebUrl(active, active.url, true);
        } catch (error) {
          this.setError(active, {
            kind: "network",
            code: "restore_failed",
            title: "This tab could not be restored",
            description: errorMessage(error),
            url: active.url,
            retryable: true
          });
        }
      }
    }
    this.emit();
    this.updateWindowTitle();
    this.saveWorkspaceSoon();
    return true;
  }

  private startSleepTimer(): void {
    if (this.sleepTimer) clearInterval(this.sleepTimer);
    this.sleepTimer = setInterval(() => this.autoSleep(), 60_000);
    this.sleepTimer.unref?.();
  }

  private autoSleep(): void {
    const settings = this.getSettings();
    if (!settings.tabSleepEnabled || this.disposed) return;
    const threshold = settings.tabSleepMinutes * 60_000;
    const now = Date.now();
    for (const tab of this.tabs.values()) {
      if (tab.id === this.activeId) continue;
      if (tab.mode === "tor") continue;
      if (!tab.view || tab.loading || tab.audible || tab.error || tab.internalUrl) continue;
      if (now - tab.lastActiveAt < threshold) continue;
      this.sleepTab(tab, false);
    }
  }

  private defaultMode(): TabMode {
    return this.getSettings().torEnabled ? "tor" : "normal";
  }

  private resolveMode(requested: TabMode | undefined): TabMode {
    if (requested === "private") return "private";
    if (requested === "tor") {
      if (!this.getSettings().torEnabled) {
        throw new Error("Tor mode is not enabled in Xuvon settings.");
      }
      return "tor";
    }
    if (this.getSettings().torEnabled) return "tor";
    return "normal";
  }

  async create(input: TabCreateInput = {}): Promise<string> {
    if (this.tabs.size >= MAX_TABS) {
      throw new Error("Xuvon has reached the tab limit. Close a tab and try again.");
    }
    const mode = this.resolveMode(input.mode);
    const internalUrl = input.internalUrl
      ? normalizeInternal(input.internalUrl)
      : input.url
        ? null
        : "xuvon://newtab";

    if (!internalUrl && mode === "tor") {
      await this.tor.ensureReady();
    }

    const tab = this.makeTab(mode, {
      url: input.url ?? internalUrl ?? undefined,
      internalUrl,
      activate: input.activate !== false,
      index: input.index
    });

    if (input.url) {
      try {
        await this.navigate(tab.id, input.url, { skipActivate: input.activate === false });
      } catch (error) {
        this.removeTabForFailedCreate(tab.id);
        throw error;
      }
    } else {
      this.emit();
    }
    this.saveWorkspaceSoon();
    return tab.id;
  }

  private makeTab(
    mode: TabMode,
    options: {
      url?: string;
      internalUrl?: string | null;
      title?: string;
      activate: boolean;
      index?: number;
      sleeping?: boolean;
    }
  ): InternalTab {
    const id = randomUUID();
    const internalUrl = options.internalUrl ?? null;
    const url = internalUrl ?? options.url ?? "xuvon://newtab";
    const title =
      options.title ||
      (internalUrl ? this.internalTitle(internalUrl, mode) : titleFromUrl(url));
    const tab: InternalTab = {
      id,
      title,
      url,
      internalUrl,
      mode,
      favicon: null,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      secure: internalUrl ? null : protocolIsSecure(url),
      sleeping: options.sleeping ?? false,
      crashed: false,
      audible: false,
      muted: false,
      error: null,
      blockedCount: 0,
      view: null,
      webContents: null,
      session: null,
      lastActiveAt: Date.now()
    };
    this.tabs.set(id, tab);
    const insertAt =
      options.index === undefined
        ? this.order.length
        : Math.max(0, Math.min(options.index, this.order.length));
    this.order.splice(insertAt, 0, id);
    if (mode === "private") this.cancelPrivateCleanup();
    if (options.activate) {
      this.setActive(tab, false);
    }
    return tab;
  }

  private removeTabForFailedCreate(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    this.destroyView(tab);
    this.tabs.delete(id);
    this.order = this.order.filter((tabId) => tabId !== id);
    if (this.activeId === id) {
      const next = this.order[this.order.length - 1];
      this.activeId = next ?? null;
      if (next) this.tabs.get(next)!.lastActiveAt = Date.now();
    }
    this.emit();
    if (this.activeId === null) {
      void this.ensureAtLeastOneTab();
    }
    this.saveWorkspaceSoon();
  }

  private internalTitle(route: string, mode: TabMode): string {
    if (route === "xuvon://newtab") {
      if (mode === "private") return "Private Tab";
      if (mode === "tor") return "Tor Tab";
      return "New Tab";
    }
    const key = route.slice("xuvon://".length).split(/[/?#]/)[0];
    return INTERNAL_TITLES[key] ?? "New Tab";
  }

  private setActive(tab: InternalTab, focusWebContents = true): void {
    if (this.activeId === tab.id) return;
    const previous = this.activeId ? this.tabs.get(this.activeId) : null;
    if (previous) {
      previous.view?.setVisible(false);
      previous.lastActiveAt = Date.now();
      if (this.findState.tabId === previous.id) this.stopFind(previous.id);
    }
    this.activeId = tab.id;
    tab.lastActiveAt = Date.now();
    this.emit();
    this.updateWindowTitle();
    if (tab.view && this.contentVisible && !tab.internalUrl && !tab.error) {
      tab.view.setVisible(true);
      tab.view.setBounds(this.bounds);
    }
    if (focusWebContents) {
      if (tab.internalUrl) this.window.webContents.focus();
      else tab.webContents?.focus();
    }
    this.saveWorkspaceSoon();
  }

  async activate(tabId: string): Promise<void> {
    const tab = this.requireTab(tabId);
    if (this.activeId !== tab.id) this.setActive(tab);
    if (tab.sleeping && !tab.internalUrl && !tab.error) {
      tab.sleeping = false;
      tab.loading = true;
      this.emit();
      try {
        if (tab.mode === "tor") await this.tor.ensureReady();
        await this.loadWebUrl(tab, tab.url, true);
      } catch (error) {
        tab.loading = false;
        tab.sleeping = true;
        this.setError(tab, torErrorPage(tab.url, error));
      }
    }
    this.updateWindowTitle();
  }

  async navigate(
    tabId: string,
    input: string,
    options: { skipActivate?: boolean } = {}
  ): Promise<void> {
    const tab = this.requireTab(tabId);
    if (!options.skipActivate && this.activeId !== tab.id) this.setActive(tab);
    const resolution = await this.api.resolveNavigation(input, tab.mode);
    if (resolution.kind === "internal") {
      await this.openInternalInTab(tab, resolution.url);
      return;
    }
    if (tab.mode === "tor") await this.tor.ensureReady();
    const normalized = checkNavigableUrl(resolution.url);
    await this.loadWebUrl(tab, normalized, true);
    this.emit();
    this.saveWorkspaceSoon();
  }

  private async loadWebUrl(tab: InternalTab, rawUrl: string, resetError: boolean): Promise<void> {
    const url = checkNavigableUrl(rawUrl);
    if (tab.mode === "tor") await this.tor.ensureReady();
    tab.internalUrl = null;
    tab.url = url;
    tab.secure = protocolIsSecure(url);
    tab.loading = true;
    tab.blockedCount = 0;
    if (resetError) {
      tab.error = null;
      tab.crashed = false;
    }
    tab.sleeping = false;
    this.emit();
    const session = await this.ensureView(tab);
    if (!session || !tab.webContents) return;
    const wc = tab.webContents;
    void wc.loadURL(url).catch((error) => {
      if (errorMessage(error).toLowerCase().includes("aborted")) return;
      log("warn", "loadURL rejected", { message: errorMessage(error) });
    });
    this.updateWindowTitle();
  }

  private async ensureView(tab: InternalTab): Promise<Session | null> {
    if (tab.view && tab.session) return tab.session;
    if (!tab.url || tab.internalUrl) return null;
    let session: Session;
    try {
      if (tab.mode === "private") session = this.sessions.privateSession();
      else if (tab.mode === "tor") {
        await this.tor.ensureReady();
        session = await this.sessions.tor();
      } else {
        session = this.sessions.normal();
      }
    } catch (error) {
      this.setError(tab, torErrorPage(tab.url, error));
      return null;
    }
    const view = new WebContentsView({
      webPreferences: {
        session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: true,
        backgroundThrottling: true,
        safeDialogs: true,
        navigateOnDragDrop: false,
        autoplayPolicy: "user-gesture-required"
      }
    });
    const wc = view.webContents;
    if (tab.mode === "tor") {
      wc.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
    }
    tab.view = view;
    tab.webContents = wc;
    tab.session = session;
    view.setVisible(false);
    view.setBounds(this.bounds);
    this.window.contentView.addChildView(view);
    this.attachWebContents(tab, wc);
    return session;
  }

  private attachWebContents(tab: InternalTab, wc: WebContents): void {
    wc.setWindowOpenHandler((details) => {
      if (!details.url) return { action: "deny" };
      try {
        checkNavigableUrl(details.url);
      } catch {
        this.callbacks.notify({
          tone: "warning",
          message: "Xuvon blocked a popup to an unsupported or onion destination."
        });
        return { action: "deny" };
      }
      void this.create({
        url: details.url,
        mode: tab.mode === "private" ? "private" : undefined,
        activate: true
      }).catch((error) => this.notifyError(error));
      return { action: "deny" };
    });

    wc.on("will-navigate", (event, url) => {
      const reason = navigationBlockReason(url, this.getSettings(), tab.mode);
      if (reason) {
        event.preventDefault();
        this.callbacks.notify({ tone: "warning", message: reason });
      }
    });

    wc.on("will-redirect", (event, url, _isInPlace, isMainFrame) => {
      if (!isMainFrame) return;
      const reason = navigationBlockReason(url, this.getSettings(), tab.mode);
      if (reason) {
        event.preventDefault();
        this.callbacks.notify({ tone: "warning", message: reason });
      }
    });

    wc.on("did-start-loading", () => {
      tab.loading = true;
      tab.error = null;
      tab.crashed = false;
      this.emit();
    });

    wc.on("did-stop-loading", () => {
      tab.loading = false;
      tab.canGoBack = safeCanGoBack(wc);
      tab.canGoForward = safeCanGoForward(wc);
      this.emit();
    });

    wc.on("did-navigate", (_event, url) => {
      tab.url = url;
      tab.internalUrl = null;
      tab.error = null;
      tab.crashed = false;
      tab.blockedCount = 0;
      tab.canGoBack = safeCanGoBack(wc);
      tab.canGoForward = safeCanGoForward(wc);
      tab.secure = protocolIsSecure(url);
      if (isInternalUrl(url)) {
        tab.title = this.internalTitle(url, tab.mode);
      }
      this.recordNavigation(tab);
      this.emit();
      this.saveWorkspaceSoon();
    });

    wc.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      tab.url = url;
      tab.secure = protocolIsSecure(url);
      tab.canGoBack = safeCanGoBack(wc);
      tab.canGoForward = safeCanGoForward(wc);
      this.recordNavigation(tab);
      this.emit();
      this.saveWorkspaceSoon();
    });

    wc.on("page-title-updated", (_event, title) => {
      const clean = title.trim().slice(0, 300);
      if (!clean) return;
      tab.title = clean;
      if (tab.mode === "normal" && /^https?:/i.test(tab.url)) {
        void this.api.updateHistoryTitle(tab.url, clean).catch(() => {});
      }
      this.emit();
      this.updateWindowTitle();
      this.saveWorkspaceSoon();
    });

    wc.on("page-favicon-updated", (_event, favicons) => {
      if (tab.mode !== "normal") {
        tab.favicon = null;
        this.emit();
        return;
      }
      const favicon = favicons.find(
        (value) => value.startsWith("https://") || value.startsWith("http://") || value.startsWith("data:")
      );
      if (favicon) {
        tab.favicon = favicon;
        this.emit();
      }
    });

    wc.on("audio-state-changed", (event) => {
      tab.audible = Boolean(event.audible);
      this.emit();
    });

    wc.on("did-fail-load", (_event, code, description, validatedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      tab.loading = false;
      const target = isSafeWebUrl(validatedUrl) ? validatedUrl : tab.url;
      tab.error = mapPageError(code, description, target, tab.mode);
      tab.canGoBack = safeCanGoBack(wc);
      tab.canGoForward = safeCanGoForward(wc);
      if (this.activeId === tab.id) {
        tab.view?.setVisible(false);
        this.contentVisible = false;
      }
      this.emit();
      this.updateWindowTitle();
      log("warn", "page failed to load", { code, description });
    });

    wc.on("render-process-gone", (_event, details) => {
      log("warn", "renderer gone", { reason: details.reason });
      this.destroyView(tab);
      tab.crashed = true;
      tab.loading = false;
      tab.error = {
        kind: "crash",
        code: details.reason,
        title: "This page stopped responding",
        description:
          "Chromium's renderer process ended unexpectedly. Reload the page to start a fresh process.",
        url: tab.url,
        retryable: true
      };
      this.emit();
      this.updateWindowTitle();
    });

    wc.on("found-in-page", (_event, result) => {
      this.findState = {
        tabId: tab.id,
        active: true,
        query: this.findState.query,
        activeMatch: result.activeMatchOrdinal,
        matches: result.matches
      };
      this.callbacks.emitFind(this.findState);
    });

    wc.on("enter-html-full-screen", () => {
      this.htmlFullscreen = true;
      this.window.setFullScreen(true);
      if (tab.view) {
        const { width, height } = this.window.getContentBounds();
        tab.view.setBounds({ x: 0, y: 0, width, height });
        tab.view.setVisible(true);
      }
    });

    wc.on("leave-html-full-screen", () => {
      this.htmlFullscreen = false;
      this.window.setFullScreen(false);
      if (tab.view) {
        tab.view.setBounds(this.bounds);
        tab.view.setVisible(this.contentVisible && this.activeId === tab.id);
      }
    });

    wc.on("context-menu", (_event, params) => {
      this.showPageContextMenu(tab, wc, params);
    });

    wc.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && input.key === "Escape" && tab.loading) {
        wc.stop();
        event.preventDefault();
      }
    });

    wc.on("will-prevent-unload", (event) => {
      const response = dialog.showMessageBoxSync(this.window, {
        type: "question",
        buttons: ["Stay on page", "Leave"],
        defaultId: 0,
        cancelId: 0,
        title: "Leave this page?",
        message: "This page has unsaved changes.",
        detail: "Leaving may discard what you have entered."
      });
      if (response === 1) {
        event.preventDefault();
      }
    });
  }

  private showPageContextMenu(
    tab: InternalTab,
    wc: WebContents,
    params: Electron.ContextMenuParams
  ): void {
    const items: MenuItemConstructorOptions[] = [];
    if (params.linkURL && isSafeWebUrl(params.linkURL)) {
      items.push(
        {
          label: "Open Link in New Tab",
          click: () => {
            void this.create({
              url: params.linkURL,
              mode: tab.mode === "private" ? "private" : undefined
            }).catch((error) => this.notifyError(error));
          }
        },
        {
          label: "Copy Link Address",
          click: () => clipboard.writeText(params.linkURL)
        },
        {
          label: "Download Linked File",
          click: () => {
            try {
              checkNavigableUrl(params.linkURL);
              wc.downloadURL(params.linkURL);
            } catch (error) {
              this.notifyError(error);
            }
          }
        },
        { type: "separator" }
      );
    }
    if (params.mediaType === "image" && params.srcURL) {
      items.push(
        {
          label: "Open Image in New Tab",
          click: () => {
            void this.create({
              url: params.srcURL,
              mode: tab.mode === "private" ? "private" : undefined
            }).catch((error) => this.notifyError(error));
          }
        },
        {
          label: "Save Image",
          click: () => {
            try {
              checkNavigableUrl(params.srcURL);
              wc.downloadURL(params.srcURL);
            } catch (error) {
              this.notifyError(error);
            }
          }
        },
        { type: "separator" }
      );
    }
    if (params.isEditable) {
      items.push(
        { role: "undo", label: "Undo" },
        { role: "redo", label: "Redo" },
        { type: "separator" },
        { role: "cut", label: "Cut" },
        { role: "copy", label: "Copy" },
        { role: "paste", label: "Paste" },
        { role: "selectAll", label: "Select All" },
        { type: "separator" }
      );
    } else if (params.selectionText.trim()) {
      items.push(
        { role: "copy", label: "Copy" },
        {
          label: `Search for “${truncate(params.selectionText.trim(), 40)}”`,
          click: () => {
            void this.create({ url: params.selectionText, mode: tab.mode === "private" ? "private" : undefined })
              .catch((error) => this.notifyError(error));
          }
        },
        { type: "separator" }
      );
    }
    items.push(
      {
        label: "Back",
        enabled: safeCanGoBack(wc),
        click: () => wc.navigationHistory.goBack()
      },
      {
        label: "Forward",
        enabled: safeCanGoForward(wc),
        click: () => wc.navigationHistory.goForward()
      },
      { label: "Reload", click: () => wc.reload() },
      { type: "separator" },
      { label: "Copy Page Address", click: () => clipboard.writeText(wc.getURL()) },
      {
        label: "Save Page As…",
        click: () => {
          try {
            checkNavigableUrl(wc.getURL());
            wc.downloadURL(wc.getURL());
          } catch (error) {
            this.notifyError(error);
          }
        }
      }
    );
    if (this.getSettings().devMode) {
      items.push(
        { type: "separator" },
        {
          label: "Inspect Element",
          click: () => {
            wc.openDevTools({ mode: "detach" });
            wc.inspectElement(params.x, params.y);
          }
        }
      );
    }
    Menu.buildFromTemplate(items).popup({ window: this.window });
  }

  private recordNavigation(tab: InternalTab): void {
    if (tab.mode !== "normal") return;
    if (!/^https?:/i.test(tab.url)) return;
    void this.api
      .addHistory(tab.url, tab.title || titleFromUrl(tab.url), false)
      .catch((error) => log("warn", "history write failed", { message: String(error) }));
  }

  private setError(tab: InternalTab, error: PageError): void {
    tab.error = error;
    tab.loading = false;
    tab.secure = null;
    if (this.activeId === tab.id) {
      tab.view?.setVisible(false);
      this.contentVisible = false;
    }
    this.emit();
    this.updateWindowTitle();
  }

  private async openInternalInTab(tab: InternalTab, route: string): Promise<void> {
    const normalized = normalizeInternal(route);
    this.destroyView(tab);
    tab.internalUrl = normalized;
    tab.url = normalized;
    tab.title = this.internalTitle(normalized, tab.mode);
    tab.secure = null;
    tab.loading = false;
    tab.error = null;
    tab.crashed = false;
    tab.canGoBack = false;
    tab.canGoForward = false;
    tab.favicon = null;
    tab.sleeping = false;
    if (this.activeId === tab.id) this.window.webContents.focus();
    this.emit();
    this.updateWindowTitle();
    this.saveWorkspaceSoon();
  }

  async openInternal(route: string, options: { reuse?: boolean; activate?: boolean } = {}): Promise<void> {
    const normalized = normalizeInternal(route);
    if (options.reuse !== false) {
      const existing = [...this.tabs.values()].find((tab) => tab.internalUrl === normalized);
      if (existing) {
        if (options.activate !== false) await this.activate(existing.id);
        return;
      }
    }
    await this.create({
      internalUrl: normalized,
      activate: options.activate !== false,
      mode: this.defaultMode()
    });
  }

  async openInternalTab(route: string): Promise<string> {
    const normalized = normalizeInternal(route);
    const existing = [...this.tabs.values()].find((tab) => tab.internalUrl === normalized);
    if (existing) {
      await this.activate(existing.id);
      return existing.id;
    }
    return this.create({ internalUrl: normalized, mode: this.defaultMode() });
  }

  async close(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    const index = this.order.indexOf(tabId);
    const wasActive = this.activeId === tabId;
    const wasPrivate = tab.mode === "private";
    if (tab.mode === "normal") {
      this.closedTabs.push({
        url: tab.url,
        title: tab.title,
        mode: tab.mode,
        internalUrl: tab.internalUrl
      });
      if (this.closedTabs.length > MAX_CLOSED_TABS) this.closedTabs.shift();
    }
    this.destroyView(tab);
    this.tabs.delete(tabId);
    this.order = this.order.filter((id) => id !== tabId);
    if (wasActive) {
      const nextId = this.order[Math.min(index, this.order.length - 1)] ?? this.order[index - 1];
      this.activeId = null;
      if (nextId) {
        this.activeId = nextId;
        this.tabs.get(nextId)!.lastActiveAt = Date.now();
      }
    }
    if (this.order.length === 0) {
      this.makeTab(this.defaultMode(), { internalUrl: "xuvon://newtab", activate: true });
      this.activeId = this.order[0];
    }
    if (wasPrivate && ![...this.tabs.values()].some((entry) => entry.mode === "private")) {
      this.schedulePrivateCleanup();
    }
    this.emit();
    this.updateWindowTitle();
    this.saveWorkspaceSoon();
  }

  async closeOthers(tabId: string): Promise<void> {
    const keep = this.requireTab(tabId);
    for (const id of [...this.order]) {
      if (id !== keep.id) await this.close(id);
    }
    await this.activate(keep.id);
  }

  async reopenClosed(): Promise<void> {
    const closed = this.closedTabs.pop();
    if (!closed) return;
    if (closed.internalUrl) {
      await this.create({
        internalUrl: closed.internalUrl,
        activate: true,
        mode: closed.mode === "private" ? "normal" : closed.mode
      });
      return;
    }
    await this.create({
      url: closed.url,
      activate: true,
      mode: closed.mode === "private" ? "normal" : closed.mode
    });
  }

  async move(tabId: string, toIndex: number): Promise<void> {
    this.requireTab(tabId);
    const current = this.order.indexOf(tabId);
    if (current === -1) return;
    this.order.splice(current, 1);
    const target = Math.max(0, Math.min(toIndex, this.order.length));
    this.order.splice(target, 0, tabId);
    this.emit();
    this.saveWorkspaceSoon();
  }

  async duplicate(tabId: string): Promise<void> {
    const tab = this.requireTab(tabId);
    await this.create({
      url: tab.internalUrl ?? tab.url,
      internalUrl: tab.internalUrl ?? undefined,
      mode: tab.mode,
      activate: true
    });
  }

  async back(tabId: string): Promise<void> {
    const tab = this.requireTab(tabId);
    if (tab.webContents?.navigationHistory.canGoBack()) {
      tab.blockedCount = 0;
      tab.webContents.navigationHistory.goBack();
    }
  }

  async forward(tabId: string): Promise<void> {
    const tab = this.requireTab(tabId);
    if (tab.webContents?.navigationHistory.canGoForward()) {
      tab.blockedCount = 0;
      tab.webContents.navigationHistory.goForward();
    }
  }

  async reload(tabId: string, ignoreCache = false): Promise<void> {
    const tab = this.requireTab(tabId);
    if (tab.internalUrl) {
      this.emit();
      return;
    }
    if (tab.mode === "tor") await this.tor.ensureReady();
    tab.error = null;
    tab.crashed = false;
    tab.loading = true;
    tab.blockedCount = 0;
    this.emit();
    if (!tab.webContents) {
      tab.sleeping = false;
      await this.loadWebUrl(tab, tab.url, true);
      return;
    }
    if (ignoreCache) tab.webContents.reloadIgnoringCache();
    else tab.webContents.reload();
  }

  async stop(tabId: string): Promise<void> {
    const tab = this.requireTab(tabId);
    tab.webContents?.stop();
    tab.loading = false;
    this.emit();
  }

  async home(tabId: string): Promise<void> {
    const tab = this.requireTab(tabId);
    const homepage = this.getSettings().homepage || "xuvon://newtab";
    await this.navigate(tab.id, homepage);
  }

  async sleep(tabId: string): Promise<void> {
    const tab = this.requireTab(tabId);
    if (tab.id === this.activeId || !tab.view) return;
    this.sleepTab(tab, true);
  }

  private sleepTab(tab: InternalTab, notify: boolean): void {
    if (!tab.view) return;
    this.destroyView(tab);
    tab.sleeping = true;
    tab.canGoBack = false;
    tab.canGoForward = false;
    if (notify) {
      this.callbacks.notify({
        tone: "info",
        message: `${truncate(tab.title, 60)} is now sleeping to save memory. Activate it to reload.`
      });
    }
    this.emit();
    this.saveWorkspaceSoon();
  }

  async setMuted(tabId: string, muted: boolean): Promise<void> {
    const tab = this.requireTab(tabId);
    tab.muted = muted;
    tab.webContents?.setAudioMuted(muted);
    this.emit();
  }

  async toggleDevTools(tabId: string): Promise<void> {
    if (!this.getSettings().devMode) {
      throw new Error("Enable Developer Mode in Xuvon settings first.");
    }
    const tab = this.requireTab(tabId);
    if (!tab.webContents) throw new Error("This tab has no page to inspect.");
    if (tab.webContents.isDevToolsOpened()) {
      tab.webContents.closeDevTools();
    } else {
      tab.webContents.openDevTools({ mode: "detach" });
    }
  }

  zoom(delta: number): void {
    const tab = this.activeId ? this.tabs.get(this.activeId) : null;
    const wc = tab?.webContents;
    if (!wc) return;
    const next = Math.max(-5, Math.min(5, wc.getZoomLevel() + delta));
    wc.setZoomLevel(next);
    this.callbacks.notify({
      tone: "info",
      message: `Zoom ${Math.round(Math.pow(1.2, next) * 100)}%`
    });
  }

  resetZoom(): void {
    const tab = this.activeId ? this.tabs.get(this.activeId) : null;
    tab?.webContents?.setZoomLevel(0);
  }

  async find(tabId: string, query: string, options: FindOptions = {}): Promise<void> {
    const tab = this.requireTab(tabId);
    if (!tab.webContents) return;
    this.findState = {
      ...this.findState,
      tabId,
      active: true,
      query,
      matches: query ? this.findState.matches : 0,
      activeMatch: query ? this.findState.activeMatch : 0
    };
    this.callbacks.emitFind(this.findState);
    if (!query) {
      tab.webContents.stopFindInPage("clearSelection");
      return;
    }
    tab.webContents.findInPage(query, {
      forward: options.forward ?? true,
      findNext: options.findNext ?? false
    });
  }

  stopFind(tabId: string): void {
    const tab = this.tabs.get(tabId);
    tab?.webContents?.stopFindInPage("clearSelection");
    if (this.findState.tabId === tabId) {
      this.findState = {
        tabId: null,
        active: false,
        query: "",
        activeMatch: 0,
        matches: 0
      };
      this.callbacks.emitFind(this.findState);
    }
  }

  setBounds(bounds: Rectangle | null, tabId: string | null): void {
    if (this.disposed) return;
    const active = this.activeId ? this.tabs.get(this.activeId) : null;
    const matches = Boolean(active && tabId && active.id === tabId);
    this.contentVisible = Boolean(bounds && matches);
    if (bounds && matches) {
      const width = Math.max(0, Math.round(bounds.width));
      const height = Math.max(0, Math.round(bounds.height));
      this.bounds = {
        x: Math.max(0, Math.round(bounds.x)),
        y: Math.max(0, Math.round(bounds.y)),
        width,
        height
      };
    }
    if (this.htmlFullscreen && active?.view) {
      const { width, height } = this.window.getContentBounds();
      active.view.setBounds({ x: 0, y: 0, width, height });
      active.view.setVisible(true);
      return;
    }
    for (const tab of this.tabs.values()) {
      tab.view?.setVisible(tab.id === this.activeId && this.contentVisible);
    }
    if (active?.view && this.contentVisible) {
      active.view.setBounds(this.bounds);
    }
  }

  async contextMenu(tabId: string): Promise<void> {
    const tab = this.requireTab(tabId);
    const settings = this.getSettings();
    const items: MenuItemConstructorOptions[] = [
      {
        label: "New Tab",
        click: () => {
          void this.create({ activate: true }).catch((error) => this.notifyError(error));
        }
      },
      {
        label: "New Private Tab",
        click: () => {
          void this.create({ mode: "private", activate: true }).catch((error) => this.notifyError(error));
        }
      },
      { type: "separator" },
      { label: "Reload", click: () => void this.reload(tab.id).catch((error) => this.notifyError(error)) },
      {
        label: "Duplicate",
        click: () => void this.duplicate(tab.id).catch((error) => this.notifyError(error))
      },
      {
        label: "Copy Address",
        click: () => clipboard.writeText(tab.url)
      },
      {
        label: tab.audible || tab.muted ? (tab.muted ? "Unmute Tab" : "Mute Tab") : "Mute Tab",
        enabled: tab.audible || tab.muted,
        click: () => {
          void this.setMuted(tab.id, !tab.muted);
        }
      },
      {
        label: "Sleep Tab",
        enabled: tab.id !== this.activeId && Boolean(tab.view),
        click: () => void this.sleep(tab.id)
      }
    ];
    if (settings.devMode && tab.webContents) {
      items.push({
        label: "Developer Tools",
        click: () => {
          void this.toggleDevTools(tab.id).catch((error) => this.notifyError(error));
        }
      });
    }
    items.push(
      { type: "separator" },
      {
        label: "Close Other Tabs",
        enabled: this.order.length > 1,
        click: () => void this.closeOthers(tab.id).catch((error) => this.notifyError(error))
      },
      {
        label: "Close Tab",
        click: () => void this.close(tab.id).catch((error) => this.notifyError(error))
      }
    );
    Menu.buildFromTemplate(items).popup({ window: this.window });
  }

  async convertTabsMode(target: "normal" | "tor"): Promise<void> {
    if (target === "tor") await this.tor.ensureReady();
    for (const tab of this.tabs.values()) {
      if (tab.mode === "private") continue;
      if (tab.internalUrl) {
        tab.mode = target;
        tab.title = this.internalTitle(tab.internalUrl, tab.mode);
        continue;
      }
      const wasActive = tab.id === this.activeId;
      const url = tab.url;
      this.destroyView(tab);
      tab.mode = target;
      tab.canGoBack = false;
      tab.canGoForward = false;
      tab.error = null;
      tab.crashed = false;
      if (wasActive) {
        tab.loading = true;
        try {
          await this.loadWebUrl(tab, url, true);
        } catch (error) {
          this.setError(tab, torErrorPage(url, error));
        }
      } else if (url) {
        tab.sleeping = true;
      }
    }
    this.emit();
    this.updateWindowTitle();
    this.saveWorkspaceSoon();
  }

  private schedulePrivateCleanup(): void {
    if (this.privateCleanupTimer) clearTimeout(this.privateCleanupTimer);
    this.privateCleanupTimer = setTimeout(() => {
      this.privateCleanupTimer = null;
      if ([...this.tabs.values()].some((tab) => tab.mode === "private")) return;
      void this.callbacks.privateSessionClosed();
    }, 350);
  }

  private cancelPrivateCleanup(): void {
    if (this.privateCleanupTimer) {
      clearTimeout(this.privateCleanupTimer);
      this.privateCleanupTimer = null;
    }
  }

  private destroyView(tab: InternalTab): void {
    const view = tab.view;
    tab.view = null;
    tab.webContents = null;
    tab.session = null;
    if (!view) return;
    try {
      this.window.contentView.removeChildView(view);
    } catch {
      // The window may be closing.
    }
    const wc = view.webContents;
    try {
      if (!wc.isDestroyed()) wc.close({ waitForBeforeUnload: false });
    } catch {
      // Already gone.
    }
  }

  private async ensureAtLeastOneTab(): Promise<void> {
    if (this.order.length > 0) return;
    this.makeTab(this.defaultMode(), { internalUrl: "xuvon://newtab", activate: true });
    this.emit();
  }

  private requireTab(tabId: string): InternalTab {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error("Tab not found.");
    return tab;
  }

  private updateWindowTitle(): void {
    if (this.window.isDestroyed()) return;
    const active = this.activeId ? this.tabs.get(this.activeId) : null;
    this.window.setTitle(active ? `${active.title} — Xuvon` : "Xuvon");
  }

  snapshot(): TabsSnapshot {
    const tabs: TabState[] = this.order
      .map((id) => this.tabs.get(id))
      .filter((tab): tab is InternalTab => Boolean(tab))
      .map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        internalUrl: tab.internalUrl,
        loading: tab.loading,
        canGoBack: tab.canGoBack,
        canGoForward: tab.canGoForward,
        secure: tab.internalUrl ? null : tab.secure,
        favicon: tab.favicon,
        mode: tab.mode,
        sleeping: tab.sleeping,
        crashed: tab.crashed,
        audible: tab.audible,
        muted: tab.muted,
        error: tab.error,
        blockedCount: tab.blockedCount
      }));
    return {
      tabs,
      activeTabId: this.activeId,
      closedTabCount: this.closedTabs.length
    };
  }

  private emit(): void {
    if (this.disposed) return;
    this.callbacks.emitTabs(this.snapshot());
  }

  /**
   * Records a request cancelled by the ad blocker. Updates are coalesced so a
   * page with dozens of blocked requests does not flood the renderer.
   */
  noteAdblockBlocked(webContentsId: number): void {
    for (const tab of this.tabs.values()) {
      if (tab.webContents?.id !== webContentsId) continue;
      tab.blockedCount += 1;
      if (!this.blockedEmitTimer && !this.disposed) {
        this.blockedEmitTimer = setTimeout(() => {
          this.blockedEmitTimer = null;
          this.emit();
        }, 250);
      }
      return;
    }
  }

  private notifyError(error: unknown): void {
    const message =
      error instanceof TorUnavailableError || error instanceof CoreRpcError
        ? error.message
        : errorMessage(error);
    this.callbacks.notify({ tone: "error", message });
  }

  saveWorkspaceSoon(): void {
    if (this.workspaceTimer) clearTimeout(this.workspaceTimer);
    this.workspaceTimer = setTimeout(() => {
      this.workspaceTimer = null;
      void this.saveWorkspaceNow();
    }, 700);
  }

  async saveWorkspaceNow(): Promise<void> {
    if (this.disposed) return;
    const persistable = this.order
      .map((id) => this.tabs.get(id))
      .filter((tab): tab is InternalTab => Boolean(tab))
      .filter(
        (tab) =>
          tab.mode === "normal" &&
          (tab.internalUrl === null || tab.internalUrl === "xuvon://newtab")
      )
      .slice(0, MAX_WORKSPACE_TABS);
    const tabs = persistable.map((tab) => ({
      url: tab.url,
      title: tab.title,
      pinned: false
    }));
    if (tabs.length === 0) {
      tabs.push({ url: "xuvon://newtab", title: "New Tab", pinned: false });
    }
    let activeIndex = 0;
    if (this.activeId) {
      const index = persistable.findIndex((tab) => tab.id === this.activeId);
      if (index >= 0) activeIndex = Math.min(index, tabs.length - 1);
    }
    try {
      await this.api.saveWorkspace({ tabs, activeIndex });
    } catch (error) {
      log("warn", "workspace save failed", { message: String(error) });
    }
  }

  async clearFindState(): Promise<void> {
    if (this.findState.tabId) this.stopFind(this.findState.tabId);
  }

  dispose(): void {
    this.disposed = true;
    if (this.privateCleanupTimer) clearTimeout(this.privateCleanupTimer);
    if (this.workspaceTimer) clearTimeout(this.workspaceTimer);
    if (this.sleepTimer) clearInterval(this.sleepTimer);
    if (this.blockedEmitTimer) clearTimeout(this.blockedEmitTimer);
    for (const tab of this.tabs.values()) this.destroyView(tab);
    this.tabs.clear();
    this.order = [];
    this.activeId = null;
  }

  async shutdown(): Promise<void> {
    await this.saveWorkspaceNow();
    this.dispose();
  }

  getActiveTabId(): string | null {
    return this.activeId;
  }

  getActiveTab(): { id: string; mode: TabMode; url: string; internalUrl: string | null } | null {
    const tab = this.activeId ? this.tabs.get(this.activeId) : null;
    if (!tab) return null;
    return { id: tab.id, mode: tab.mode, url: tab.url, internalUrl: tab.internalUrl };
  }

  async focusAddress(): Promise<void> {
    this.window.webContents.focus();
  }
}

function checkNavigableUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("This address is not a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Xuvon does not permit the ${parsed.protocol} URL scheme in a tab.`);
  }
  if (!parsed.hostname) throw new Error("This address is missing a host.");
  if (isOnionHost(parsed.hostname)) {
    throw new CoreRpcError(
      "blocked_onion",
      "Onion addresses are blocked in Xuvon. Xuvon routes eligible clear-web traffic through Tor; it is not an onion browser."
    );
  }
  return parsed.toString();
}

function navigationBlockReason(
  rawUrl: string,
  settings: Settings,
  mode: TabMode
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "Xuvon blocked an invalid navigation request.";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `Xuvon blocked a navigation to the ${parsed.protocol} scheme.`;
  }
  if (isOnionHost(parsed.hostname)) {
    return "Onion addresses are blocked in Xuvon and were not resolved.";
  }
  if (settings.torEnabled && mode === "normal") {
    return "Tor mode is enabled. Xuvon blocked a direct navigation from a non-Tor tab.";
  }
  return null;
}

function isOnionHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "onion" || normalized.endsWith(".onion");
}

function isSafeWebUrl(raw: string): boolean {
  try {
    checkNavigableUrl(raw);
    return true;
  } catch {
    return false;
  }
}

function isInternalUrl(raw: string): boolean {
  return /^xuvon:\/\/(newtab|settings|bookmarks|history|downloads|about|welcome)(?:[/?#]|$)/.test(raw);
}

function normalizeInternal(raw: string): string {
  if (!isInternalUrl(raw)) throw new Error("Unknown Xuvon internal page.");
  const route = raw.slice("xuvon://".length).split(/[/?#]/)[0];
  return `xuvon://${route}`;
}

function protocolIsSecure(raw: string): boolean | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol === "http:") return false;
    return null;
  } catch {
    return null;
  }
}

function titleFromUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return url.hostname.replace(/^www\./, "") || "New Tab";
  } catch {
    return "New Tab";
  }
}

function safeCanGoBack(wc: WebContents): boolean {
  try {
    return wc.navigationHistory.canGoBack();
  } catch {
    return false;
  }
}

function safeCanGoForward(wc: WebContents): boolean {
  try {
    return wc.navigationHistory.canGoForward();
  } catch {
    return false;
  }
}

function mapPageError(
  code: number,
  description: string,
  url: string,
  mode: TabMode
): PageError {
  if (mode === "tor") {
    return {
      kind: "proxy",
      code,
      title: "The Tor connection failed",
      description:
        "Xuvon could not load this page through the Tor circuit. It did not fall back to a direct connection. Check that the local Tor service is running, then retry.",
      url,
      retryable: true
    };
  }
  if (code <= -200 && code > -300) {
    return {
      kind: "certificate",
      code,
      title: "Your connection is not private",
      description: `Chromium rejected the certificate for this site (${description}). Xuvon never bypasses certificate checks. The site may be misconfigured, or an intermediary may be tampering with the connection.`,
      url,
      retryable: true
    };
  }
  const messages: Record<number, { title: string; description: string }> = {
    [-105]: {
      title: "We couldn't find that site",
      description: "The address may be misspelled, or the site may no longer exist."
    },
    [-106]: {
      title: "You appear to be offline",
      description: "Check your network connection and try again."
    },
    [-7]: {
      title: "The site took too long to respond",
      description: "The server may be overloaded or unreachable from this network."
    },
    [-118]: {
      title: "The connection timed out",
      description: "The site did not respond in time."
    },
    [-102]: {
      title: "The connection was refused",
      description: "The server is not accepting connections on this address."
    },
    [-101]: {
      title: "The connection was reset",
      description: "The network closed the connection unexpectedly."
    },
    [-109]: {
      title: "The site can't be reached",
      description: "The server's address could not be found."
    }
  };
  const known = messages[code];
  return {
    kind: "network",
    code,
    title: known?.title ?? "This page couldn't be loaded",
    description:
      known?.description ??
      `Chromium reported: ${description || "an unknown network error"}.`,
    url,
    retryable: true
  };
}

function torErrorPage(url: string, error: unknown): PageError {
  return {
    kind: "proxy",
    code: "tor_unavailable",
    title: "Tor is not ready",
    description:
      error instanceof Error
        ? error.message
        : "Xuvon could not verify a Tor circuit. Direct navigation is disabled for this tab.",
    url,
    retryable: true
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
