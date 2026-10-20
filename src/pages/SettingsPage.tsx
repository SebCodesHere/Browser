import { useEffect, useRef, useState } from "react";
import type {
  AccentTheme,
  CookiePolicy,
  ExtensionInfo,
  StartupBehavior,
  ThemeSetting,
  WallpaperId
} from "../../shared/types";
import { useBrowser } from "../BrowserContext";
import {
  AlertTriangle,
  Bookmark,
  Check,
  Code,
  Download,
  Globe,
  ImageIcon,
  Info,
  Lock,
  Monitor,
  Moon,
  Onion,
  Palette,
  Puzzle,
  Search,
  Settings,
  Shield,
  Sliders,
  Sparkles,
  Sun,
  Trash,
  XCircle
} from "../components/Icons";
import { Section, Segmented, SettingRow, Toggle } from "../components/Ui";
import { formatDateTime, messageOf, prettyUrl } from "../lib/format";

const SECTIONS = [
  { id: "appearance", label: "Appearance", icon: <Sun size={16} /> },
  { id: "search", label: "Search", icon: <Search size={16} /> },
  { id: "startup", label: "Startup", icon: <Sparkles size={16} /> },
  { id: "downloads", label: "Downloads", icon: <Download size={16} /> },
  { id: "privacy", label: "Privacy", icon: <Shield size={16} /> },
  { id: "network", label: "Tor & network", icon: <Onion size={16} /> },
  { id: "extensions", label: "Extensions", icon: <Puzzle size={16} /> },
  { id: "performance", label: "Performance", icon: <Sliders size={16} /> },
  { id: "developer", label: "Developer", icon: <Code size={16} /> },
  { id: "about", label: "About", icon: <Info size={16} /> }
];

const ACCENT_OPTIONS: { id: AccentTheme; label: string; swatch: string }[] = [
  { id: "mint", label: "Mint", swatch: "#c9f5e2" },
  { id: "peach", label: "Peach", swatch: "#ffd3be" },
  { id: "sky", label: "Sky", swatch: "#bfe0ff" },
  { id: "lilac", label: "Lilac", swatch: "#ddccff" },
  { id: "rose", label: "Rose", swatch: "#ffc9d8" },
  { id: "sunset", label: "Sunset", swatch: "#ffd7a1" },
  { id: "custom", label: "Custom", swatch: "conic-gradient(#c9f5e2, #bfe0ff, #ddccff, #ffd3be, #c9f5e2)" }
];

const WALLPAPER_OPTIONS: { id: WallpaperId; label: string }[] = [
  { id: "none", label: "Signature" },
  { id: "aurora", label: "Aurora" },
  { id: "dunes", label: "Dunes" },
  { id: "grid", label: "Grid" },
  { id: "mist", label: "Mist" }
];

