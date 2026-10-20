import { useEffect, useState, type FormEvent } from "react";
import type { Bookmark, BookmarkFolder } from "../../shared/types";
import { useBrowser } from "../BrowserContext";
import {
  Bookmark as BookmarkIcon,
  Folder,
  Pencil,
  Plus,
  Search,
  Star,
  Trash,
  X
} from "../components/Icons";
import { EmptyState, Modal, PageShell } from "../components/Ui";
import {
  colorClassFor,
  displayTitle,
  formatDate,
  hostnameOf,
  isHttpUrl,
  prettyUrl,
  titleFromUrl
} from "../lib/format";

interface BookmarkForm {
  title: string;
  url: string;
  folder: string;
}

export function BookmarksPage() {
  const { activeTab, createTab, navigate, notify, perform, refreshBookmark } = useBrowser();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [folders, setFolders] = useState<BookmarkFolder[]>([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [editing, setEditing] = useState<Bookmark | "new" | null>(null);
  const [form, setForm] = useState<BookmarkForm>({ title: "", url: "", folder: "" });
  const [saving, setSaving] = useState(false);
  const [pageBookmark, setPageBookmark] = useState<Bookmark | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    Promise.all([
      window.xuvon.bookmarks.list(debouncedQuery, folder ?? undefined),
      window.xuvon.bookmarks.folders()
    ])
      .then(([items, folderList]) => {
        if (canceled) return;
        setBookmarks(items);
        setFolders(folderList);
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
  }, [debouncedQuery, folder, reloadToken, notify]);

  const currentPage = activeTab && !activeTab.internalUrl && isHttpUrl(activeTab.url) ? activeTab : null;

  useEffect(() => {
    let canceled = false;
    const url = currentPage?.url;
    if (!url) {
      setPageBookmark(null);
      return;
    }
    window.xuvon.bookmarks
      .find(url)
      .then((found) => {
        if (!canceled) setPageBookmark(found);
      })
      .catch(() => {
        if (!canceled) setPageBookmark(null);
      });
    return () => {
      canceled = true;
    };
  }, [currentPage?.url, reloadToken]);

  const openBookmark = (bookmark: Bookmark) => {
    if (activeTab) void navigate(activeTab.id, bookmark.url);
    else void createTab({ url: bookmark.url });
  };

  const openAdd = () => {
    setForm({
      title: currentPage?.title === "New Tab" ? "" : currentPage?.title ?? "",
      url: currentPage?.url ?? "",
      folder: folder ?? ""
    });
    setEditing("new");
  };

  const openEdit = (bookmark: Bookmark) => {
    setForm({ title: bookmark.title, url: bookmark.url, folder: bookmark.folder });
    setEditing(bookmark);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    let url = form.url.trim();
    if (!url) return;
    if (!/^[a-z]+:\/\//i.test(url)) url = `https://${url}`;
    if (!/^https?:\/\//i.test(url)) {
      notify({ tone: "warning", message: "Bookmarks can only point to HTTP or HTTPS pages." });
      return;
    }
    const title = form.title.trim() || titleFromUrl(url);
    const folderName = form.folder.trim();
    setSaving(true);
    try {
      if (editing === "new") {
        const created = await perform(() =>
          window.xuvon.bookmarks.create({ url, title, folder: folderName || "Unsorted" })
        );
        if (!created) return;
        notify({ tone: "success", message: "Bookmark added." });
      } else if (editing) {
        const updated = await perform(() =>
          window.xuvon.bookmarks.update(editing.id, { url, title, folder: folderName || "Unsorted" })
        );
        if (!updated) return;
        notify({ tone: "success", message: "Bookmark updated." });
      }
      setEditing(null);
      setReloadToken((value) => value + 1);
      refreshBookmark();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (bookmark: Bookmark) => {
    const removed = await perform(() => window.xuvon.bookmarks.remove(bookmark.id));
    if (removed !== null) {
      notify({ tone: "info", message: "Bookmark removed." });
      setReloadToken((value) => value + 1);
      refreshBookmark();
    }
  };

  const bookmarkCurrent = async () => {
    if (!currentPage) return;
    if (pageBookmark) {
      openEdit(pageBookmark);
      return;
    }
    const created = await perform(() =>
      window.xuvon.bookmarks.create({ url: currentPage.url, title: currentPage.title })
    );
    if (created) {
      notify({ tone: "success", message: "Current page bookmarked." });
      setReloadToken((value) => value + 1);
      refreshBookmark();
    }
  };

  return (
    <PageShell
      eyebrow="Collected paths"
      title="Bookmarks"
      intro="Keep a hand-picked shelf of pages. Bookmarks live in your local Rust database — no account, no sync, no sharing."
      actions={
        <>
          <button type="button" className="secondary-button" onClick={() => void bookmarkCurrent()} disabled={!currentPage}>
            <Star size={15} />
            {pageBookmark ? "Edit current" : "Bookmark current"}
          </button>
          <button type="button" className="primary-button" onClick={openAdd}>
            <Plus size={15} />
            Add bookmark
          </button>
        </>
      }
    >
      <div className="library-toolbar">
        <label className="search-field">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search bookmarks"
            aria-label="Search bookmarks"
            spellCheck={false}
          />
          {query ? (
            <button type="button" className="icon-button compact" onClick={() => setQuery("")} aria-label="Clear search">
              <X size={14} />
            </button>
          ) : null}
        </label>
        <span className="result-count">
          {loading ? "Reading shelf…" : `${bookmarks.length} ${bookmarks.length === 1 ? "bookmark" : "bookmarks"}`}
        </span>
      </div>

      <div className="folder-filter" role="group" aria-label="Bookmark folders">
        <button
          type="button"
          className={folder === null ? "is-active" : ""}
          onClick={() => setFolder(null)}
        >
          All
          <span>{folders.reduce((count, item) => count + item.count, 0)}</span>
        </button>
        {folders.map((item) => (
          <button
            key={item.name}
            type="button"
            className={folder === item.name ? "is-active" : ""}
            onClick={() => setFolder(item.name)}
          >
            <Folder size={13} />
            {item.name}
            <span>{item.count}</span>
          </button>
        ))}
      </div>

      {!loading && bookmarks.length === 0 ? (
        <EmptyState
          icon={<BookmarkIcon size={26} />}
          title={debouncedQuery || folder ? "Nothing on this shelf" : "Your shelf is waiting"}
          description={
            debouncedQuery || folder
              ? "Try another search, choose a different folder, or add a new bookmark."
              : "Bookmark a page with the star in the address bar, or add one by hand."
          }
          action={
            <button type="button" className="primary-button" onClick={openAdd}>
              <Plus size={15} />
              Add your first bookmark
            </button>
          }
        />
      ) : (
        <div className="bookmark-grid">
          {bookmarks.map((bookmark) => (
            <article key={bookmark.id} className="bookmark-card">
              <button type="button" className="bookmark-main" onClick={() => openBookmark(bookmark)}>
                <span className={`bookmark-avatar ${colorClassFor(bookmark.url)}`}>
                  {hostnameOf(bookmark.url).charAt(0).toUpperCase()}
                </span>
                <span className="bookmark-copy">
                  <strong>{displayTitle(bookmark.title, bookmark.url)}</strong>
                  <span>{prettyUrl(bookmark.url)}</span>
                </span>
              </button>
              <div className="bookmark-footer">
                <span className="folder-tag">
                  <Folder size={12} />
                  {bookmark.folder}
                </span>
                <span className="bookmark-date">{formatDate(bookmark.createdAt)}</span>
                <div className="bookmark-actions">
                  <button
                    type="button"
                    className="icon-button compact"
                    onClick={() => openEdit(bookmark)}
                    title="Edit bookmark"
                    aria-label={`Edit ${bookmark.title}`}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button compact danger-hover"
                    onClick={() => void remove(bookmark)}
                    title="Remove bookmark"
                    aria-label={`Remove ${bookmark.title}`}
                  >
                    <Trash size={14} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {loading ? (
        <div className="loading-line" role="status">
          <span className="spinner" /> Reading the bookmark shelf…
        </div>
      ) : null}

      {editing ? (
        <Modal
          title={editing === "new" ? "Add a bookmark" : "Edit bookmark"}
          description="Stored locally by the Xuvon core. Folders are created as you name them."
          onClose={() => setEditing(null)}
          footer={
            <>
              <button type="button" className="secondary-button" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" form="bookmark-form" className="primary-button" disabled={saving || !form.url.trim()}>
                {saving ? "Saving…" : editing === "new" ? "Add bookmark" : "Save changes"}
              </button>
            </>
          }
        >
          <form id="bookmark-form" className="form-stack" onSubmit={(event) => void save(event)}>
            <label className="field">
              <span>Address</span>
              <input
                value={form.url}
                onChange={(event) => setForm({ ...form, url: event.target.value })}
                placeholder="https://example.com"
                spellCheck={false}
                required
              />
            </label>
            <label className="field">
              <span>Title</span>
              <input
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder="A name you'll recognize"
                maxLength={512}
              />
            </label>
            <label className="field">
              <span>Folder</span>
              <input
                value={form.folder}
                onChange={(event) => setForm({ ...form, folder: event.target.value })}
                placeholder="Unsorted"
                maxLength={120}
                list="bookmark-folders"
              />
              <datalist id="bookmark-folders">
                {folders.map((item) => (
                  <option key={item.name} value={item.name} />
                ))}
              </datalist>
            </label>
          </form>
        </Modal>
      ) : null}
    </PageShell>
  );
}
