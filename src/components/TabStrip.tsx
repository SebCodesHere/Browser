import { useRef, useState, type DragEvent, type WheelEvent } from "react";
import { useBrowser } from "../BrowserContext";
import { displayTitle, safeFavicon } from "../lib/format";
import { Incognito, Onion, Plus, X } from "./Icons";

interface TabStripProps {
  onNewTab: () => void;
  onNewPrivateTab: () => void;
}

export function TabStrip({ onNewTab, onNewPrivateTab }: TabStripProps) {
  const { tabs, activeTab, activateTab, closeTab } = useBrowser();
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const onDragStart = (event: DragEvent, tabId: string) => {
    setDragging(tabId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/xuvon-tab", tabId);
  };

  const onDrop = (event: DragEvent, targetId: string) => {
    event.preventDefault();
    const source = event.dataTransfer.getData("text/xuvon-tab") || dragging;
    if (!source || source === targetId) {
      setDragging(null);
      setDragOver(null);
      return;
    }
    const targetIndex = tabs.tabs.findIndex((tab) => tab.id === targetId);
    if (targetIndex >= 0) void window.xuvon.tabs.move(source, targetIndex);
    setDragging(null);
    setDragOver(null);
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!stripRef.current) return;
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      stripRef.current.scrollLeft += event.deltaY;
    }
  };

  return (
    <div className="tab-strip-wrap">
      <div className="tab-strip" ref={stripRef} onWheel={onWheel} role="tablist" aria-label="Open tabs">
        {tabs.tabs.map((tab) => {
          const active = tab.id === activeTab?.id;
          const favicon = safeFavicon(tab.favicon);
          return (
            <div
              key={tab.id}
              className={[
                "browser-tab",
                active ? "is-active" : "",
                `mode-${tab.mode}`,
                dragging === tab.id ? "is-dragging" : "",
                dragOver === tab.id ? "is-drag-over" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              draggable
              title={tab.title}
              onDragStart={(event) => onDragStart(event, tab.id)}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(tab.id);
              }}
              onDragLeave={() => setDragOver((current) => (current === tab.id ? null : current))}
              onDrop={(event) => onDrop(event, tab.id)}
              onDragEnd={() => {
                setDragging(null);
                setDragOver(null);
              }}
              onClick={() => void activateTab(tab.id)}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  void closeTab(tab.id);
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                void window.xuvon.tabs.contextMenu(tab.id).catch(() => undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void activateTab(tab.id);
                }
              }}
            >
              <span className="tab-leading" aria-hidden="true">
                {tab.loading ? (
                  <span className="spinner tab-spinner" />
                ) : tab.mode === "private" ? (
                  <Incognito size={13} />
                ) : tab.mode === "tor" ? (
                  <Onion size={13} />
                ) : favicon ? (
                  <img src={favicon} alt="" />
                ) : (
                  <span className={`tab-letter ${tab.error ? "is-error" : ""}`}>
                    {(tab.title || "?").trim().charAt(0).toUpperCase() || "•"}
                  </span>
                )}
              </span>
              <span className="tab-title">{displayTitle(tab.title, tab.url)}</span>
              {tab.audible ? <span className="tab-audio" title="Playing audio" /> : null}
              <button
                type="button"
                className="tab-close"
                aria-label={`Close ${displayTitle(tab.title, tab.url)}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void closeTab(tab.id);
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="tab-actions">
        <button type="button" className="icon-button new-tab-button" onClick={onNewTab} title="New tab (⌘T)">
          <Plus size={17} />
        </button>
        <button
          type="button"
          className="icon-button new-private-button"
          onClick={onNewPrivateTab}
          title="New private tab"
          aria-label="New private tab"
        >
          <Incognito size={16} />
        </button>
      </div>
    </div>
  );
}
