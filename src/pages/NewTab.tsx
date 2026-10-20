import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { HistoryEntry, TabMode } from "../../shared/types";
import { useBrowser } from "../BrowserContext";
import {
  Bookmark,
  Clock,
  Download,
  Globe,
  Incognito,
  Lock,
  Onion,
  Search,
  Settings,
  ShieldCheck,
  Sparkles
} from "../components/Icons";
import {
  colorClassFor,
  displayTitle,
  formatDateTime,
  greeting,
  hostnameOf,
  isHttpUrl,
  prettyUrl
} from "../lib/format";

export function NewTab({ mode }: { mode: TabMode }) {
  const {
    activeTab,
    settings,
    providers,
    tor,
    navigate,
    createTab,
    openInternal,
    updateSettings
  } = useBrowser();
  const [query, setQuery] = useState("");
  const [providerId, setProviderId] = useState(settings?.searchProvider ?? "duckduckgo");
  const [sites, setSites] = useState<HistoryEntry[]>([]);
  const [sitesLoaded, setSitesLoaded] = useState(false);

  useEffect(() => {
    if (settings?.searchProvider) setProviderId(settings.searchProvider);
  }, [settings?.searchProvider]);

  useEffect(() => {
    if (mode !== "normal") {
      setSites([]);
      setSitesLoaded(true);
      return;
    }
    let canceled = false;
    setSitesLoaded(false);
    window.xuvon.history
      .topSites(8)
      .then((entries) => {
        if (!canceled) {
          setSites(entries);
          setSitesLoaded(true);
        }
      })
      .catch(() => {
        if (!canceled) setSitesLoaded(true);
      });
    return () => {
      canceled = true;
    };
  }, [mode, activeTab?.id]);

  const provider = providers.find((entry) => entry.id === providerId) ?? providers[0];
  const greetingText = useMemo(() => greeting(), []);
  const today = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric"
      }).format(new Date()),
    []
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    if (providerId !== settings?.searchProvider) {
      const updated = await updateSettings({ searchProvider: providerId });
      if (!updated) return;
    }
    if (activeTab) await navigate(activeTab.id, value);
    else await createTab({ url: value });
  };

  const openDestination = (url: string) => {
    if (activeTab) void navigate(activeTab.id, url);
    else void createTab({ url });
  };

  const openInternalDestination = (route: string) => {
    void openInternal(route);
  };

  const wallpaperId = settings?.wallpaperId ?? "none";
  const customWallpaperStyle =
    wallpaperId === "custom" && settings?.wallpaperPath
      ? {
          backgroundImage: `url("xuvon-asset://wallpaper/${encodeURIComponent(settings.wallpaperPath)}")`
        }
      : undefined;

  return (
    <div className={`newtab mode-${mode}`}>
      <div
        className="newtab-wallpaper"
        data-wallpaper={wallpaperId}
        style={customWallpaperStyle}
        aria-hidden="true"
      />
      {wallpaperId !== "none" ? <div className="newtab-scrim" aria-hidden="true" /> : null}
      <div className="newtab-glow glow-one" aria-hidden="true" />
      <div className="newtab-glow glow-two" aria-hidden="true" />
      <div className="newtab-orbit orbit-one" aria-hidden="true" />
      <div className="newtab-orbit orbit-two" aria-hidden="true" />

      <div className="newtab-scroll">
        <div className="newtab-frame">
          <header className="newtab-hero">
            <div className="hero-kicker">
              <span className="kicker-dot" />
              {today}
            </div>
            <h1>
              {mode === "private"
                ? "A private place to wander."
                : mode === "tor"
                  ? "Out of sight, on your way."
                  : `${greetingText}.`}
            </h1>
            <p>
              {mode === "private"
                ? "This tab lives in memory. History, cookies, and site storage disappear when the last private tab closes."
                : mode === "tor"
                  ? "Clear-web traffic is routed through Tor once a circuit is verified. Xuvon never falls back to a direct connection."
                  : "A calmer start page for the open web. Everything you save stays on this device."}
            </p>
          </header>

          <form className="hero-search" onSubmit={(event) => void submit(event)}>
            <span className="hero-search-icon">
              <Search size={21} />
            </span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the web or enter an address"
              aria-label="Search the web"
              spellCheck={false}
              autoComplete="off"
            />
            <div className="provider-select-wrap">
              <Globe size={13} />
              <select
                value={providerId}
                onChange={(event) => {
                  setProviderId(event.target.value);
                  void updateSettings({ searchProvider: event.target.value });
                }}
                aria-label="Search provider"
              >
                {providers.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
              <span className="select-chevron">⌄</span>
            </div>
            <button type="submit" className="hero-search-go" aria-label="Search">
              <Sparkles size={17} />
            </button>
          </form>
          <p className="hero-search-note">
            <Lock size={12} />
            {provider?.privacyNote ?? "Queries go directly to your chosen search provider."}
          </p>

          {mode === "private" ? (
            <section className="mode-banner private-banner">
              <span className="banner-icon"><Incognito size={20} /></span>
              <div>
                <strong>Private browsing is on</strong>
                <p>Extensions are not loaded. Favicons, history, and per-tab cookies stay out of your normal profile. Files you download are kept until this session closes.</p>
              </div>
              <button type="button" className="pill-button" onClick={() => openInternalDestination("xuvon://settings")}>
                Privacy settings
              </button>
            </section>
          ) : mode === "tor" ? (
            <section className={`mode-banner tor-banner status-${tor.status}`}>
              <span className="banner-icon"><Onion size={20} /></span>
              <div>
                <strong>
                  {tor.status === "available"
                    ? "Tor circuit verified"
                    : tor.status === "checking"
                      ? "Verifying your Tor circuit"
                      : "Tor is not verified"}
                </strong>
                <p>
                  {tor.status === "available"
                    ? `Exit ${tor.exitIp ?? "node"} · ${tor.checkedAt ? formatDateTime(tor.checkedAt) : "Just now"}. Onion services remain blocked.`
                    : tor.message ?? "Xuvon will not connect directly while Tor is enabled."}
                </p>
              </div>
              <button type="button" className="pill-button" onClick={() => openInternalDestination("xuvon://settings")}>
                {tor.status === "unavailable" ? "Fix network" : "Manage Tor"}
              </button>
            </section>
          ) : (
            <section className="quiet-note">
              <ShieldCheck size={16} />
              <span>
                No account. No telemetry. Xuvon's Rust core keeps settings, bookmarks, and history in a local SQLite database.
              </span>
            </section>
          )}

          <section className="quick-section">
            <div className="section-line">
              <h2>Your corners</h2>
              <span>Local to Xuvon</span>
            </div>
            <div className="quick-grid">
              <button type="button" className="quick-card mint" onClick={() => openInternalDestination("xuvon://bookmarks")}>
                <span className="quick-icon"><Bookmark size={20} /></span>
                <span className="quick-copy">
                  <strong>Bookmarks</strong>
                  <span>Keep the good ones close</span>
                </span>
              </button>
              <button type="button" className="quick-card peach" onClick={() => openInternalDestination("xuvon://history")}>
                <span className="quick-icon"><Clock size={20} /></span>
                <span className="quick-copy">
                  <strong>History</strong>
                  <span>Find where you've been</span>
                </span>
              </button>
              <button type="button" className="quick-card sky" onClick={() => openInternalDestination("xuvon://downloads")}>
                <span className="quick-icon"><Download size={20} /></span>
                <span className="quick-copy">
                  <strong>Downloads</strong>
                  <span>Files, progress, and keepers</span>
                </span>
              </button>
              <button type="button" className="quick-card lilac" onClick={() => void createTab({ mode: "private" })}>
                <span className="quick-icon"><Incognito size={20} /></span>
                <span className="quick-copy">
                  <strong>Private tab</strong>
                  <span>Leave no local trace</span>
                </span>
              </button>
            </div>
          </section>

          {mode === "normal" ? (
            <section className="quick-section">
              <div className="section-line">
                <h2>Pick up where you left off</h2>
                <button type="button" className="text-button" onClick={() => openInternalDestination("xuvon://history")}>
                  All history
                </button>
              </div>
              {!sitesLoaded ? (
                <div className="top-site-grid">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="top-site skeleton" />
                  ))}
                </div>
              ) : sites.length > 0 ? (
                <div className="top-site-grid">
                  {sites.map((site) => (
                    <button
                      key={site.id}
                      type="button"
                      className={`top-site ${colorClassFor(site.url)}`}
                      onClick={() => openDestination(site.url)}
                      title={site.url}
                    >
                      <span className="site-avatar">{hostnameOf(site.url).charAt(0).toUpperCase()}</span>
                      <span className="site-copy">
                        <strong>{displayTitle(site.title, site.url)}</strong>
                        <span>{prettyUrl(site.url)}</span>
                      </span>
                      <span className="site-arrow">↗</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="top-site-empty">
                  <span className="site-empty-mark"><Sparkles size={18} /></span>
                  <div>
                    <strong>The first path is yours.</strong>
                    <p>Pages you visit will quietly appear here. No cloud sync, no profile.</p>
                  </div>
                </div>
              )}
            </section>
          ) : null}

          <div className="newtab-footer">
            <span className="footer-brand-mark">X</span>
            <span>Made with love by Seb &lt;3</span>
            <span className="footer-sep">·</span>
            <span>Xuvon Browser</span>
            <span className="footer-sep">·</span>
            <span>Made with AI, completely vibecoded</span>
            <button type="button" className="footer-link" onClick={() => openInternalDestination("xuvon://about")}>
              About
            </button>
            <button type="button" className="footer-link" onClick={() => openInternalDestination("xuvon://settings")}>
              <Settings size={13} />
              Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
