import { useEffect, useRef, useState } from "react";
import { useBrowser } from "../BrowserContext";
import { ArrowLeft, ArrowRight, Search, X } from "./Icons";

interface FindBarProps {
  tabId: string;
  focusSignal: number;
  onClose: () => void;
}

export function FindBar({ tabId, focusSignal, onClose }: FindBarProps) {
  const { find } = useBrowser();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSignal]);

  useEffect(() => {
    setQuery("");
  }, [tabId]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void window.xuvon.tabs.find(tabId, query).catch(() => undefined);
    }, 90);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, tabId]);

  const step = (forward: boolean, findNext: boolean) => {
    if (!query) return;
    void window.xuvon.tabs.find(tabId, query, { forward, findNext }).catch(() => undefined);
  };

  const close = () => {
    void window.xuvon.tabs.stopFind(tabId).catch(() => undefined);
    onClose();
  };

  const state = find.tabId === tabId ? find : null;
  const matchLabel =
    state && state.matches > 0
      ? `${Math.max(1, state.activeMatch)} / ${state.matches}`
      : query
        ? "No matches"
        : "";

  return (
    <div className="find-bar" role="search">
      <span className="find-icon">
        <Search size={15} />
      </span>
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          } else if (event.key === "Enter") {
            event.preventDefault();
            step(!event.shiftKey, true);
          }
        }}
        placeholder="Find in page"
        aria-label="Find in page"
        spellCheck={false}
      />
      <span className={`find-count ${state && state.matches === 0 && query ? "is-empty" : ""}`}>
        {matchLabel}
      </span>
      <div className="find-actions">
        <button
          type="button"
          className="icon-button compact"
          onClick={() => step(false, true)}
          title="Previous match (Shift+Enter)"
          aria-label="Previous match"
        >
          <ArrowLeft size={15} />
        </button>
        <button
          type="button"
          className="icon-button compact"
          onClick={() => step(true, true)}
          title="Next match (Enter)"
          aria-label="Next match"
        >
          <ArrowRight size={15} />
        </button>
        <button
          type="button"
          className="icon-button compact"
          onClick={close}
          title="Close find bar"
          aria-label="Close find bar"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
