import { useMemo, type RefObject } from "react";
import { isAllowlisted, normalizeAdblockHost } from "../../shared/adblock-utils";
import { useBrowser } from "../BrowserContext";
import { ArrowLeft, ArrowRight, Globe, Grid, Download, Incognito, Lock, Onion, Reload, Shield, ShieldAlert, ShieldCheck, Sparkles, Star, StarFilled, X } from "./Icons";

interface ToolbarProps {
  addressRef: RefObject<HTMLInputElement | null>;
  addressValue: string;
  addressFocused: boolean;
  onAddressChange: (value: string) => void;
  onAddressFocus: () => void;
  onAddressBlur: () => void;
  onAddressSubmit: () => void;
  onOpenLibrary: () => void;
  onOpenDownloads: () => void;
  shieldOpen: boolean;
  onToggleShield: () => void;
}

export function Toolbar({
  addressRef,
  addressValue,
  addressFocused,
  onAddressChange,
  onAddressFocus,
  onAddressBlur,
  onAddressSubmit,
  onOpenLibrary,
  onOpenDownloads,
  shieldOpen,
  onToggleShield
}: ToolbarProps) {
  const {
    activeTab,
    settings,
    providers,
    downloads,
    activeBookmark,
    bookmarkBusy,
    toggleBookmark
  } = useBrowser();

  const siteHost = useMemo(() => {
    if (!activeTab || activeTab.internalUrl) return null;
    try {
      const url = new URL(activeTab.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return normalizeAdblockHost(url.hostname);
    } catch {
      return null;
    }
  }, [activeTab?.url, activeTab?.internalUrl]);

  const blocking = settings?.adblockEnabled ?? true;
  const siteAllowed = siteHost
    ? isAllowlisted(siteHost, settings?.adblockAllowlist ?? [])
    : false;
  const blockedCount = activeTab?.blockedCount ?? 0;

  const id = activeTab?.id;
  const activeDownloadCount = downloads.filter((item) => item.active && item.state === "progressing").length;
  const provider = providers.find((entry) => entry.id === settings?.searchProvider);
  const placeholder = `Search ${provider ? `with ${provider.name}` : "the web"} or enter an address`;

  const internal = Boolean(activeTab?.internalUrl);
  const secure = activeTab?.secure;
  const mode = activeTab?.mode ?? "normal";
  const disabledBookmark =
    !activeTab || internal || mode === "private" || !/^https?:\/\//i.test(activeTab.url) || bookmarkBusy;

  const siteLabel = internal
    ? "Xuvon internal page"
    : mode === "tor"
      ? "Routing through Tor"
      : secure === true
        ? "Connection is encrypted with HTTPS"
        : secure === false
          ? "This connection is not encrypted"
          : "Web page";

  return (
    <div className="toolbar">
      <div className="nav-cluster">
        <button
          type="button"
          className="icon-button nav-button"
          onClick={() => id && void window.xuvon.tabs.back(id)}
          disabled={!activeTab?.canGoBack}
          title="Back"
          aria-label="Back"
        >
          <ArrowLeft size={19} />
        </button>
        <button
          type="button"
          className="icon-button nav-button"
          onClick={() => id && void window.xuvon.tabs.forward(id)}
          disabled={!activeTab?.canGoForward}
          title="Forward"
          aria-label="Forward"
        >
          <ArrowRight size={19} />
        </button>
        <button
          type="button"
          className="icon-button nav-button"
          onClick={() => {
            if (!id) return;
            if (activeTab?.loading) void window.xuvon.tabs.stop(id);
            else void window.xuvon.tabs.reload(id);
          }}
          disabled={!activeTab}
          title={activeTab?.loading ? "Stop loading" : "Reload"}
          aria-label={activeTab?.loading ? "Stop loading" : "Reload"}
        >
          {activeTab?.loading ? <X size={17} /> : <Reload size={17} />}
        </button>
      </div>

      <form
        className={[
          "address-shell",
          addressFocused ? "is-focused" : "",
          mode === "private" ? "mode-private" : "",
          mode === "tor" ? "mode-tor" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        onSubmit={(event) => {
          event.preventDefault();
          onAddressSubmit();
        }}
      >
        <span className={`site-badge ${secure === false ? "is-warning" : ""}`} title={siteLabel}>
          {internal ? (
            <Sparkles size={14} />
          ) : mode === "tor" ? (
            <Onion size={15} />
          ) : mode === "private" ? (
            <Incognito size={15} />
          ) : secure === true ? (
            <Lock size={14} />
          ) : secure === false ? (
            <ShieldAlert size={15} />
          ) : (
            <Globe size={15} />
          )}
        </span>
        {!internal && mode !== "normal" ? (
          <span className={`mode-badge mode-${mode}`}>{mode === "tor" ? "Tor" : "Private"}</span>
        ) : null}
        <input
          ref={addressRef}
          className="address-input"
          value={addressValue}
          onChange={(event) => onAddressChange(event.target.value)}
          onFocus={onAddressFocus}
          onBlur={onAddressBlur}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          aria-label="Address and search bar"
        />
        {activeTab?.loading ? <span className="address-loading" aria-hidden="true" /> : null}
      </form>

      <div className="toolbar-actions">
        <div className="shield-wrap">
          <button
            type="button"
            className={`icon-button shield-button ${
              blocking && !siteAllowed ? "is-protected" : ""
            }`}
            onClick={onToggleShield}
            title={
              blockedCount > 0
                ? `${blockedCount} ad/tracker request${blockedCount === 1 ? "" : "s"} blocked in this tab`
                : "Ad & tracker blocker"
            }
            aria-label="Ad and tracker blocker"
            aria-haspopup="dialog"
            aria-controls="xuvon-shield-panel"
            aria-expanded={shieldOpen}
          >
            {blocking && !siteAllowed ? <ShieldCheck size={17} /> : <Shield size={17} />}
            {blockedCount > 0 ? (
              <span className="count-badge shield-badge">
                {blockedCount > 99 ? "99+" : blockedCount}
              </span>
            ) : null}
          </button>
        </div>
        <button
          type="button"
          className={`icon-button ${activeBookmark ? "is-accented" : ""}`}
          onClick={() => void toggleBookmark()}
          disabled={disabledBookmark}
          title={activeBookmark ? "Remove bookmark" : "Bookmark this page"}
          aria-label={activeBookmark ? "Remove bookmark" : "Bookmark this page"}
        >
          {activeBookmark ? <StarFilled size={17} /> : <Star size={17} />}
        </button>
        <button
          type="button"
          className="icon-button download-button"
          onClick={onOpenDownloads}
          title="Downloads"
          aria-label="Downloads"
        >
          <Download size={17} />
          {activeDownloadCount > 0 ? (
            <span className="count-badge">{activeDownloadCount > 9 ? "9+" : activeDownloadCount}</span>
          ) : null}
        </button>
        <button
          type="button"
          className="icon-button library-button"
          onClick={onOpenLibrary}
          title="Library"
          aria-label="Library"
        >
          <Grid size={17} />
        </button>
      </div>
    </div>
  );
}
