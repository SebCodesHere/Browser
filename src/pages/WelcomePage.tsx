import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BrowserImportFormat,
  BrowserImportSource,
  ImportPreview,
  StartupBehavior
} from "../../shared/types";
import { useBrowser } from "../BrowserContext";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  CheckCircle,
  External,
  File,
  Folder,
  Globe,
  Info,
  Lock,
  Reload,
  Shield,
  ShieldAlert,
  Sparkles,
  X,
  XCircle,
  XuvonMark
} from "../components/Icons";
import { messageOf } from "../lib/format";

interface SourceEntry {
  source: BrowserImportSource;
  preview: ImportPreview | null;
  loading: boolean;
  error: string | null;
}

interface ImportTotals {
  imported: number;
  skipped: number;
  invalid: number;
  folders: number;
}

const EMPTY_TOTALS: ImportTotals = {
  imported: 0,
  skipped: 0,
  invalid: 0,
  folders: 0
};

const FORMAT_LABELS: Record<BrowserImportFormat, string> = {
  chromium: "Chromium format",
  firefox: "Firefox",
  safari: "Safari",
  html: "HTML export",
  mixed: "Mixed data",
  unknown: "Browser data"
};

const STARTUP_LABELS: Record<StartupBehavior, string> = {
  newtab: "New tab",
  restore: "Restore session",
  homepage: "Open homepage"
};

type Step = "welcome" | "import" | "done";

function sourceKey(source: BrowserImportSource): string {
  return `${source.bookmarksPath ?? ""}\u0000${source.settingsPath ?? ""}`;
}

function hasSettingsValues(preview: ImportPreview | null): boolean {
  return Boolean(preview?.settings?.homepage || preview?.settings?.startupBehavior);
}

const DISK_ACCESS_ERROR =
  /full disk access|operation not permitted|permission denied|permission|not permitted|denied|eperm|eacces/i;

function isDiskAccessError(message: string | null | undefined): boolean {
  return Boolean(message && DISK_ACCESS_ERROR.test(message));
}

function sourceHasDiskAccessError(entry: SourceEntry): boolean {
  return (
    isDiskAccessError(entry.error) ||
    Boolean(entry.preview?.warnings.some((warning) => isDiskAccessError(warning)))
  );
}

