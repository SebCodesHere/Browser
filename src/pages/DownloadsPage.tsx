import { useMemo } from "react";
import type { DownloadItem } from "../../shared/types";
import { useBrowser } from "../BrowserContext";
import {
  AlertTriangle,
  Download,
  External,
  File,
  Folder,
  Pause,
  Play,
  RotateCcw,
  Trash,
  X
} from "../components/Icons";
import { EmptyState, PageShell } from "../components/Ui";
import { formatBytes, formatDateTime, prettyUrl } from "../lib/format";

function stateLabel(item: DownloadItem): string {
  switch (item.state) {
    case "progressing":
      return item.active ? "Downloading" : "In progress";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "interrupted":
      return "Interrupted";
    default:
      return item.state;
  }
}

export function DownloadsPage() {
  const { downloads, openInternal, perform, notify } = useBrowser();

  const active = downloads.filter((item) => item.state === "progressing" || item.state === "paused");
  const finished = downloads.filter((item) => item.state !== "progressing" && item.state !== "paused");
  const activeCount = active.length;

  const totalLabel = useMemo(() => {
    if (downloads.length === 0) return "No files yet";
    return `${downloads.length} ${downloads.length === 1 ? "file" : "files"} · ${activeCount} active`;
  }, [downloads.length, activeCount]);

  const clearFinished = async () => {
    const result = await perform(() => window.xuvon.downloads.clearFinished());
    if (result !== null) notify({ tone: "success", message: "Finished download records cleared." });
  };

  const renderItem = (item: DownloadItem) => {
    const percent =
      item.totalBytes > 0 ? Math.min(100, Math.round((item.receivedBytes / item.totalBytes) * 100)) : 0;
    const inProgress = item.state === "progressing";
    const canResume = item.state === "interrupted" && item.canResume;
    const finishedState = item.state === "completed";
    return (
      <article key={item.id} className={`download-card ${item.danger ? "is-danger" : ""}`}>
        <span className="download-file-icon">
          {item.danger ? <AlertTriangle size={20} /> : <File size={20} />}
        </span>
        <div className="download-main">
          <div className="download-heading">
            <div className="download-name">
              <strong title={item.filename}>{item.filename}</strong>
              <span className={`download-state state-${item.state}`}>{stateLabel(item)}</span>
              {item.isPrivate ? <span className="download-state session-only">Session only</span> : null}
              {item.danger ? <span className="download-state danger">Runs code</span> : null}
            </div>
            <span className="download-size">
              {item.totalBytes > 0
                ? `${formatBytes(item.receivedBytes)} of ${formatBytes(item.totalBytes)}`
                : formatBytes(item.receivedBytes)}
            </span>
          </div>
          <div className="download-url" title={item.url}>{prettyUrl(item.url)}</div>
          {inProgress || item.state === "paused" || item.state === "interrupted" ? (
            <div className="download-progress">
              <div className="progress-track">
                <span style={{ width: `${percent}%` }} />
              </div>
              <span>{percent}%</span>
            </div>
          ) : null}
          {item.error ? <p className="download-error">{item.error}</p> : null}
          <div className="download-meta">
            <span>Started {formatDateTime(item.startedAt)}</span>
            <span className="meta-dot" />
            <span title={item.path}>{item.path}</span>
          </div>
        </div>
        <div className="download-actions">
          {finishedState ? (
            <button type="button" className="secondary-button compact-button" onClick={() => void perform(() => window.xuvon.downloads.open(item.id))}>
              <External size={14} />
              Open
            </button>
          ) : null}
          {finishedState || inProgress || item.state === "paused" ? (
            <button type="button" className="icon-button compact" title="Show in folder" aria-label="Show in folder" onClick={() => void perform(() => Promise.resolve(window.xuvon.downloads.showInFolder(item.id)))}>
              <Folder size={15} />
            </button>
          ) : null}
          {inProgress ? (
            <button type="button" className="icon-button compact" title="Pause" aria-label="Pause download" onClick={() => void perform(() => Promise.resolve(window.xuvon.downloads.pause(item.id)))}>
              <Pause size={15} />
            </button>
          ) : null}
          {item.state === "paused" ? (
            <button type="button" className="icon-button compact" title="Resume" aria-label="Resume download" onClick={() => void perform(() => Promise.resolve(window.xuvon.downloads.resume(item.id)))}>
              <Play size={15} />
            </button>
          ) : null}
          {canResume ? (
            <button type="button" className="icon-button compact" title="Resume" aria-label="Resume download" onClick={() => void perform(() => Promise.resolve(window.xuvon.downloads.resume(item.id)))}>
              <RotateCcw size={15} />
            </button>
          ) : null}
          {inProgress || item.state === "paused" || item.state === "interrupted" ? (
            <button type="button" className="icon-button compact danger-hover" title="Cancel" aria-label="Cancel download" onClick={() => void perform(() => Promise.resolve(window.xuvon.downloads.cancel(item.id)))}>
              <X size={15} />
            </button>
          ) : (
            <button type="button" className="icon-button compact danger-hover" title="Remove from list" aria-label="Remove download" onClick={() => void perform(() => window.xuvon.downloads.remove(item.id))}>
              <Trash size={15} />
            </button>
          )}
        </div>
      </article>
    );
  };

  return (
    <PageShell
      eyebrow="Files in motion"
      title="Downloads"
      intro="Chromium handles the transfer; Xuvon records the details locally and warns before opening files that can run code."
      actions={
        <button
          type="button"
          className="secondary-button"
          onClick={() => void clearFinished()}
          disabled={finished.length === 0}
        >
          <Trash size={15} />
          Clear finished
        </button>
      }
    >
      <div className="library-toolbar downloads-toolbar">
        <span className="result-count">{totalLabel}</span>
        <button type="button" className="text-button" onClick={() => void openInternal("xuvon://settings")}>
          Change download folder
        </button>
      </div>

      {downloads.length === 0 ? (
        <EmptyState
          icon={<Download size={26} />}
          title="Nothing downloading"
          description="Files you download in Chromium will appear here with progress, sources, and safe-open warnings."
        />
      ) : (
        <>
          {active.length > 0 ? (
            <section className="download-group">
              <div className="group-heading">
                <h2>In progress</h2>
                <span>{active.length}</span>
              </div>
              <div className="download-list">{active.map(renderItem)}</div>
            </section>
          ) : null}
          {finished.length > 0 ? (
            <section className="download-group">
              <div className="group-heading">
                <h2>Earlier</h2>
                <span>{finished.length}</span>
              </div>
              <div className="download-list">{finished.map(renderItem)}</div>
            </section>
          ) : null}
        </>
      )}
    </PageShell>
  );
}
