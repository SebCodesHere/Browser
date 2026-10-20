import { useMemo } from "react";
import { isAllowlisted, normalizeAdblockHost } from "../../shared/adblock-utils";
import { useBrowser } from "../BrowserContext";
import { Shield, ShieldCheck, X } from "./Icons";
import { Toggle } from "./Ui";

interface ShieldPanelProps {
  onClose: () => void;
}

export function ShieldPanel({ onClose }: ShieldPanelProps) {
  const { activeTab, settings, adblock, updateSettings, openInternal } = useBrowser();

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
  const protectedHere = blocking && !siteAllowed;

  const toggleSite = async (enabled: boolean) => {
    if (!siteHost || !settings) return;
    const coversSite = (value: string) => {
      const allowed = normalizeAdblockHost(value);
      return Boolean(allowed && (siteHost === allowed || siteHost.endsWith(`.${allowed}`)));
    };
    const next = enabled
      ? settings.adblockAllowlist.filter((value) => !coversSite(value))
      : [
          ...settings.adblockAllowlist.filter(
            (value) => normalizeAdblockHost(value) !== siteHost
          ),
          siteHost
        ];
    await updateSettings({ adblockAllowlist: next });
  };

  return (
    <aside
      id="xuvon-shield-panel"
      className="shield-panel"
      role="dialog"
      aria-label="Ad and tracker blocking"
      data-testid="shield-panel"
    >
      <header className="shield-panel-head">
        <div className="shield-panel-title">
          <span className={`shield-panel-icon ${protectedHere ? "is-on" : ""}`}>
            {protectedHere ? <ShieldCheck size={18} /> : <Shield size={18} />}
          </span>
          <div>
            <span className="eyebrow">Per-tab privacy</span>
            <h2>Ad &amp; tracker blocker</h2>
          </div>
        </div>
        <button
          type="button"
          className="icon-button compact"
          onClick={onClose}
          aria-label="Close ad blocker panel"
          title="Close ad blocker"
        >
          <X size={16} />
        </button>
      </header>

      <div className="shield-panel-body">
        <div className={`shield-status-card ${protectedHere ? "is-protected" : ""}`}>
          <span className="shield-status-mark">
            {protectedHere ? <ShieldCheck size={20} /> : <Shield size={20} />}
          </span>
          <div className="shield-status-copy">
            <strong>
              {blockedCount.toLocaleString()} request{blockedCount === 1 ? "" : "s"} blocked
            </strong>
            <span>
              {!blocking
                ? "Turned off everywhere"
                : !siteHost
                  ? "Active for websites"
                  : siteAllowed
                    ? "Paused on this site"
                    : "On for this site"}
            </span>
          </div>
        </div>

        {siteHost ? (
          <div className="shield-site-row">
            <div className="shield-site-copy">
              <span className="shield-site-host">{siteHost}</span>
              <span className="shield-site-count">
                This tab since its last full navigation
              </span>
            </div>
            <Toggle
              label={`Block ads on ${siteHost}`}
              checked={protectedHere}
              disabled={!blocking}
              onChange={(value) => void toggleSite(value)}
            />
          </div>
        ) : (
          <p className="shield-note">
            Open a website to manage a per-site exception.
          </p>
        )}

        <div className="shield-global-row">
          <div>
            <strong>Block ads &amp; trackers</strong>
            <span>Applies to normal, private, and Tor tabs.</span>
          </div>
          <Toggle
            label="Block ads and trackers"
            checked={blocking}
            onChange={(value) => void updateSettings({ adblockEnabled: value })}
          />
        </div>

        <p className="shield-note">
          {adblock
            ? `${adblock.ruleCount} precompiled Xuvon rules, including ${adblock.exceptionRuleCount} exceptions.`
            : "Precompiled Xuvon network rules."}{" "}
          No cosmetic filtering or third-party filter list; details and limits are in Privacy
          settings.
        </p>

        <button
          type="button"
          className="shield-settings-link"
          onClick={() => {
            onClose();
            void openInternal("xuvon://settings");
          }}
        >
          Open privacy settings
        </button>
      </div>
    </aside>
  );
}