export function SettingsPage({
  focusSection
}: {
  focusSection: { section: string; seq: number } | null;
}) {
  const {
    app,
    settings,
    providers,
    tor,
    extensions,
    adblock,
    activeTab,
    updateSettings,
    resetSettings,
    chooseDownloadDirectory,
    chooseWallpaper,
    removeWallpaper,
    setTorEnabled,
    checkTor,
    clearBrowsingData,
    openDataDirectory,
    openInternal,
    notify,
    perform
  } = useBrowser();

  const [homepage, setHomepage] = useState("");
  const [downloadPath, setDownloadPath] = useState("");
  const [torProxy, setTorProxy] = useState("");
  const [customName, setCustomName] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [sleepMinutes, setSleepMinutes] = useState("30");
  const [savingCount, setSavingCount] = useState(0);
  const [saved, setSaved] = useState(false);
  const [torBusy, setTorBusy] = useState(false);
  const [torChecking, setTorChecking] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [wallpaperBusy, setWallpaperBusy] = useState(false);
  const [accentDraft, setAccentDraft] = useState<string | null>(null);
  const accentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accentDraftRef = useRef<string | null>(null);
  const [extensionBusy, setExtensionBusy] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!settings) return;
    setHomepage(settings.homepage);
    setDownloadPath(settings.downloadDirectory);
    setTorProxy(settings.torProxy);
    setCustomName(settings.customSearchName);
    setCustomUrl(settings.customSearchUrl);
    setSleepMinutes(String(settings.tabSleepMinutes));
  }, [
    settings?.homepage,
    settings?.downloadDirectory,
    settings?.torProxy,
    settings?.customSearchName,
    settings?.customSearchUrl,
    settings?.tabSleepMinutes
  ]);

  useEffect(() => {
    if (accentTimer.current) return;
    setAccentDraft(settings?.accentColor || null);
  }, [settings?.accentColor]);

  useEffect(() => {
    return () => {
      if (!accentTimer.current) return;
      clearTimeout(accentTimer.current);
      const color = accentDraftRef.current;
      // Persist a color chosen immediately before leaving the page.
      if (color) {
        void window.xuvon.settings.update({ accentTheme: "custom", accentColor: color });
      }
    };
  }, []);

  useEffect(() => {
    if (!focusSection) return;
    const timer = setTimeout(() => {
      document.getElementById(`settings-${focusSection.section}`)?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start"
      });
    }, 70);
    return () => clearTimeout(timer);
  }, [focusSection?.section, focusSection?.seq]);

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    []
  );

  if (!settings) return null;

  const flashSaved = () => {
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1800);
  };

  const apply = async (patch: Parameters<typeof updateSettings>[0]) => {
    setSavingCount((count) => count + 1);
    try {
      const bundle = await updateSettings(patch);
      if (bundle) flashSaved();
      return bundle;
    } finally {
      setSavingCount((count) => Math.max(0, count - 1));
    }
  };

  const updateCustomAccent = (color: string) => {
    setAccentDraft(color);
    accentDraftRef.current = color;
    // Preview immediately, then coalesce writes while the OS color panel is
    // being dragged. The canonical value still comes back from Rust.
    document.documentElement.style.setProperty("--accent-custom", color);
    if (accentTimer.current) clearTimeout(accentTimer.current);
    accentTimer.current = setTimeout(() => {
      accentTimer.current = null;
      void apply({ accentTheme: "custom", accentColor: color });
    }, 180);
  };

  const provider = providers.find((entry) => entry.id === settings.searchProvider);
  const customConfigured = providers.some((entry) => entry.id === "custom");
  const busy = savingCount > 0;

  const saveCustomSearch = async () => {
    const url = customUrl.trim();
    const name = customName.trim() || "Custom search";
    if (!url) return;
    if (!url.includes("%s")) {
      notify({ tone: "warning", message: "A custom search URL must include %s where the query belongs." });
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      notify({ tone: "warning", message: "A custom search URL must begin with http:// or https://." });
      return;
    }
    const bundle = await apply({
      customSearchName: name,
      customSearchUrl: url,
      searchProvider: "custom"
    });
    if (bundle) notify({ tone: "success", message: `Using ${name}.` });
  };

  const clearCustomSearch = async () => {
    if (settings.searchProvider === "custom") {
      const switched = await apply({ searchProvider: "duckduckgo" });
      if (!switched) return;
    }
    await apply({ customSearchName: "", customSearchUrl: "" });
    setCustomName("");
    setCustomUrl("");
    notify({ tone: "info", message: "Custom search removed." });
  };

  const toggleTor = async (enabled: boolean) => {
    setTorBusy(true);
    try {
      const result = await setTorEnabled(enabled);
      if (result) {
        // The main process announces the result in the status shelf.
      }
    } finally {
      setTorBusy(false);
    }
  };

  const verifyTor = async () => {
    setTorChecking(true);
    try {
      await checkTor();
    } finally {
      setTorChecking(false);
    }
  };

  const removeExtension = async (extension: ExtensionInfo) => {
    setExtensionBusy(extension.id);
    try {
      await perform(() => window.xuvon.extensions.remove(extension.id));
    } finally {
      setExtensionBusy(null);
    }
  };

  const toggleExtension = async (extension: ExtensionInfo) => {
    setExtensionBusy(extension.id);
    try {
      await perform(() => window.xuvon.extensions.setEnabled(extension.id, !extension.enabled));
    } finally {
      setExtensionBusy(null);
    }
  };

  const addExtension = async () => {
    setExtensionBusy("add");
    try {
      await perform(() => window.xuvon.extensions.chooseAndAdd());
    } finally {
      setExtensionBusy(null);
    }
  };

  const saveSleepMinutes = async () => {
    const value = Math.max(1, Math.min(240, Number.parseInt(sleepMinutes, 10) || 30));
    setSleepMinutes(String(value));
    if (value !== settings.tabSleepMinutes) await apply({ tabSleepMinutes: value });
  };

  const resetWithConfirmation = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setConfirmReset(false), 5000);
      return;
    }
    setConfirmReset(false);
    await resetSettings();
  };

  const infoTone =
    tor.status === "available"
      ? "ok"
      : tor.status === "checking"
        ? "checking"
        : settings.torEnabled
          ? "warn"
          : "idle";

  return (
    <div className="internal-scroll settings-scroll" ref={scrollRef}>
      <div className="page-aura aura-one" aria-hidden="true" />
      <div className="page-aura aura-two" aria-hidden="true" />
      <div className="page-shell settings-page">
        <header className="page-header">
          <div className="page-heading">
            <span className="eyebrow">Make it yours</span>
            <h1>Settings</h1>
            <p>Every change is validated and persisted by the Rust core. Nothing here needs an account.</p>
          </div>
          <div className="page-actions settings-save-status" aria-live="polite">
            {busy ? (
              <span className="saving-label"><span className="spinner tiny" /> Saving</span>
            ) : saved ? (
              <span className="saved-label"><Check size={14} /> Saved</span>
            ) : (
              <span className="idle-label">Changes save automatically</span>
            )}
            <button type="button" className="secondary-button" onClick={() => void openInternal("xuvon://about")}>
              About Xuvon
            </button>
          </div>
        </header>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() =>
                  document.getElementById(`settings-${section.id}`)?.scrollIntoView({
                    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                    block: "start"
                  })
                }
              >
                <span>{section.icon}</span>
                {section.label}
              </button>
            ))}
            <div className="settings-nav-note">
              <Lock size={14} />
              Stored locally in Xuvon's data folder.
            </div>
          </nav>

          <div className="settings-content">
            <Section
              id="settings-appearance"
              title="Appearance"
              description="A quiet palette that follows you, or one you choose yourself."
            >
              <SettingRow title="Theme" description="System follows your operating system's light or dark preference." vertical>
                <Segmented<ThemeSetting>
                  value={settings.theme}
                  label="Theme"
                  options={[
                    { value: "system", label: "System", icon: <Monitor size={15} /> },
                    { value: "light", label: "Light", icon: <Sun size={15} /> },
                    { value: "dark", label: "Dark", icon: <Moon size={15} /> }
                  ]}
                  onChange={(theme) => void apply({ theme })}
                />
              </SettingRow>
              <div className="theme-preview-grid">
                <div className="theme-preview preview-light">
                  <span className="preview-bar" />
                  <span className="preview-card" />
                  <span className="preview-line" />
                </div>
                <div className="theme-preview preview-dark">
                  <span className="preview-bar" />
                  <span className="preview-card" />
                  <span className="preview-line" />
                </div>
              </div>

              <SettingRow
                title="Accent color"
                description="Recolors buttons, highlights, and the protected-site shield. The signature mint remains the default."
                vertical
              >
                <div className="accent-options" role="group" aria-label="Accent color">
                  {ACCENT_OPTIONS.map((option) => {
                    const active = settings.accentTheme === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={`accent-option ${active ? "is-active" : ""}`}
                        aria-pressed={active}
                        onClick={() => {
                          if (option.id !== "custom" && accentTimer.current) {
                            clearTimeout(accentTimer.current);
                            accentTimer.current = null;
                          }
                          if (option.id === "custom") {
                            void apply({
                              accentTheme: "custom",
                              accentColor: (accentDraft ?? settings.accentColor) || "#c9f5e2"
                            });
                          } else {
                            void apply({ accentTheme: option.id });
                          }
                        }}
                      >
                        <span className="accent-swatch" style={{ background: option.swatch }}>
                          {active ? <Check size={11} /> : null}
                        </span>
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
                {settings.accentTheme === "custom" ? (
                  <div className="custom-accent">
                    <span className="custom-accent-label">
                      <Palette size={13} />
                      Custom color
                    </span>
                    <input
                      type="color"
                      className="color-input"
                      value={accentDraft ?? settings.accentColor ?? "#c9f5e2"}
                      aria-label="Custom accent color"
                      onChange={(event) => updateCustomAccent(event.target.value)}
                    />
                    <code>{accentDraft ?? settings.accentColor ?? "#c9f5e2"}</code>
                  </div>
                ) : null}
              </SettingRow>

              <SettingRow
                title="New tab wallpaper"
                description="Wallpapers are copied into Xuvon's local data folder and never uploaded. Choose a preset or one of your own images."
                vertical
              >
                <div className="wallpaper-grid" role="group" aria-label="New tab wallpaper">
                  {WALLPAPER_OPTIONS.map((option) => {
                    const active = settings.wallpaperId === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={`wallpaper-option ${active ? "is-active" : ""}`}
                        aria-pressed={active}
                        onClick={() => void apply({ wallpaperId: option.id })}
                      >
                        <span className="wallpaper-thumb" data-wallpaper={option.id}>
                          {option.id === "none" ? (
                            <span className="wallpaper-signature">X</span>
                          ) : null}
                        </span>
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className={`custom-wallpaper-row ${settings.wallpaperId === "custom" ? "is-active" : ""}`}>
                  {settings.wallpaperId === "custom" && settings.wallpaperPath ? (
                    <span
                      className="custom-wallpaper-thumb"
                      style={{
                        backgroundImage: `url("xuvon-asset://wallpaper/${encodeURIComponent(
                          settings.wallpaperPath
                        )}")`
                      }}
                      aria-hidden="true"
                    />
                  ) : (
                    <span className="custom-wallpaper-thumb placeholder" aria-hidden="true">
                      <ImageIcon size={18} />
                    </span>
                  )}
                  <div className="custom-wallpaper-copy">
                    <strong>
                      {settings.wallpaperId === "custom" ? "Custom image" : "Your own image"}
                    </strong>
                    <span>
                      {settings.wallpaperId === "custom" && settings.wallpaperPath
                        ? settings.wallpaperPath
                        : "PNG, JPEG, WebP, GIF, AVIF, or BMP · up to 30 MB"}
                    </span>
                  </div>
                  <div className="custom-wallpaper-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={wallpaperBusy}
                      onClick={async () => {
                        setWallpaperBusy(true);
                        try {
                          await chooseWallpaper();
                        } finally {
                          setWallpaperBusy(false);
                        }
                      }}
                    >
                      {wallpaperBusy
                        ? "Choosing…"
                        : settings.wallpaperId === "custom"
                          ? "Replace image…"
                          : "Choose image…"}
                    </button>
                    {settings.wallpaperId === "custom" ? (
                      <button
                        type="button"
                        className="text-button"
                        disabled={wallpaperBusy}
                        onClick={async () => {
                          setWallpaperBusy(true);
                          try {
                            await removeWallpaper();
                          } finally {
                            setWallpaperBusy(false);
                          }
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
              </SettingRow>
            </Section>

            <Section
              id="settings-search"
              title="Search"
              description="Xuvon resolves searches and addresses in Rust. Your provider receives the query directly."
            >
              <SettingRow title="Default provider" description={provider?.description ?? "Choose where searches go."}>
                <select
                  className="select"
                  value={settings.searchProvider}
                  onChange={(event) => void apply({ searchProvider: event.target.value })}
                >
                  {providers.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </SettingRow>
              {provider ? (
                <div className="inline-note">
                  <Info size={15} />
                  <span>{provider.privacyNote}</span>
                </div>
              ) : null}
              <div className="custom-search">
                <div className="custom-search-heading">
                  <div>
                    <h3>Custom OpenSearch template</h3>
                    <p>Use %s for the query. For example: https://example.com/search?q=%s</p>
                  </div>
                  {customConfigured ? <span className="soft-chip">Configured</span> : null}
                </div>
                <div className="field-row">
                  <label className="field">
                    <span>Name</span>
                    <input
                      value={customName}
                      onChange={(event) => setCustomName(event.target.value)}
                      placeholder="My search"
                      maxLength={80}
                    />
                  </label>
                  <label className="field grow">
                    <span>Query URL</span>
                    <input
                      value={customUrl}
                      onChange={(event) => setCustomUrl(event.target.value)}
                      placeholder="https://my.search/?q=%s"
                      spellCheck={false}
                    />
                  </label>
                </div>
                <div className="button-row">
                  <button type="button" className="secondary-button" onClick={() => void saveCustomSearch()} disabled={!customUrl.trim()}>
                    Use custom provider
                  </button>
                  {customConfigured ? (
                    <button type="button" className="text-button danger-text" onClick={() => void clearCustomSearch()}>
                      Remove custom
                    </button>
                  ) : null}
                </div>
              </div>
            </Section>

            <Section
              id="settings-startup"
              title="Startup"
              description="Choose what greets you when Xuvon opens."
            >
              <SettingRow title="When Xuvon starts" vertical>
                <Segmented<StartupBehavior>
                  value={settings.startupBehavior}
                  label="Startup behavior"
                  options={[
                    { value: "newtab", label: "New tab" },
                    { value: "restore", label: "Restore session" },
                    { value: "homepage", label: "Open homepage" }
                  ]}
                  onChange={(value) => void apply({ startupBehavior: value })}
                />
              </SettingRow>
              <SettingRow
                title="Homepage"
                description="An HTTP(S) or xuvon:// page. Leave blank to use the new tab page."
              >
                <div className="inline-field">
                  <input
                    className="text-input"
                    value={homepage}
                    onChange={(event) => setHomepage(event.target.value)}
                    onBlur={() => {
                      if (homepage !== settings.homepage) void apply({ homepage: homepage.trim() });
                    }}
                    placeholder="xuvon://newtab"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    disabled={homepage === settings.homepage}
                    onClick={() => void apply({ homepage: homepage.trim() })}
                  >
                    Save
                  </button>
                </div>
              </SettingRow>
              {settings.startupBehavior === "restore" ? (
                <div className="inline-note">
                  <Info size={15} />
                  <span>Only normal-profile tabs are saved. Private and Tor tabs are intentionally excluded.</span>
                </div>
              ) : null}
              <SettingRow
                title="Import browser data"
                description="Bring bookmarks and a portable homepage/startup choice from another browser. You can return here whenever you like."
              >
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void openInternal("xuvon://welcome")}
                >
                  <Bookmark size={15} />
                  Import bookmarks &amp; settings
                </button>
              </SettingRow>
            </Section>

            <Section
              id="settings-downloads"
              title="Downloads"
              description="Chromium writes files; Xuvon records metadata and protects dangerous extensions."
            >
              <SettingRow title="Download folder" description="Files are saved here unless you choose a location for each download.">
                <div className="inline-field">
                  <input
                    className="text-input path-input"
                    value={downloadPath}
                    onChange={(event) => setDownloadPath(event.target.value)}
                    onBlur={() => {
                      if (downloadPath !== settings.downloadDirectory) {
                        void apply({ downloadDirectory: downloadPath.trim() });
                      }
                    }}
                    placeholder={app?.downloadsDir ?? "System Downloads folder"}
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    onClick={async () => {
                      const bundle = await chooseDownloadDirectory();
                      if (bundle) flashSaved();
                    }}
                  >
                    Choose…
                  </button>
                </div>
              </SettingRow>
              <SettingRow
                title="Ask where to save each file"
                description="Open a save dialog for every download instead of using the folder above."
              >
                <Toggle
                  label="Ask where to save each file"
                  checked={settings.askWhereToSave}
                  onChange={(value) => void apply({ askWhereToSave: value })}
                />
              </SettingRow>
              <div className="inline-note">
                <AlertTriangle size={15} />
                <span>Executable downloads are flagged but never opened automatically. Xuvon cannot protect you after you open a file in another app.</span>
              </div>
            </Section>

            <Section
              id="settings-privacy"
              title="Privacy"
              description="Boundaries enforced in each Chromium session, not just a settings screen."
            >
              <SettingRow
                title="Cookies"
                description="Blocking third-party cookies is stricter and may break embedded sign-ins. Session-only downgrades persistent cookies and still drops third-party ones."
              >
                <select
                  className="select"
                  value={settings.cookiePolicy}
                  onChange={(event) => void apply({ cookiePolicy: event.target.value as CookiePolicy })}
                >
                  <option value="allow_all">Allow cookies</option>
                  <option value="block_third_party">Block third-party cookies</option>
                  <option value="session_only">Session cookies only</option>
                </select>
              </SettingRow>
              <SettingRow
                title="Ad & tracker blocker"
                description={
                  adblock
                    ? `Cancels matching requests before they load using ${adblock.ruleCount} precompiled Xuvon network rules. No third-party filter list is bundled.`
                    : "Cancels matching requests before they load using precompiled Xuvon network rules. No third-party filter list is bundled."
                }
              >
                <Toggle
                  label="Ad and tracker blocker"
                  checked={settings.adblockEnabled}
                  onChange={(value) => void apply({ adblockEnabled: value })}
                />
              </SettingRow>
              <div className="inline-note">
                <Info size={15} />
                <span>
                  Xuvon supports a documented subset of Adblock Plus network syntax, including
                  domain scoping, resource types, third-party conditions, and exception rules.
                  This is not an EasyList or uBlock Origin engine. There is no cosmetic
                  filtering, so some empty ad slots can remain. The toolbar shield shows per-tab
                  counts and lets you pause blocking for one site.
                </span>
              </div>
              <details className="adblock-syntax">
                <summary>Supported rule syntax, lists, and limits</summary>
                <div className="adblock-syntax-columns">
                  <div>
                    <strong>Supported</strong>
                    <ul>
                      <li>
                        <code>||host^</code>, path patterns, <code>*</code> wildcards,
                        <code>^</code> separators, and edge anchors
                      </li>
                      <li>
                        <code>$document</code>, <code>$subdocument</code>, <code>$script</code>,
                        <code>$image</code>, <code>$stylesheet</code>, <code>$font</code>,{" "}
                        <code>$media</code>, <code>$xhr</code>, <code>$websocket</code>,{" "}
                        <code>$ping</code>, <code>$object</code>, and <code>$other</code>
                      </li>
                      <li>
                        <code>$third-party</code>, <code>$~third-party</code>, and{" "}
                        <code>$first-party</code>
                      </li>
                      <li>
                        <code>$domain=example.com|~shop.example.com</code> for top-level page
                        scoping
                      </li>
                      <li>
                        <code>@@</code> exception rules; exceptions win over blocking rules
                      </li>
                    </ul>
                  </div>
                  <div>
                    <strong>Not supported</strong>
                    <ul>
                      <li>Full EasyList, uBlock Origin, or Adblock Plus compatibility</li>
                      <li>
                        Cosmetic filters (<code>##</code>), scriptlets, and regular-expression
                        filters
                      </li>
                      <li>
                        <code>$removeparam</code>, <code>$redirect</code>, <code>$csp</code>,{" "}
                        <code>$denyallow</code>, and <code>$important</code>
                      </li>
                      <li>Custom rules and automatic filter-list updates</li>
                    </ul>
                  </div>
                </div>
                {adblock ? (
                  <p className="adblock-attribution">
                    {adblock.listName} v{adblock.listVersion} ({adblock.ruleCount} rules, including{" "}
                    {adblock.exceptionRuleCount} exceptions; updated {adblock.updatedAt}) is
                    original Xuvon data under the {adblock.license} license. EasyList and uBlock
                    Origin list data are not bundled or copied. Rules ship with app releases;
                    Xuvon does not download filter lists. Limits: 10,000 compiled rules, 64
                    domain entries per rule, and 12 wildcards per rule. Syntax is based on
                    Adblock Plus network-filter documentation, not a compatibility claim.
                  </p>
                ) : null}
              </details>
              {settings.adblockAllowlist.length > 0 ? (
                <div className="allowlist-card">
                  <div className="allowlist-head">
                    <strong>Sites where ad blocking is paused</strong>
                    <span>{settings.adblockAllowlist.length}</span>
                  </div>
                  <div className="allowlist-rows">
                    {settings.adblockAllowlist.map((host) => (
                      <div className="allowlist-row" key={host}>
                        <Globe size={13} />
                        <span className="allowlist-host">{host}</span>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() =>
                            void apply({
                              adblockAllowlist: settings.adblockAllowlist.filter(
                                (entry) => entry !== host
                              )
                            })
                          }
                        >
                          Resume
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <SettingRow
                title="Send Do Not Track"
                description="Ask sites not to track you. Many sites ignore this header."
              >
                <Toggle
                  label="Send Do Not Track"
                  checked={settings.sendDoNotTrack}
                  onChange={(value) => void apply({ sendDoNotTrack: value })}
                />
              </SettingRow>
              <SettingRow
                title="Clear data when Xuvon closes"
                description="Clear normal-profile cookies, site storage, and cache on exit. History and bookmarks are kept."
              >
                <Toggle
                  label="Clear data when Xuvon closes"
                  checked={settings.clearDataOnExit}
                  onChange={(value) => void apply({ clearDataOnExit: value })}
                />
              </SettingRow>
              <div className="danger-zone">
                <div>
                  <strong>Clear normal-profile browsing data</strong>
                  <p>Removes history, cookies, site storage, and cache. Private and Tor sessions are already isolated.</p>
                </div>
                <button
                  type="button"
                  className="secondary-button danger"
                  disabled={clearing}
                  onClick={async () => {
                    setClearing(true);
                    try {
                      await clearBrowsingData();
                    } finally {
                      setClearing(false);
                    }
                  }}
                >
                  <Trash size={15} />
                  {clearing ? "Clearing…" : "Clear browsing data"}
                </button>
              </div>
              <p className="fineprint">
                Private and Tor tabs use separate in-memory partitions. Extensions are never loaded into
                those sessions. Permission requests for camera, microphone, location, and similar APIs are
                denied by default.
              </p>
            </Section>

            <Section
              id="settings-network"
              title="Tor & network"
              description="Optional clear-web routing. Xuvon verifies a real Tor circuit and fails closed."
            >
              <div className={`tor-status-card tone-${infoTone}`}>
                <div className="tor-status-icon">
                  <Onion size={24} />
                  <span className="tor-status-dot" />
                </div>
                <div className="tor-status-copy">
                  <div className="tor-status-title">
                    <strong>
                      {tor.status === "available"
                        ? "Verified Tor circuit"
                        : tor.status === "checking"
                          ? "Checking circuit"
                          : settings.torEnabled
                            ? "Tor unavailable"
                            : "Tor is off"}
                    </strong>
                    <span className={`status-pill status-${tor.status}`}>{tor.status}</span>
                  </div>
                  <p>
                    {tor.status === "available"
                      ? `${tor.message ?? "Traffic is routed through Tor."} Exit ${tor.exitIp ?? "unknown"}${
                          tor.checkedAt ? ` · ${formatDateTime(tor.checkedAt)}` : ""
                        }.`
                      : settings.torEnabled
                        ? tor.message ?? "Xuvon will not fall back to a direct connection."
                        : "Normal tabs connect directly. Private tabs always use direct connections, even when Tor is enabled."}
                  </p>
                  <div className="tor-meta">
                    <span>Proxy</span>
                    <code>{tor.proxy || settings.torProxy}</code>
                  </div>
                </div>
                <div className="tor-controls">
                  <Toggle
                    label="Enable Tor routing"
                    checked={settings.torEnabled}
                    disabled={torBusy}
                    onChange={(value) => void toggleTor(value)}
                  />
                  <button type="button" className="secondary-button compact-button" disabled={torChecking || torBusy} onClick={() => void verifyTor()}>
                    {torChecking ? "Verifying…" : "Check circuit"}
                  </button>
                </div>
              </div>

              <SettingRow
                title="Tor SOCKS5 proxy"
                description="A local Tor daemon is recommended. Disable Tor before changing this address."
              >
                <div className="inline-field">
                  <input
                    className="text-input"
                    value={torProxy}
                    onChange={(event) => setTorProxy(event.target.value)}
                    onBlur={() => {
                      if (torProxy !== settings.torProxy) void apply({ torProxy: torProxy.trim() });
                    }}
                    disabled={settings.torEnabled}
                    placeholder="socks5://127.0.0.1:9050"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    disabled={settings.torEnabled || torProxy === settings.torProxy}
                    onClick={() => void apply({ torProxy: torProxy.trim() })}
                  >
                    Save
                  </button>
                </div>
              </SettingRow>
              <div className="inline-note">
                <Lock size={15} />
                <span>
                  Xuvon blocks .onion destinations before DNS in every mode; this is not an onion browser.
                  Tor can reduce network-level identification but does not make you anonymous. Downloads,
                  logins, extensions, and browser fingerprints can still identify you.
                </span>
              </div>
            </Section>

            <Section
              id="settings-extensions"
              title="Extensions"
              description="Unpacked Chromium extensions only, loaded into the normal profile."
              action={
                <button type="button" className="secondary-button compact-button" onClick={() => void addExtension()} disabled={!settings.extensionsEnabled || extensionBusy === "add"}>
                  {extensionBusy === "add" ? "Adding…" : "Add unpacked…"}
                </button>
              }
            >
              <SettingRow
                title="Enable extensions"
                description="Private and Tor sessions never load extensions. Disabling this unloads them until restart."
              >
                <Toggle
                  label="Enable extensions"
                  checked={settings.extensionsEnabled}
                  onChange={(value) => void apply({ extensionsEnabled: value })}
                />
              </SettingRow>
              {!settings.extensionsEnabled ? (
                <div className="inline-note warn">
                  <XCircle size={15} />
                  <span>Extensions are disabled. Existing records are kept, but nothing is loaded into Chromium.</span>
                </div>
              ) : null}
              {extensions.length === 0 ? (
                <div className="extension-empty">
                  <Puzzle size={24} />
                  <div>
                    <strong>No extensions loaded</strong>
                    <p>Chrome Web Store installation and packed .crx files are not supported. Add a local unpacked extension folder instead.</p>
                  </div>
                </div>
              ) : (
                <div className="extension-list">
                  {extensions.map((extension) => (
                    <div key={extension.id} className="extension-row">
                      <span className="extension-icon"><Puzzle size={18} /></span>
                      <div className="extension-copy">
                        <div className="extension-title">
                          <strong>{extension.name}</strong>
                          <span>v{extension.version}</span>
                          {extension.loaded ? <span className="soft-chip success">Loaded</span> : <span className="soft-chip">Not loaded</span>}
                        </div>
                        <p className="extension-path" title={extension.path}>{extension.path}</p>
                        {extension.permissions.length > 0 ? (
                          <div className="permission-chips">
                            {extension.permissions.slice(0, 6).map((permission) => (
                              <span key={permission}>{permission}</span>
                            ))}
                            {extension.permissions.length > 6 ? <span>+{extension.permissions.length - 6}</span> : null}
                          </div>
                        ) : (
                          <p className="fineprint">No explicit permissions declared.</p>
                        )}
                        {extension.loadError ? <p className="download-error">{extension.loadError}</p> : null}
                      </div>
                      <div className="extension-actions">
                        <Toggle
                          label={`${extension.enabled ? "Disable" : "Enable"} ${extension.name}`}
                          checked={extension.enabled}
                          disabled={extensionBusy === extension.id || !settings.extensionsEnabled}
                          onChange={() => void toggleExtension(extension)}
                        />
                        <button
                          type="button"
                          className="icon-button compact danger-hover"
                          title="Remove extension"
                          aria-label={`Remove ${extension.name}`}
                          disabled={extensionBusy === extension.id}
                          onClick={() => void removeExtension(extension)}
                        >
                          <Trash size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="inline-note">
                <Info size={15} />
                <span>
                  Electron supports a subset of Chrome extension APIs. Some extensions will not work, and
                  extension code is not reviewed by Xuvon. Load only extensions you trust.
                </span>
              </div>
            </Section>

            <Section id="settings-performance" title="Performance" description="Keep idle tabs from holding on to memory.">
              <SettingRow
                title="Sleep background tabs"
                description="Unload the page after it has been idle. Activating the tab reloads it."
              >
                <Toggle
                  label="Sleep background tabs"
                  checked={settings.tabSleepEnabled}
                  onChange={(value) => void apply({ tabSleepEnabled: value })}
                />
              </SettingRow>
              <SettingRow
                title="Idle before sleeping"
                description="Between 1 and 240 minutes. Playing audio and the active tab are never slept."
              >
                <div className="inline-field short">
                  <input
                    className="text-input number-input"
                    type="number"
                    min={1}
                    max={240}
                    value={sleepMinutes}
                    disabled={!settings.tabSleepEnabled}
                    onChange={(event) => setSleepMinutes(event.target.value)}
                    onBlur={() => void saveSleepMinutes()}
                  />
                  <span className="unit-label">minutes</span>
                </div>
              </SettingRow>
            </Section>

            <Section id="settings-developer" title="Developer" description="Tools for inspecting real pages. Developer Mode is off by default.">
              <SettingRow
                title="Developer Mode"
                description="Enables the Developer Tools menu and page inspector. Inspecting a tab grants access to its page context."
              >
                <Toggle
                  label="Developer Mode"
                  checked={settings.devMode}
                  onChange={(value) => void apply({ devMode: value })}
                />
              </SettingRow>
              <SettingRow title="Inspect active page" description="Opens Chromium DevTools for the active web tab.">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!settings.devMode || !activeTab || Boolean(activeTab.internalUrl)}
                  onClick={() => {
                    if (!activeTab) return;
                    void perform(() => window.xuvon.tabs.toggleDevTools(activeTab.id));
                  }}
                >
                  <Code size={15} />
                  Toggle DevTools
                </button>
              </SettingRow>
              <dl className="details-grid small-grid">
                <div><dt>Electron</dt><dd>{app?.electron ?? "—"}</dd></div>
                <div><dt>Chromium</dt><dd>{app?.chromium ?? "—"}</dd></div>
                <div><dt>Data folder</dt><dd>{app?.dataDir ?? "—"}</dd></div>
                <div><dt>Log</dt><dd>{app?.logPath ?? "—"}</dd></div>
              </dl>
              <div className="button-row">
                <button type="button" className="secondary-button" onClick={() => void openDataDirectory()}>
                  Open data folder
                </button>
              </div>
            </Section>

            <Section id="settings-about" title="About & reset" description="Start over without deleting your bookmarks or files.">
              <SettingRow
                title="Restore default settings"
                description="Resets appearance, search, startup, privacy, network, extension, and performance settings. Bookmarks, history, and downloaded files are kept. Tor is turned off if active."
              >
                <button
                  type="button"
                  className={`secondary-button danger ${confirmReset ? "is-confirming" : ""}`}
                  onClick={() => void resetWithConfirmation()}
                >
                  <Trash size={15} />
                  {confirmReset ? "Click again to confirm" : "Reset settings"}
                </button>
              </SettingRow>
              <div className="about-links">
                <button type="button" className="secondary-button" onClick={() => void openInternal("xuvon://about")}>
                  <Globe size={15} />
                  About, licenses & build details
                </button>
                <span className="fineprint">Version {app?.version ?? "0.1.0"} · {app?.platform ?? "—"} · {app?.arch ?? "—"}</span>
              </div>
            </Section>
          </div>
        </div>

        <footer className="page-footer">
          <span>Made with love by Seb &lt;3</span>
          <span className="footer-dot" />
          <span>Settings are validated in Rust and stored as an atomic JSON document.</span>
        </footer>
      </div>
    </div>
  );
}
