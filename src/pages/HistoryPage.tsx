import { useEffect, useMemo, useState } from "react";
import type { HistoryEntry } from "../../shared/types";
import { useBrowser } from "../BrowserContext";
import { Clock, Search, Trash, X } from "../components/Icons";
import { EmptyState, PageShell } from "../components/Ui";
import {
  colorClassFor,
  dayGroup,
  displayTitle,
  formatTime,
  hostnameOf,
  prettyUrl
} from "../lib/format";

export function HistoryPage() {
  const { activeTab, createTab, navigate, notify, perform } = useBrowser();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 220);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    window.xuvon.history
      .list(debouncedQuery, 300, 0)
      .then((page) => {
        if (canceled) return;
        setEntries(page.entries);
        setTotal(page.total);
      })
      .catch((error: unknown) => {
        if (canceled) return;
        notify({
          tone: "error",
          message: error instanceof Error ? error.message : String(error)
        });
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [debouncedQuery, reloadToken, notify]);

  const grouped = useMemo(() => {
    const groups = new Map<string, HistoryEntry[]>();
    for (const entry of entries) {
      const key = dayGroup(entry.lastVisitedAt);
      const list = groups.get(key);
      if (list) list.push(entry);
      else groups.set(key, [entry]);
    }
    return [...groups.entries()];
  }, [entries]);

  const openEntry = (url: string) => {
    if (activeTab) void navigate(activeTab.id, url);
    else void createTab({ url });
  };

  const removeEntry = async (entry: HistoryEntry) => {
    const removed = await perform(() => window.xuvon.history.remove(entry.id));
    if (removed !== null) {
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      setTotal((current) => Math.max(0, current - 1));
    }
  };

  const clearAll = async () => {
    const cleared = await perform(() => window.xuvon.history.clear());
    if (cleared) {
      setEntries([]);
      setTotal(0);
    }
  };

  return (
    <PageShell
      eyebrow="Your trail"
      title="History"
      intro="A searchable, local record of pages you've visited in normal tabs. Private and Tor sessions never write here."
      actions={
        <button type="button" className="secondary-button danger" onClick={() => void clearAll()} disabled={total === 0}>
          <Trash size={15} />
          Clear history
        </button>
      }
    >
      <div className="library-toolbar">
        <label className="search-field">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles and addresses"
            aria-label="Search history"
            spellCheck={false}
          />
          {query ? (
            <button type="button" className="icon-button compact" onClick={() => setQuery("")} aria-label="Clear search">
              <X size={14} />
            </button>
          ) : null}
        </label>
        <span className="result-count">
          {loading ? "Searching…" : `${total.toLocaleString()} ${total === 1 ? "visit" : "visits"}`}
        </span>
      </div>

      {!loading && entries.length === 0 ? (
        <EmptyState
          icon={<Clock size={26} />}
          title={debouncedQuery ? "No pages match that search" : "Your history is a blank page"}
          description={
            debouncedQuery
              ? "Try a different word, hostname, or part of the address."
              : "Pages you visit in normal tabs will gather here. Private and Tor browsing stays out of it."
          }
        />
      ) : (
        <div className="history-groups">
          {grouped.map(([group, items]) => (
            <section key={group} className="history-group">
              <div className="group-heading">
                <h2>{group}</h2>
                <span>{items.length}</span>
              </div>
              <div className="list-panel">
                {items.map((entry) => (
                  <div key={entry.id} className="library-row history-row">
                    <button type="button" className="row-main" onClick={() => openEntry(entry.url)}>
                      <span className={`row-avatar ${colorClassFor(entry.url)}`}>
                        {hostnameOf(entry.url).charAt(0).toUpperCase()}
                      </span>
                      <span className="row-copy">
                        <strong>{displayTitle(entry.title, entry.url)}</strong>
                        <span>{prettyUrl(entry.url)}</span>
                      </span>
                      <span className="row-meta">
                        <span>{formatTime(entry.lastVisitedAt)}</span>
                        {entry.visitCount > 1 ? <span className="visit-chip">{entry.visitCount}×</span> : null}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-button compact row-remove"
                      onClick={() => void removeEntry(entry)}
                      aria-label={`Remove ${entry.title || entry.url} from history`}
                      title="Remove from history"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {loading ? (
        <div className="loading-line" role="status">
          <span className="spinner" /> Reading the local history database…
        </div>
      ) : null}
    </PageShell>
  );
}
