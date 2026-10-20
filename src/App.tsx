import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LibraryPane, NoticeAction, TabMode } from "../shared/types";
import { useBrowser } from "./BrowserContext";
import { FindBar } from "./components/FindBar";
import { LibraryPanel } from "./components/LibraryPanel";
import { NoticeShelf } from "./components/NoticeShelf";
import { ShieldPanel } from "./components/ShieldPanel";
import { TabStrip } from "./components/TabStrip";
import { Toolbar } from "./components/Toolbar";
import { Menu, Onion, ShieldAlert, XuvonMark } from "./components/Icons";
import { AboutPage } from "./pages/AboutPage";
import { BookmarksPage } from "./pages/BookmarksPage";
import { DownloadsPage } from "./pages/DownloadsPage";
import { ErrorPage } from "./pages/ErrorPage";
import { HistoryPage } from "./pages/HistoryPage";
import { NewTab } from "./pages/NewTab";
import { SettingsPage } from "./pages/SettingsPage";
import { WelcomePage } from "./pages/WelcomePage";
import { displayTitle, messageOf } from "./lib/format";

function LoadingScreen() {
  return (
    <div className="boot-screen">
      <div className="boot-glow" aria-hidden="true" />
      <div className="boot-card">
        <XuvonMark size={62} />
        <span className="eyebrow">旭文瀏覽器</span>
        <h1>Xuvon</h1>
        <p>Waking the Rust core and opening a quiet window.</p>
        <span className="boot-loader"><span /></span>
      </div>
      <footer>Made with love by Seb &lt;3</footer>
    </div>
  );
}

function BootError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="boot-screen">
      <div className="boot-glow error" aria-hidden="true" />
      <div className="boot-card error-card">
        <span className="boot-error-icon"><ShieldAlert size={28} /></span>
        <span className="eyebrow">Startup interrupted</span>
        <h1>Xuvon couldn't open.</h1>
        <p>{message}</p>
        <div className="boot-actions">
          <button type="button" className="primary-button" onClick={onRetry}>Try again</button>
          <button type="button" className="secondary-button" onClick={() => window.xuvon?.app.quit()}>Quit</button>
        </div>
      </div>
      <footer>If this is a development build, run <code>npm run build:core</code> first.</footer>
    </div>
  );
}

