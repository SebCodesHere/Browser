import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import type {
  AdblockInfo,
  AppInfo,
  Bookmark,
  BrowserEvent,
  ClearResult,
  DownloadItem,
  ExtensionInfo,
  FindState,
  Notice,
  SearchProvider,
  Settings,
  SettingsBundle,
  SettingsMutation,
  SettingsPatch,
  TabCreateInput,
  TabState,
  TabsSnapshot,
  TorState,
  UiCommand
} from "../shared/types";
import { messageOf } from "./lib/format";

const EMPTY_TABS: TabsSnapshot = { tabs: [], activeTabId: null, closedTabCount: 0 };
const EMPTY_FIND: FindState = {
  tabId: null,
  active: false,
  query: "",
  activeMatch: 0,
  matches: 0
};
const EMPTY_TOR: TorState = {
  enabled: false,
  proxy: "",
  status: "disabled",
  message: null,
  exitIp: null,
  checkedAt: null
};

export interface CommandEnvelope {
  seq: number;
  command: UiCommand;
}

interface BrowserContextValue {
  ready: boolean;
  bootError: string | null;
  app: AppInfo | null;
  onboardingCompleted: boolean;
  settings: Settings | null;
  providers: SearchProvider[];
  tabs: TabsSnapshot;
  activeTab: TabState | null;
  downloads: DownloadItem[];
  tor: TorState;
  extensions: ExtensionInfo[];
  adblock: AdblockInfo | null;
  find: FindState;
  notice: Notice | null;
  command: CommandEnvelope | null;
  activeBookmark: Bookmark | null;
  bookmarkBusy: boolean;
  updateSettings(patch: SettingsPatch): Promise<SettingsBundle | null>;
  resetSettings(): Promise<SettingsBundle | null>;
  completeOnboarding(): Promise<boolean>;
  chooseDownloadDirectory(): Promise<SettingsBundle | null>;
  chooseWallpaper(): Promise<SettingsBundle | null>;
  removeWallpaper(): Promise<SettingsBundle | null>;
  setTorEnabled(enabled: boolean): Promise<SettingsMutation | null>;
  checkTor(): Promise<TorState | null>;
  clearBrowsingData(): Promise<ClearResult | null>;
  openDataDirectory(): Promise<void>;
  openInternal(route: string): Promise<void>;
  createTab(input?: TabCreateInput): Promise<string | null>;
  activateTab(tabId: string): Promise<void>;
  closeTab(tabId: string): Promise<void>;
  navigate(tabId: string, input: string): Promise<void>;
  toggleBookmark(): Promise<void>;
  refreshBookmark(): void;
  notify(notice: Omit<Notice, "id">): void;
  dismissNotice(): void;
  perform<T>(operation: () => Promise<T>): Promise<T | null>;
  quit(): void;
  showAppMenu(): Promise<void>;
}

const BrowserContext = createContext<BrowserContextValue | null>(null);

let noticeCounter = 0;
function nextNoticeId(): string {
  noticeCounter += 1;
  return `notice-${Date.now()}-${noticeCounter}`;
}