export function WelcomePage() {
  const {
    activeTab,
    onboardingCompleted,
    completeOnboarding,
    updateSettings,
    openInternal,
    navigate,
    notify
  } = useBrowser();
  const wasCompleted = useRef(onboardingCompleted).current;
  const knownSources = useRef(new Set<string>());
  const settingsTouched = useRef(false);
  const isMac = window.xuvon.platform === "darwin";
  const [step, setStep] = useState<Step>("welcome");
  const [sources, setSources] = useState<SourceEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [settingsSourceId, setSettingsSourceId] = useState("none");
  const [detecting, setDetecting] = useState(true);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<"file" | "folder" | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [diskAccessHelp, setDiskAccessHelp] = useState(false);
  const [importing, setImporting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [totals, setTotals] = useState<ImportTotals>(EMPTY_TOTALS);
  const [importedSettings, setImportedSettings] = useState(false);

  const previewSource = useCallback(async (entry: BrowserImportSource) => {
    setSources((current) =>
      current.map((item) =>
        item.source.id === entry.id ? { ...item, loading: true, error: null } : item
      )
    );
    try {
      const preview = await window.xuvon.imports.preview({
        bookmarksPath: entry.bookmarksPath,
        settingsPath: entry.settingsPath
      });
      setSources((current) =>
        current.map((item) =>
          item.source.id === entry.id ? { ...item, preview, loading: false } : item
        )
      );
    } catch (error) {
      setSources((current) =>
        current.map((item) =>
          item.source.id === entry.id
            ? { ...item, preview: null, loading: false, error: messageOf(error) }
            : item
        )
      );
    }
  }, []);

  const addSources = useCallback(
    (incoming: BrowserImportSource[]): number => {
      const accepted: BrowserImportSource[] = [];
      for (const item of incoming) {
        const key = sourceKey(item);
        if (knownSources.current.has(key)) continue;
        knownSources.current.add(key);
        accepted.push(item);
      }
      if (accepted.length === 0) return 0;
      setSources((current) => [
        ...current,
        ...accepted.map((item) => ({
          source: item,
          preview: null,
          loading: false,
          error: null
        }))
      ]);
      setSelected((current) => {
        const next = new Set(current);
        for (const item of accepted) {
          if (item.bookmarksPath) next.add(item.id);
        }
        return next;
      });
      for (const item of accepted) void previewSource(item);
      return accepted.length;
    },
    [previewSource]
  );

  useEffect(() => {
    let canceled = false;
    window.xuvon.imports
      .detect()
      .then((found) => {
        if (!canceled) addSources(found);
      })
      .catch((error) => {
        if (!canceled) setDetectError(messageOf(error));
      })
      .finally(() => {
        if (!canceled) setDetecting(false);
      });
    return () => {
      canceled = true;
    };
  }, [addSources]);

  useEffect(() => {
    if (settingsTouched.current) return;
    const candidate = sources.find(
      (entry) => !entry.loading && hasSettingsValues(entry.preview)
    );
    if (candidate && settingsSourceId === "none") {
      setSettingsSourceId(candidate.source.id);
    }
  }, [sources, settingsSourceId]);

  const bookmarkSources = useMemo(
    () =>
      sources.filter(
        (entry) =>
          entry.source.bookmarksPath &&
          entry.preview?.bookmarks &&
          entry.preview.bookmarks.count > 0
      ),
    [sources]
  );
  const selectedBookmarkSources = useMemo(
    () => bookmarkSources.filter((entry) => selected.has(entry.source.id)),
    [bookmarkSources, selected]
  );
  const selectedBookmarkCount = selectedBookmarkSources.reduce(
    (sum, entry) => sum + (entry.preview?.bookmarks?.count ?? 0),
    0
  );
  const settingsOptions = useMemo(
    () => sources.filter((entry) => hasSettingsValues(entry.preview)),
    [sources]
  );
  const chosenSettings = settingsOptions.find(
    (entry) => entry.source.id === settingsSourceId
  );
  const previewsLoading = sources.some((entry) => entry.loading);
  const diskAccessBlocked = sources.some(sourceHasDiskAccessError);
  const showDiskAccessHelp =
    isMac && (diskAccessHelp || diskAccessBlocked || isDiskAccessError(detectError));
  const actionBusy =
    importing ||
    finishing ||
    checkingAccess ||
    choosing !== null ||
    (detecting && sources.length === 0);

  const toggleSource = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openDiskAccess = async () => {
    setDiskAccessHelp(true);
    try {
      await window.xuvon.app.openFullDiskAccessSettings();
      notify({
        tone: "info",
        message:
          "Turn on Xuvon Browser under Full Disk Access, then return here and choose Check again."
      });
    } catch (error) {
      notify({ tone: "error", message: messageOf(error) });
    }
  };

  const recheckSources = async () => {
    if (checkingAccess) return;
    setCheckingAccess(true);
    setDetectError(null);
    try {
      try {
        const found = await window.xuvon.imports.detect();
        addSources(found);
      } catch (error) {
        setDetectError(messageOf(error));
      }
      // Re-read every source already on screen. Newly detected sources are
      // previewed by addSources, and re-reading existing ones picks up a TCC
      // permission change without requiring an app restart.
      await Promise.all(sources.map((entry) => previewSource(entry.source)));
    } finally {
      setCheckingAccess(false);
      setDiskAccessHelp(false);
    }
  };

  const choose = async (kind: "file" | "folder") => {
    setChoosing(kind);
    try {
      const found = await window.xuvon.imports.choose(kind);
      if (found.length === 0) return;
      const accepted = addSources(found);
      if (accepted === 0) {
        notify({ tone: "info", message: "That browser profile is already in the import list." });
      }
    } catch (error) {
      notify({ tone: "error", message: messageOf(error) });
    } finally {
      setChoosing(null);
    }
  };

  const removeSource = (entry: SourceEntry) => {
    knownSources.current.delete(sourceKey(entry.source));
    setSources((current) =>
      current.filter((item) => item.source.id !== entry.source.id)
    );
    setSelected((current) => {
      const next = new Set(current);
      next.delete(entry.source.id);
      return next;
    });
    if (settingsSourceId === entry.source.id) {
      settingsTouched.current = false;
      setSettingsSourceId("none");
    }
  };

  const leave = async (markComplete: boolean, target: string) => {
    if (markComplete) {
      const completed = await completeOnboarding();
      if (!completed) return;
    }
    setFinishing(true);
    try {
      if (activeTab) await navigate(activeTab.id, target);
      else await openInternal(target);
    } catch (error) {
      notify({ tone: "error", message: messageOf(error) });
      setFinishing(false);
    }
  };

  const skip = async () => {
    await leave(true, wasCompleted ? "xuvon://settings" : "xuvon://newtab");
  };

  const runImport = async () => {
    if (importing) return;
    setImporting(true);
    setErrors([]);
    const nextErrors: string[] = [];
    const aggregate = { ...EMPTY_TOTALS };
    let appliedSettings = false;

    for (const entry of selectedBookmarkSources) {
      if (!entry.source.bookmarksPath) continue;
      try {
        const result = await window.xuvon.imports.commit(entry.source.bookmarksPath);
        aggregate.imported += result.imported;
        aggregate.skipped += result.skipped;
        aggregate.invalid += result.invalid;
        aggregate.folders += result.folders;
      } catch (error) {
        nextErrors.push(`${entry.source.label}: ${messageOf(error)}`);
      }
    }

    if (chosenSettings?.preview?.settings) {
      const patch: {
        homepage?: string;
        startupBehavior?: StartupBehavior;
      } = {};
      if (chosenSettings.preview.settings.homepage) {
        patch.homepage = chosenSettings.preview.settings.homepage;
      }
      if (chosenSettings.preview.settings.startupBehavior) {
        patch.startupBehavior = chosenSettings.preview.settings.startupBehavior;
      }
      if (Object.keys(patch).length > 0) {
        const bundle = await updateSettings(patch);
        if (bundle) appliedSettings = true;
        else nextErrors.push("Homepage and startup settings could not be applied.");
      }
    }

    setTotals(aggregate);
    setImportedSettings(appliedSettings);
    setErrors(nextErrors);
    setImporting(false);
    setStep("done");
  };

  const finish = async () => {
    await leave(
      true,
      wasCompleted ? "xuvon://settings" : "xuvon://newtab"
    );
  };

  const openSettings = async () => {
    setFinishing(true);
    try {
      if (activeTab) await navigate(activeTab.id, "xuvon://settings");
      else await openInternal("xuvon://settings");
    } catch (error) {
      notify({ tone: "error", message: messageOf(error) });
      setFinishing(false);
    }
  };

  return (
    <div className="internal-scroll welcome-scroll welcome-page">
      <div className="page-aura aura-one" aria-hidden="true" />
      <div className="page-aura aura-two" aria-hidden="true" />
      <div className="welcome-shell">
        <header className="welcome-topbar">
          <div className="welcome-brand">
            <XuvonMark size={32} />
            <div>
              <strong>Xuvon</strong>
              <span>旭文瀏覽器</span>
            </div>
          </div>
          <ol className="welcome-steps" aria-label="Setup progress">
            {(["welcome", "import", "done"] as Step[]).map((value, index) => (
              <li
                key={value}
                className={step === value ? "is-current" : ""}
                aria-current={step === value ? "step" : undefined}
              >
                <span>{step === "done" && value !== "done" ? <Check size={11} /> : index + 1}</span>
                <small>{value === "welcome" ? "Welcome" : value === "import" ? "Import" : "Ready"}</small>
              </li>
            ))}
          </ol>
          {step === "welcome" ? (
            <button type="button" className="text-button welcome-skip" onClick={() => void skip()}>
              {wasCompleted ? "Cancel" : "Skip for now"}
            </button>
          ) : step === "done" ? (
            <button type="button" className="text-button welcome-skip" onClick={() => void openSettings()}>
              Settings
            </button>
          ) : (
            <span />
          )}
        </header>

        {step === "welcome" ? (
          <main className="welcome-hero">
            <section className="welcome-hero-copy">
              <span className="eyebrow">First light</span>
              <h1>
                A quieter window
                <span>into the web.</span>
              </h1>
              <p>
                Xuvon is a local-first browser with a Rust core and Chromium rendering.
                Bring your bookmarks and the parts of browser settings that travel well.
              </p>
              <div className="welcome-points">
                <div>
                  <span className="welcome-point-icon"><Bookmark size={17} /></span>
                  <div>
                    <strong>Bring your bookmarks</strong>
                    <p>Import from Chrome, Chromium, Brave, Edge, Vivaldi, Opera, Firefox, or Safari.</p>
                  </div>
                </div>
                <div>
                  <span className="welcome-point-icon"><Globe size={17} /></span>
                  <div>
                    <strong>Keep your homepage</strong>
                    <p>Carry over a portable homepage and startup choice. Nothing more is touched.</p>
                  </div>
                </div>
                <div>
                  <span className="welcome-point-icon"><Lock size={17} /></span>
                  <div>
                    <strong>No account, no upload</strong>
                    <p>Browser data is read on this device and written to Xuvon's local database.</p>
                  </div>
                </div>
              </div>
              <div className="welcome-actions">
                <button type="button" className="primary-button welcome-primary" onClick={() => setStep("import")}>
                  Set up Xuvon
                  <ArrowRight size={16} />
                </button>
                <button type="button" className="text-button" onClick={() => void skip()}>
                  I'll start fresh
                </button>
              </div>
            </section>

            <aside className="welcome-poster" aria-hidden="true">
              <div className="welcome-poster-glow" />
              <div className="welcome-poster-mark"><XuvonMark size={74} /></div>
              <div className="welcome-poster-card">
                <span className="poster-label">Your library</span>
                <div className="poster-row"><span className="poster-dot mint" /><span>Bookmarks</span><span className="poster-count">brought over</span></div>
                <div className="poster-row"><span className="poster-dot peach" /><span>Homepage</span><span className="poster-count">kept</span></div>
                <div className="poster-row"><span className="poster-dot sky" /><span>Passwords</span><span className="poster-count">never read</span></div>
              </div>
              <div className="welcome-poster-footer">
                <Sparkles size={14} />
                <span>Made with AI · completely vibecoded</span>
              </div>
            </aside>
          </main>
        ) : null}

        {step === "import" ? (
          <main className="welcome-panel">
            <header className="welcome-panel-head">
              <div>
                <span className="eyebrow">Bring your library</span>
                <h1>Import browser data</h1>
                <p>
                  Review what Xuvon found. You choose the bookmark sources and one set of
                  portable homepage/startup settings.
                </p>
              </div>
              <button type="button" className="secondary-button" onClick={() => setStep("welcome")}>
                <ArrowLeft size={15} />
                Back
              </button>
            </header>

            <div className="welcome-import-grid">
              <section className="import-panel">
                <div className="import-panel-heading">
                  <div>
                    <h2>Bookmarks</h2>
                    <p>
                      {detecting
                        ? "Looking for browser profiles on this device…"
                        : `${bookmarkSources.length} source${bookmarkSources.length === 1 ? "" : "s"} with readable bookmarks`}
                    </p>
                  </div>
                  <div className="import-panel-actions">
                    {isMac ? (
                      <button
                        type="button"
                        className="secondary-button compact-button disk-access-button"
                        disabled={checkingAccess || importing}
                        onClick={() => void openDiskAccess()}
                        title="Open macOS Full Disk Access settings"
                        data-testid="allow-disk-access"
                      >
                        <ShieldAlert size={14} />
                        Allow disk access…
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="secondary-button compact-button"
                      disabled={choosing !== null || importing || checkingAccess}
                      onClick={() => void choose("file")}
                    >
                      <File size={14} />
                      {choosing === "file" ? "Choosing…" : "Choose file…"}
                    </button>
                    <button
                      type="button"
                      className="secondary-button compact-button"
                      disabled={choosing !== null || importing || checkingAccess}
                      onClick={() => void choose("folder")}
                    >
                      <Folder size={14} />
                      {choosing === "folder" ? "Choosing…" : "Profile folder…"}
                    </button>
                  </div>
                </div>

                {showDiskAccessHelp ? (
                  <div className="import-disk-access" data-testid="disk-access-notice">
                    <span className="import-disk-access-icon">
                      <ShieldAlert size={18} />
                    </span>
                    <div className="import-disk-access-copy">
                      <strong>
                        {diskAccessBlocked
                          ? "macOS is blocking a protected browser file"
                          : "Safari data may need Full Disk Access"}
                      </strong>
                      <p>
                        Open Full Disk Access, add or enable Xuvon Browser, then return
                        here and check again. macOS does not let an app grant this
                        permission itself. If it is already enabled, quit and reopen
                        Xuvon first. You can also export bookmarks to HTML and use
                        Choose file.
                      </p>
                    </div>
                    <div className="import-disk-access-actions">
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => void openDiskAccess()}
                      >
                        <External size={13} />
                        Open settings
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        disabled={checkingAccess}
                        onClick={() => void recheckSources()}
                      >
                        {checkingAccess ? (
                          <span className="spinner tiny" />
                        ) : (
                          <Reload size={13} />
                        )}
                        {checkingAccess ? "Checking…" : "Check again"}
                      </button>
                    </div>
                  </div>
                ) : null}

                {detectError ? (
                  <div className="import-inline-error">
                    <XCircle size={15} />
                    <span>{detectError}</span>
                  </div>
                ) : null}

                <div className="import-source-list" data-testid="import-source-list">
                  {sources.map((entry) => {
                    const bookmarks = entry.preview?.bookmarks;
                    const checked = selected.has(entry.source.id);
                    return (
                      <article
                        className={`import-source ${checked ? "is-selected" : ""}`}
                        key={entry.source.id}
                        data-testid="import-source"
                      >
                        <div className="import-source-main">
                          <label className="import-checkbox-wrap">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!bookmarks || bookmarks.count === 0 || importing}
                              onChange={() => toggleSource(entry.source.id)}
                              aria-label={`Import bookmarks from ${entry.source.label}`}
                            />
                            <span className="import-checkbox" aria-hidden="true">
                              {checked ? <Check size={11} /> : null}
                            </span>
                          </label>
                          <span className="import-source-mark">
                            {entry.source.bookmarksPath ? <Bookmark size={17} /> : <Globe size={17} />}
                          </span>
                          <div className="import-source-copy">
                            <div className="import-source-title">
                              <strong>{entry.source.browser}</strong>
                              <span>{entry.source.profile}</span>
                              <em>{entry.source.origin === "detected" ? "Found" : "Added"}</em>
                            </div>
                            <div className="import-source-details">
                              {entry.loading ? (
                                <span className="import-loading"><span className="spinner tiny" /> Reading…</span>
                              ) : entry.error ? (
                                <span className="import-source-error">{entry.error}</span>
                              ) : (
                                <>
                                  {bookmarks ? (
                                    <span className="import-badge">
                                      {bookmarks.count.toLocaleString()} bookmark{bookmarks.count === 1 ? "" : "s"}
                                    </span>
                                  ) : (
                                    <span className="import-badge muted">No bookmarks file</span>
                                  )}
                                  {entry.preview ? (
                                    <span className={`import-badge soft format-${entry.preview.format}`}>
                                      {FORMAT_LABELS[entry.preview.format]}
                                    </span>
                                  ) : null}
                                  {entry.preview?.settings && hasSettingsValues(entry.preview) ? (
                                    <span className="import-badge soft">Homepage + startup</span>
                                  ) : null}
                                  {bookmarks && bookmarks.invalid > 0 ? (
                                    <span className="import-note">{bookmarks.invalid} unsupported URL{bookmarks.invalid === 1 ? "" : "s"} skipped</span>
                                  ) : null}
                                  {bookmarks && bookmarks.duplicates > 0 ? (
                                    <span className="import-note">{bookmarks.duplicates} duplicate{bookmarks.duplicates === 1 ? "" : "s"} folded</span>
                                  ) : null}
                                </>
                              )}
                            </div>
                            {entry.preview?.warnings.length ? (
                              <p className="import-warning">{entry.preview.warnings.join(" ")}</p>
                            ) : null}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="source-remove"
                          onClick={() => removeSource(entry)}
                          disabled={importing}
                          aria-label={`Remove ${entry.source.label} from import`}
                        >
                          <X size={14} />
                        </button>
                      </article>
                    );
                  })}

                  {sources.length === 0 && !detecting ? (
                    <div className="import-empty">
                      <span className="import-empty-mark"><Globe size={22} /></span>
                      <div>
                        <strong>No browser profiles found automatically</strong>
                        <p>
                          Choose a bookmarks file, a browser profile folder, or an HTML bookmarks
                          export from any browser.
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="import-panel-foot">
                  <div className="import-selection-count">
                    <strong>{selectedBookmarkCount.toLocaleString()}</strong>
                    <span>bookmarks selected</span>
                  </div>
                  <div className="import-select-actions">
                    <button
                      type="button"
                      className="text-button"
                      disabled={bookmarkSources.length === 0 || importing}
                      onClick={() =>
                        setSelected(new Set(bookmarkSources.map((entry) => entry.source.id)))
                      }
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={selected.size === 0 || importing}
                      onClick={() => setSelected(new Set())}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </section>

              <section className="import-settings-panel">
                <div className="import-panel-heading">
                  <div>
                    <h2>Homepage &amp; startup</h2>
                    <p>One portable settings source at a time.</p>
                  </div>
                  <span className="soft-chip">Safe subset</span>
                </div>

                <label className="field import-settings-field">
                  <span>Use settings from</span>
                  <select
                    className="select"
                    value={settingsSourceId}
                    disabled={importing}
                    onChange={(event) => {
                      settingsTouched.current = true;
                      setSettingsSourceId(event.target.value);
                    }}
                  >
                    <option value="none">Keep Xuvon defaults</option>
                    {settingsOptions.map((entry) => (
                      <option key={entry.source.id} value={entry.source.id}>
                        {entry.source.label}
                      </option>
                    ))}
                  </select>
                </label>

                {chosenSettings?.preview?.settings ? (
                  <div className="import-settings-preview">
                    <div className="settings-preview-row">
                      <span>Homepage</span>
                      <strong title={chosenSettings.preview.settings.homepage}>
                        {chosenSettings.preview.settings.homepage ?? "Keep Xuvon's new tab"}
                      </strong>
                    </div>
                    <div className="settings-preview-row">
                      <span>When Xuvon starts</span>
                      <strong>
                        {chosenSettings.preview.settings.startupBehavior
                          ? STARTUP_LABELS[chosenSettings.preview.settings.startupBehavior]
                          : "Keep current choice"}
                      </strong>
                    </div>
                    {chosenSettings.preview.settings.notes.map((note) => (
                      <p className="import-warning" key={note}>{note}</p>
                    ))}
                  </div>
                ) : (
                  <div className="import-settings-empty">
                    <Info size={15} />
                    <span>
                      No portable homepage or startup settings were found in the selected
                      sources. Xuvon will keep its own defaults.
                    </span>
                  </div>
                )}

                <div className="import-privacy-note">
                  <Lock size={15} />
                  <p>
                    Passwords, cookies, history, extensions, open tabs, and search-engine
                    settings are never imported. Only HTTP(S) bookmarks and the homepage/startup
                    pair above are read.
                  </p>
                </div>
              </section>
            </div>

            <footer className="welcome-panel-foot">
              <div className="welcome-foot-note">
                <Info size={14} />
                <span>
                  Duplicate URLs already in Xuvon stay untouched. Unsupported schemes such as
                  <code> javascript:</code> and onion addresses are rejected.
                </span>
              </div>
              <div className="welcome-foot-actions">
                <button type="button" className="text-button" onClick={() => void skip()}>
                  Skip import
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={actionBusy || previewsLoading}
                  onClick={() => void runImport()}
                >
                  {importing ? <><span className="spinner tiny" /> Importing…</> : "Import and continue"}
                  {!importing ? <ArrowRight size={16} /> : null}
                </button>
              </div>
            </footer>
          </main>
        ) : null}

        {step === "done" ? (
          <main className="onboarding-results" data-testid="onboarding-results">
            <span className="onboarding-result-mark"><CheckCircle size={30} /></span>
            <span className="eyebrow">Ready when you are</span>
            <h1>{totals.imported > 0 || importedSettings ? "Your library is ready." : "You're all set."}</h1>
            <p>
              {totals.imported > 0 || importedSettings
                ? "The data you chose is now stored locally by the Rust core. Xuvon's defaults are unchanged everywhere else."
                : "Nothing was imported. Xuvon starts with a clean library and its own quiet defaults."}
            </p>

            <div className="onboarding-result-stats">
              <div>
                <strong>{totals.imported.toLocaleString()}</strong>
                <span>bookmarks imported</span>
              </div>
              <div>
                <strong>{totals.skipped.toLocaleString()}</strong>
                <span>already present</span>
              </div>
              <div>
                <strong>{totals.folders.toLocaleString()}</strong>
                <span>folders represented</span>
              </div>
              <div>
                <strong>{importedSettings ? "Yes" : "No"}</strong>
                <span>settings applied</span>
              </div>
            </div>

            {totals.invalid > 0 ? (
              <div className="onboarding-result-note">
                <Shield size={15} />
                <span>
                  {totals.invalid.toLocaleString()} bookmark{totals.invalid === 1 ? "" : "s"} used
                  a scheme or host Xuvon does not allow and stayed out of your library.
                </span>
              </div>
            ) : null}

            {errors.length > 0 ? (
              <div className="onboarding-result-errors">
                <strong>Some data could not be imported</strong>
                {errors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            ) : null}

            <div className="onboarding-result-actions">
              <button
                type="button"
                className="primary-button welcome-primary"
                disabled={finishing}
                onClick={() => void finish()}
              >
                {finishing ? "Saving…" : wasCompleted ? "Done" : "Start browsing"}
                {!finishing ? <ArrowRight size={16} /> : null}
              </button>
              <button type="button" className="text-button" onClick={() => setStep("import")}>
                Back to import
              </button>
            </div>
            <p className="onboarding-fineprint">
              Xuvon is made with AI and is completely vibecoded. Browser data stays in this
              device's Xuvon data folder.
            </p>
          </main>
        ) : null}

        <footer className="welcome-footer">
          <span>Made with love by Seb &lt;3</span>
          <span className="footer-dot" />
          <span>Rust owns the library. Chromium only renders.</span>
        </footer>
      </div>
    </div>
  );
}