export function App() {
  const browser = useBrowser();
  const {
    ready,
    bootError,
    app,
    settings,
    tabs,
    activeTab,
    notice,
    command,
    find,
    openInternal,
    createTab,
    navigate,
    checkTor,
    refreshBookmark,
    notify
  } = browser;

  const addressRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [addressValue, setAddressValue] = useState("");
  const [addressFocused, setAddressFocused] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryPane, setLibraryPane] = useState<LibraryPane>("bookmarks");
  const [shieldOpen, setShieldOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findSignal, setFindSignal] = useState(0);
  const [focusTarget, setFocusTarget] = useState<{ section: string; seq: number } | null>(null);
  const [viewportVisible, setViewportVisible] = useState(false);

  const addressDisplay = useMemo(() => {
    if (!activeTab) return "";
    if (activeTab.internalUrl) {
      return activeTab.internalUrl === "xuvon://newtab" ? "" : activeTab.internalUrl;
    }
    return activeTab.url;
  }, [activeTab?.id, activeTab?.url, activeTab?.internalUrl]);

  useEffect(() => {
    if (!addressFocused) setAddressValue(addressDisplay);
  }, [addressDisplay, addressFocused]);

  useEffect(() => {
    document.title = activeTab
      ? `${displayTitle(activeTab.title, activeTab.url)} — Xuvon`
      : "Xuvon";
  }, [activeTab?.title, activeTab?.url]);

  useEffect(() => {
    setFindOpen(false);
    setShieldOpen(false);
  }, [activeTab?.id]);

  const focusAddress = useCallback(() => {
    setAddressValue(activeTab?.internalUrl === "xuvon://newtab" ? "" : addressDisplay);
    setAddressFocused(true);
    requestAnimationFrame(() => {
      addressRef.current?.focus();
      addressRef.current?.select();
    });
  }, [addressDisplay, activeTab?.internalUrl]);

  const openLibrary = useCallback((pane?: LibraryPane) => {
    if (pane) setLibraryPane(pane);
    setShieldOpen(false);
    setLibraryOpen(true);
  }, []);

  const toggleShield = useCallback(() => {
    if (shieldOpen) {
      setShieldOpen(false);
      return;
    }
    setLibraryOpen(false);
    setShieldOpen(true);
  }, [shieldOpen]);

  const openSettingsAt = useCallback(
    (section: string) => {
      setFocusTarget({ section, seq: Date.now() });
      void openInternal("xuvon://settings");
    },
    [openInternal]
  );

  useEffect(() => {
    if (!command) return;
    switch (command.command.kind) {
      case "focus-address":
        focusAddress();
        break;
      case "focus-find":
        if (activeTab && !activeTab.internalUrl && !activeTab.error) {
          setFindOpen(true);
          setFindSignal((value) => value + 1);
        } else {
          notify({ tone: "info", message: "Find in page is available on web pages." });
        }
        break;
      case "open-library":
        openLibrary(command.command.pane);
        refreshBookmark();
        break;
      case "close-overlays":
        setLibraryOpen(false);
        setShieldOpen(false);
        setFindOpen(false);
        break;
      case "reopen-tab":
        void window.xuvon.tabs.reopenClosed().catch((error) => notify({ tone: "error", message: messageOf(error) }));
        break;
      default:
        break;
    }
  }, [command]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => {
      if (!activeTab) {
        window.xuvon.app.setContentBounds(null, null);
        setViewportVisible(false);
        return;
      }
      const hide =
        Boolean(activeTab.internalUrl) ||
        Boolean(activeTab.error) ||
        activeTab.crashed ||
        !/^https?:\/\//i.test(activeTab.url);
      if (hide) {
        window.xuvon.app.setContentBounds(null, activeTab.id);
        setViewportVisible(false);
        return;
      }
      const rect = viewport.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        window.xuvon.app.setContentBounds(null, activeTab.id);
        setViewportVisible(false);
        return;
      }
      setViewportVisible(true);
      window.xuvon.app.setContentBounds(
        {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        activeTab.id
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [
    activeTab?.id,
    activeTab?.url,
    activeTab?.internalUrl,
    activeTab?.error,
    activeTab?.crashed,
    libraryOpen,
    shieldOpen,
    findOpen,
    notice?.id,
    ready
  ]);

  const handleNoticeAction = (action: NoticeAction) => {
    switch (action) {
      case "retry-tor":
        void checkTor();
        break;
      case "open-downloads":
        void openInternal("xuvon://downloads");
        break;
      case "open-settings-network":
        openSettingsAt("network");
        break;
      case "open-settings-privacy":
        openSettingsAt("privacy");
        break;
      case "open-settings-extensions":
        openSettingsAt("extensions");
        break;
      default:
        break;
    }
  };

  const submitAddress = () => {
    const value = addressValue.trim();
    if (!value) {
      addressRef.current?.blur();
      return;
    }
    const target = activeTab;
    setAddressFocused(false);
    addressRef.current?.blur();
    if (target) void navigate(target.id, value);
    else void createTab({ url: value });
  };

  const openNewTab = () => {
    void createTab({ activate: true });
  };

  const openNewPrivateTab = () => {
    void createTab({ mode: "private", activate: true });
  };

  const openDownloadsPage = () => {
    void openInternal("xuvon://downloads");
  };

  const openBrand = () => {
    void openInternal("xuvon://newtab");
  };

  useEffect(() => {
    if (!libraryOpen && !findOpen && !shieldOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector(".modal-backdrop")) {
        setLibraryOpen(false);
        setShieldOpen(false);
        setFindOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [libraryOpen, findOpen, shieldOpen]);

  if (!ready) {
    if (bootError) {
      return <BootError message={bootError} onRetry={() => window.location.reload()} />;
    }
    return <LoadingScreen />;
  }

  if (!settings) {
    return <LoadingScreen />;
  }

  const mode: TabMode = activeTab?.mode ?? "normal";
  const isInternal = Boolean(activeTab?.internalUrl);
  const route = activeTab?.internalUrl ?? "";
  const platform = window.xuvon?.platform ?? "darwin";

  let page: ReactNode = null;
  if (!activeTab) {
    page = <LoadingScreen />;
  } else if (activeTab.error || activeTab.crashed) {
    page = <ErrorPage tab={activeTab} />;
  } else if (route === "xuvon://newtab") {
    page = <NewTab mode={mode} />;
  } else if (route === "xuvon://settings") {
    page = <SettingsPage focusSection={focusTarget} />;
  } else if (route === "xuvon://history") {
    page = <HistoryPage />;
  } else if (route === "xuvon://bookmarks") {
    page = <BookmarksPage />;
  } else if (route === "xuvon://downloads") {
    page = <DownloadsPage />;
  } else if (route === "xuvon://about") {
    page = <AboutPage />;
  } else if (route === "xuvon://welcome") {
    page = <WelcomePage />;
  } else {
    page = (
      <div className="web-backdrop" aria-hidden="true">
        <span className="web-backdrop-mark"><XuvonMark size={40} /></span>
      </div>
    );
  }

  return (
    <div
      className={[
        "app-shell",
        `platform-${platform}`,
        `mode-${mode}`,
        libraryOpen ? "library-open" : "",
        isInternal ? "on-internal-page" : "on-web-page",
        viewportVisible ? "viewport-visible" : ""
      ].join(" ")}
    >
      <header className="browser-chrome">
        <div className="title-row">
          <div className="traffic-spacer" aria-hidden="true" />
          <button type="button" className="brand" onClick={openBrand} title="Open a new tab">
            <XuvonMark size={27} />
            <span className="brand-word">Xuvon</span>
          </button>
          <TabStrip onNewTab={openNewTab} onNewPrivateTab={openNewPrivateTab} />
          <div className="title-actions">
            {settings.torEnabled ? (
              <button
                type="button"
                className={`tor-chip status-${browser.tor.status}`}
                onClick={() => openSettingsAt("network")}
                title={browser.tor.message ?? "Tor routing is enabled"}
              >
                <Onion size={14} />
                <span>Tor</span>
                <span className="tor-chip-dot" />
              </button>
            ) : null}
            <button
              type="button"
              className="icon-button menu-button"
              onClick={() => void browser.showAppMenu()}
              title="Xuvon menu"
              aria-label="Xuvon menu"
            >
              <Menu size={18} />
            </button>
          </div>
        </div>

        <Toolbar
          addressRef={addressRef}
          addressValue={addressValue}
          addressFocused={addressFocused}
          onAddressChange={setAddressValue}
          onAddressFocus={() => {
            setAddressFocused(true);
            setAddressValue(addressDisplay);
            requestAnimationFrame(() => addressRef.current?.select());
          }}
          onAddressBlur={() => {
            setAddressFocused(false);
            setAddressValue(addressDisplay);
          }}
          onAddressSubmit={submitAddress}
          onOpenLibrary={() => openLibrary()}
          onOpenDownloads={openDownloadsPage}
          shieldOpen={shieldOpen}
          onToggleShield={toggleShield}
        />

        {findOpen && activeTab && !activeTab.internalUrl && !activeTab.error ? (
          <FindBar tabId={activeTab.id} focusSignal={findSignal} onClose={() => setFindOpen(false)} />
        ) : null}

        <NoticeShelf onAction={handleNoticeAction} />
      </header>

      <div className="workspace">
        <main
          ref={viewportRef}
          className={`browser-viewport ${isInternal ? "has-internal-page" : "has-web-page"}`}
          aria-live={find.tabId === activeTab?.id && find.active ? "polite" : "off"}
        >
          {page}
        </main>
        {libraryOpen ? (
          <LibraryPanel
            pane={libraryPane}
            onPaneChange={setLibraryPane}
            onClose={() => setLibraryOpen(false)}
          />
        ) : null}
        {shieldOpen ? (
          <ShieldPanel onClose={() => setShieldOpen(false)} />
        ) : null}
      </div>

      {app?.isPackaged ? null : (
        <span className="dev-ribbon" title={`Electron ${app?.electron ?? ""} · Chromium ${app?.chromium ?? ""}`}>
          DEV
        </span>
      )}
    </div>
  );
}
