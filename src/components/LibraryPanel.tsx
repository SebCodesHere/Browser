import { useEffect, useMemo, useState } from "react";
import type { Bookmark, DownloadItem, HistoryEntry, LibraryPane } from "../../shared/types";
import { useBrowser } from "../BrowserContext";
import {
  Bookmark as BookmarkIcon,
  Clock,
  Download,
  Folder,
  Grid,
  Search,
  Star,
  Trash,
  X
} from "../components/Icons";
import {
  colorClassFor,
  displayTitle,
  formatBytes,
  hostnameOf,
  prettyUrl,
  relativeTime
} from "../lib/format";

interface LibraryPanelProps {
  pane: LibraryPane;
  onPaneChange: (pane: LibraryPane) => void;
  onClose: () => void;
}

export function LibraryPanel({ pane, onPaneChange, onClose }: LibraryPanelProps) {
  const {
    activeTab,
    downloads,
    navigate,
    createTab,
    notify,
    perform,
    refreshBookmark
  } = useBrowser();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 180);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setQuery("");
    setDebounced("");
  }, [pane]);

  useEffect(() => {
    let canceled = false;
    if (pane === "downloads") return;
    setLoading(true);
    const request =
      pane === "bookmarks"
        ? window.xuvon.bookmarks.list(debounced, undefined)
        : window.xuvon.history.list(debounced, 80, 0).then((page) => page.entries);
    request
      .then((items) => {
        if (canceled) return;
        if (pane === "bookmarks") setBookmarks(items as Bookmark[]);
        else setHistory(items as HistoryEntry[]);
      })
      .catch((error: unknown) => {
        if (!canceled) {
          notify({
            tone: "error",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [pane, debounced, reload, notify]);

  const currentPage = activeTab && !activeTab.internalUrl && /^https?:\/\//i.test(activeTab.url) ? activeTab : null;
  const activeDownloads = downloads.filter(
    (item) => item.state === "progressing" || item.state === "paused" || item.state === "interrupted"
  );
  const recentDownloads = useMemo(() => downloads.slice(0, 30), [downloads]);

  const openUrl = (url: string) => {
    if (activeTab) void navigate(activeTab.id, url);
    else void createTab({ url });
  };

  const addCurrent = async () => {
    if (!currentPage) return;
    const existing = await window.xuvon.bookmarks.find(currentPage.url).catch(() => null);
    if (existing) {
      notify({ tone: "info", message: "This page is already bookmarked." });
      return;
    }
    const created = await perform(() =>
      window.xuvon.bookmarks.create({ url: currentPage.url, title: currentPage.title })
    );
    if (created) {
      notify({ tone: "success", message: "Bookmark added." });
      refreshBookmark();
      setReload((value) => value + 1);
    }
  };

  const removeBookmark = async (bookmark: Bookmark) => {
    const removed = await perform(() => window.xuvon.bookmarks.remove(bookmark.id));
    if (removed !== null) {
      setBookmarks((current) => current.filter((item) => item.id !== bookmark.id));
      notify({ tone: "info", message: "Bookmark removed." });
      refreshBookmark();
    }
  };

  const removeHistory = async (entry: HistoryEntry) => {
    const removed = await perform(() => window.xuvon.history.remove(entry.id));
    if (removed !== null) {
      setHistory((current) => current.filter((item) => item.id !== entry.id));
    }
  };

  const renderDownload = (item: DownloadItem) => {
    const percent = item.totalBytes > 0 ? Math.min(100, Math.round((item.receivedBytes / item.totalBytes) * 100)) : 0;
    return (
      <div key={item.id} className="side-download">
        <span className="side-download-icon"><Download size={16} /></span>
        <div>
          <strong title={item.filename}>{item.filename}</strong>
          <span>
            {item.state === "progressing"
              ? `${formatBytes(item.receivedBytes)}${item.totalBytes ? ` / ${formatBytes(item.totalBytes)}` : ""}`
              : item.state === "completed"
                ? "Completed"
                : item.state}
          </span>
          {item.state === "progressing" || item.state === "paused" ? (
            <span className="mini-progress">
              <span style={{ width: `${percent}%` }} />
            </span>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <aside className="library-panel" aria-label="Library">
      <header className="library-header">
        <div>
          <span className="eyebrow">Local library</span>
          <h2><Grid size={17} /> Your things</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close library" title="Close library">
          <X size={17} />
        </button>
      </header>

      <div className="library-tabs" role="tablist" aria-label="Library sections">
        <button type="button" role="tab" aria-selected={pane === "bookmarks"} className={pane === "bookmarks" ? "is-active" : ""} onClick={() => onPaneChange("bookmarks")}>
          <BookmarkIcon size={15} />
          Bookmarks
        </button>
        <button type="button" role="tab" aria-selected={pane === "history"} className={pane === "history" ? "is-active" : ""} onClick={() => onPaneChange("history")}>
          <Clock size={15} />
          History
        </button>
        <button type="button" role="tab" aria-selected={pane === "downloads"} className={pane === "downloads" ? "is-active" : ""} onClick={() => onPaneChange("downloads")}>
          <Download size={15} />
          Downloads
          {activeDownloads.length > 0 ? <span className="tab-count">{activeDownloads.length}</span> : null}
        </button>
      </div>

      {pane !== "downloads" ? (
        <label className="search-field compact-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={pane === "bookmarks" ? "Search bookmarks" : "Search history"}
            aria-label={pane === "bookmarks" ? "Search bookmarks" : "Search history"}
            spellCheck={false}
            autoFocus
          />
          {query ? (
            <button type="button" className="icon-button compact" onClick={() => setQuery("")} aria-label="Clear search">
              <X size={13} />
            </button>
          ) : null}
        </label>
      ) : null}

      <div className="library-body">
        {pane === "bookmarks" ? (
          <>
            <div className="library-subhead">
              <span>{loading ? "Reading…" : `${bookmarks.length} saved`}</span>
              <button type="button" className="text-button" disabled={!currentPage} onClick={() => void addCurrent()}>
                <Star size={13} />
                Save current
              </button>
            </div>
            {bookmarks.length === 0 && !loading ? (
              <div className="library-empty">
                <BookmarkIcon size={24} />
                <strong>{debounced ? "No bookmark matches" : "No bookmarks yet"}</strong>
                <p>Use the star in the address bar to keep a page close.</p>
              </div>
            ) : (
              <div className="side-list">
                {bookmarks.map((bookmark) => (
                  <div key={bookmark.id} className="side-row">
                    <button type="button" className="side-row-main" onClick={() => openUrl(bookmark.url)}>
                      <span className={`row-avatar small ${colorClassFor(bookmark.url)}`}>
                        {hostnameOf(bookmark.url).charAt(0).toUpperCase()}
                      </span>
                      <span className="side-row-copy">
                        <strong>{displayTitle(bookmark.title, bookmark.url)}</strong>
                        <span>{prettyUrl(bookmark.url)}</span>
                        {bookmark.folder ? (
                          <span className="side-folder"><Folder size={10} /> {bookmark.folder}</span>
                        ) : null}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-button compact side-remove"
                      title="Remove bookmark"
                      aria-label={`Remove ${bookmark.title}`}
                      onClick={() => void removeBookmark(bookmark)}
                    >
                      <Trash size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}

        {pane === "history" ? (
          <>
            <div className="library-subhead">
              <span>{loading ? "Reading…" : `${history.length} recent`}</span>
              <button type="button" className="text-button" onClick={() => void window.xuvon.tabs.create({ internalUrl: "xuvon://history", activate: true })}>
                Open full history
              </button>
            </div>
            {history.length === 0 && !loading ? (
              <div className="library-empty">
                <Clock size={24} />
                <strong>{debounced ? "No page matches" : "History is empty"}</strong>
                <p>Normal-profile pages will appear here. Private tabs never do.</p>
              </div>
            ) : (
              <div className="side-list">
                {history.map((entry) => (
                  <div key={entry.id} className="side-row">
                    <button type="button" className="side-row-main" onClick={() => openUrl(entry.url)}>
                      <span className={`row-avatar small ${colorClassFor(entry.url)}`}>
                        {hostnameOf(entry.url).charAt(0).toUpperCase()}
                      </span>
                      <span className="side-row-copy">
                        <strong>{displayTitle(entry.title, entry.url)}</strong>
                        <span>{prettyUrl(entry.url)}</span>
                      </span>
                      <span className="side-time">{relativeTime(entry.lastVisitedAt)}</span>
                    </button>
                    <button
                      type="button"
                      className="icon-button compact side-remove"
                      title="Remove from history"
                      aria-label={`Remove ${entry.title}`}
                      onClick={() => void removeHistory(entry)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}

        {pane === "downloads" ? (
          <>
            <div className="library-subhead">
              <span>{activeDownloads.length > 0 ? `${activeDownloads.length} active` : `${recentDownloads.length} files`}</span>
              <button type="button" className="text-button" onClick={() => void window.xuvon.tabs.create({ internalUrl: "xuvon://downloads", activate: true })}>
                Open downloads
              </button>
            </div>
            {recentDownloads.length === 0 ? (
              <div className="library-empty">
                <Download size={24} />
                <strong>No downloads yet</strong>
                <p>Chromium will place file progress and safe-open warnings here.</p>
              </div>
            ) : (
              <div className="side-download-list">{recentDownloads.map(renderDownload)}</div>
            )}
          </>
        ) : null}
      </div>

      <footer className="library-footer">
        <span className="footer-brand-mark">X</span>
        <span>Saved on this device only</span>
      </footer>
    </aside>
  );
}