export function BrowserProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [app, setApp] = useState<AppInfo | null>(null);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [providers, setProviders] = useState<SearchProvider[]>([]);
  const [tabs, setTabs] = useState<TabsSnapshot>(EMPTY_TABS);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [tor, setTor] = useState<TorState>(EMPTY_TOR);
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [adblock, setAdblock] = useState<AdblockInfo | null>(null);
  const [find, setFind] = useState<FindState>(EMPTY_FIND);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [command, setCommand] = useState<CommandEnvelope | null>(null);
  const [activeBookmark, setActiveBookmark] = useState<Bookmark | null>(null);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [bookmarkVersion, setBookmarkVersion] = useState(0);
  const commandSeq = useRef(0);

  const notify = useCallback((next: Omit<Notice, "id">) => {
    setNotice({ id: nextNoticeId(), ...next });
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  const perform = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T | null> => {
      try {
        return await operation();
      } catch (error) {
        notify({ tone: "error", message: messageOf(error) });
        return null;
      }
    },
    [notify]
  );

  const applyBundle = useCallback((bundle: SettingsBundle) => {
    setSettings(bundle.settings);
    setProviders(bundle.providers);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.xuvon) {
      setBootError(
        "The trusted Xuvon preload bridge is unavailable. Start the browser with `npm run dev` or `npm start` instead of opening the renderer directly."
      );
      return;
    }

    let disposed = false;
    const off = window.xuvon.onEvent((event: BrowserEvent) => {
      if (disposed) return;
      switch (event.type) {
        case "tabs":
          setTabs(event.tabs);
          break;
        case "find":
          setFind(event.find);
          break;
        case "downloads":
          setDownloads(event.downloads);
          break;
        case "settings":
          setSettings(event.settings);
          setProviders(event.providers);
          break;
        case "tor":
          setTor(event.tor);
          break;
        case "extensions":
          setExtensions(event.extensions);
          break;
        case "notice":
          setNotice(event.notice);
          break;
        case "command":
          commandSeq.current += 1;
          setCommand({ seq: commandSeq.current, command: event.command });
          break;
        default:
          break;
      }
    });

    window.xuvon
      .bootstrap()
      .then((bootstrap) => {
        if (disposed) return;
        setApp(bootstrap.app);
        setOnboardingCompleted(bootstrap.onboardingCompleted);
        setSettings(bootstrap.settings);
        setProviders(bootstrap.providers);
        setTabs(bootstrap.tabs);
        setDownloads(bootstrap.downloads);
        setTor(bootstrap.tor);
        setExtensions(bootstrap.extensions);
        setAdblock(bootstrap.adblock);
        setReady(true);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setBootError(messageOf(error));
      });

    return () => {
      disposed = true;
      off();
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const preference = settings?.theme ?? "system";
    const apply = () => {
      const resolved = preference === "system" ? (media.matches ? "dark" : "light") : preference;
      root.dataset.theme = resolved;
      root.dataset.themePreference = preference;
      root.style.colorScheme = resolved;
    };
    apply();
    if (preference !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings?.theme]);

  useEffect(() => {
    const root = document.documentElement;
    const accent = settings?.accentTheme ?? "mint";
    root.dataset.accent = accent;
    if (accent === "custom") {
      const color = /^#[0-9a-f]{6}$/i.test(settings?.accentColor ?? "")
        ? settings!.accentColor
        : "#c9f5e2";
      root.style.setProperty("--accent-custom", color);
    } else {
      root.style.removeProperty("--accent-custom");
    }
  }, [settings?.accentTheme, settings?.accentColor]);

  const activeTab = useMemo(
    () => tabs.tabs.find((tab) => tab.id === tabs.activeTabId) ?? null,
    [tabs]
  );

  const refreshBookmark = useCallback(() => {
    setBookmarkVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    let canceled = false;
    setActiveBookmark(null);
    if (!activeTab || activeTab.internalUrl || activeTab.mode === "private") return;
    if (!/^https?:\/\//i.test(activeTab.url)) return;
    window.xuvon.bookmarks
      .find(activeTab.url)
      .then((bookmark) => {
        if (!canceled) setActiveBookmark(bookmark);
      })
      .catch(() => {
        // A missing or unavailable core should not break the chrome.
      });
    return () => {
      canceled = true;
    };
  }, [activeTab?.id, activeTab?.url, activeTab?.internalUrl, activeTab?.mode, bookmarkVersion]);

  const updateSettings = useCallback(
    async (patch: SettingsPatch): Promise<SettingsBundle | null> => {
      const bundle = await perform(() => window.xuvon.settings.update(patch));
      if (bundle) applyBundle(bundle);
      return bundle;
    },
    [applyBundle, perform]
  );

  const resetSettings = useCallback(async (): Promise<SettingsBundle | null> => {
    const bundle = await perform(() => window.xuvon.settings.reset());
    if (bundle) applyBundle(bundle);
    return bundle;
  }, [applyBundle, perform]);

  const completeOnboarding = useCallback(async (): Promise<boolean> => {
    const result = await perform(() => window.xuvon.onboarding.complete());
    if (result?.completed) {
      setOnboardingCompleted(true);
      return true;
    }
    return false;
  }, [perform]);

  const chooseDownloadDirectory = useCallback(async (): Promise<SettingsBundle | null> => {
    const bundle = await perform(() => window.xuvon.app.chooseDownloadDirectory());
    if (bundle) applyBundle(bundle);
    return bundle;
  }, [applyBundle, perform]);

  const chooseWallpaper = useCallback(async (): Promise<SettingsBundle | null> => {
    const bundle = await perform(() => window.xuvon.app.chooseWallpaper());
    if (bundle) applyBundle(bundle);
    return bundle;
  }, [applyBundle, perform]);

  const removeWallpaper = useCallback(async (): Promise<SettingsBundle | null> => {
    const bundle = await perform(() => window.xuvon.app.removeWallpaper());
    if (bundle) applyBundle(bundle);
    return bundle;
  }, [applyBundle, perform]);

  const setTorEnabled = useCallback(
    async (enabled: boolean): Promise<SettingsMutation | null> => {
      const result = await perform(() => window.xuvon.tor.setEnabled(enabled));
      if (result?.settings) applyBundle(result.settings);
      if (result?.tor) setTor(result.tor);
      return result;
    },
    [applyBundle, perform]
  );

  const checkTor = useCallback(async (): Promise<TorState | null> => {
    const state = await perform(() => window.xuvon.tor.check());
    if (state) setTor(state);
    return state;
  }, [perform]);

  const clearBrowsingData = useCallback(async (): Promise<ClearResult | null> => {
    return perform(() => window.xuvon.app.clearBrowsingData());
  }, [perform]);

  const openDataDirectory = useCallback(async () => {
    await perform(() => window.xuvon.app.openDataDirectory());
  }, [perform]);

  const openInternal = useCallback(
    async (route: string) => {
      const normalized = route.replace(/\/$/, "");
      const existing = tabs.tabs.find((tab) => tab.internalUrl === normalized);
      if (existing) {
        await perform(() => window.xuvon.tabs.activate(existing.id));
        return;
      }
      await perform(() => window.xuvon.tabs.create({ internalUrl: normalized, activate: true }));
    },
    [perform, tabs.tabs]
  );

  const createTab = useCallback(
    async (input: TabCreateInput = {}) => {
      return perform(() => window.xuvon.tabs.create(input));
    },
    [perform]
  );

  const activateTab = useCallback(
    async (tabId: string) => {
      await perform(() => window.xuvon.tabs.activate(tabId));
    },
    [perform]
  );

  const closeTab = useCallback(
    async (tabId: string) => {
      await perform(() => window.xuvon.tabs.close(tabId));
    },
    [perform]
  );

  const navigate = useCallback(
    async (tabId: string, input: string) => {
      const value = input.trim();
      if (!value) return;
      await perform(() => window.xuvon.tabs.navigate(tabId, value));
    },
    [perform]
  );

  const toggleBookmark = useCallback(async () => {
    if (!activeTab || activeTab.internalUrl || bookmarkBusy) return;
    if (activeTab.mode === "private") {
      notify({
        tone: "warning",
        message: "Private tabs do not create persistent bookmarks."
      });
      return;
    }
    setBookmarkBusy(true);
    try {
      if (activeBookmark) {
        const removed = await perform(() => window.xuvon.bookmarks.remove(activeBookmark.id));
        if (removed !== null) {
          setActiveBookmark(null);
          notify({ tone: "info", message: "Bookmark removed." });
          refreshBookmark();
        }
      } else {
        const created = await perform(() =>
          window.xuvon.bookmarks.create({
            url: activeTab.url,
            title: activeTab.title || activeTab.url
          })
        );
        if (created) {
          setActiveBookmark(created);
          notify({ tone: "success", message: "Bookmark added." });
          refreshBookmark();
        }
      }
    } finally {
      setBookmarkBusy(false);
    }
  }, [activeBookmark, activeTab, bookmarkBusy, notify, perform, refreshBookmark]);

  const quit = useCallback(() => {
    window.xuvon.app.quit();
  }, []);

  const showAppMenu = useCallback(async () => {
    await perform(() => window.xuvon.app.showMenu());
  }, [perform]);

  const value: BrowserContextValue = {
    ready,
    bootError,
    app,
    onboardingCompleted,
    settings,
    providers,
    tabs,
    activeTab,
    downloads,
    tor,
    extensions,
    adblock,
    find,
    notice,
    command,
    activeBookmark,
    bookmarkBusy,
    updateSettings,
    resetSettings,
    completeOnboarding,
    chooseDownloadDirectory,
    chooseWallpaper,
    removeWallpaper,
    setTorEnabled,
    checkTor,
    clearBrowsingData,
    openDataDirectory,
    openInternal,
    createTab,
    activateTab,
    closeTab,
    navigate,
    toggleBookmark,
    refreshBookmark,
    notify,
    dismissNotice,
    perform,
    quit,
    showAppMenu
  };

  return <BrowserContext.Provider value={value}>{children}</BrowserContext.Provider>;
}

export function useBrowser(): BrowserContextValue {
  const value = useContext(BrowserContext);
  if (!value) throw new Error("useBrowser must be used within a BrowserProvider.");
  return value;
}
