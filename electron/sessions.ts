import { session, type Session } from "electron";
import { getDomain } from "tldts";
import { decideAdblock } from "../shared/adblock";
import type { Notice, Settings } from "../shared/types";
import type { DownloadManager } from "./downloads";
import { log } from "./logger";

type Source = "normal" | "private" | "tor";

const NORMAL_PARTITION = "persist:xuvon-normal";
const PRIVATE_PARTITION = "xuvon-private";
const TOR_PARTITION = "xuvon-tor";

interface SessionManagerOptions {
  getSettings: () => Settings;
  downloads: DownloadManager;
  notify: (notice: Omit<Notice, "id">) => void;
  /** Called when the ad blocker cancels a request. */
  onRequestBlocked?: (webContentsId: number | null, host: string, url: string) => void;
}

/**
 * Owns Chromium session isolation, proxy policy, cookie controls, permissions,
 * onion blocking, and cleanup for normal, private, and Tor browsing.
 */
export class SessionManager {
  private readonly configured = new WeakSet<Session>();
  private readonly noticeCooldown = new Map<string, number>();
  private normalSessionValue: Session | null = null;
  private privateSessionValue: Session | null = null;
  private torSessionValue: Session | null = null;

  constructor(private readonly options: SessionManagerOptions) {}

  normal(): Session {
    if (!this.normalSessionValue) {
      this.normalSessionValue = session.fromPartition(NORMAL_PARTITION);
      this.configure(this.normalSessionValue, "normal");
    }
    return this.normalSessionValue;
  }

  privateSession(): Session {
    if (!this.privateSessionValue) {
      this.privateSessionValue = session.fromPartition(PRIVATE_PARTITION);
      this.configure(this.privateSessionValue, "private");
    }
    return this.privateSessionValue;
  }

  async tor(): Promise<Session> {
    if (!this.torSessionValue) {
      this.torSessionValue = session.fromPartition(TOR_PARTITION);
      this.configure(this.torSessionValue, "tor");
    }
    await this.torSessionValue.setProxy({
      mode: "fixed_servers",
      proxyRules: this.options.getSettings().torProxy,
      proxyBypassRules: "<-loopback>"
    });
    return this.torSessionValue;
  }

  sessionFor(source: Source): Session | Promise<Session> {
    if (source === "normal") return this.normal();
    if (source === "private") return this.privateSession();
    return this.tor();
  }

  private configure(ses: Session, source: Source): void {
    if (this.configured.has(ses)) return;
    this.configured.add(ses);
    this.applyUserAgent(ses);
    this.installRequestPolicies(ses);
    this.installPermissions(ses);
    this.options.downloads.attachSession(ses, source);
  }

  private applyUserAgent(ses: Session): void {
    const chrome = process.versions.chrome;
    const platform =
      process.platform === "darwin"
        ? "Macintosh; Intel Mac OS X 10_15_7"
        : process.platform === "win32"
          ? "Windows NT 10.0; Win64; x64"
          : "X11; Linux x86_64";
    ses.setUserAgent(
      `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36 Xuvon/0.1`
    );
  }

  private installRequestPolicies(ses: Session): void {
    // Onion destinations are blocked even before host resolution. This covers
    // top-level navigation, redirects, subresources, and WebSocket requests.
    ses.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
      try {
        const hostname = new URL(details.url).hostname;
        if (hostname === "onion" || hostname.endsWith(".onion")) {
          if (details.resourceType === "mainFrame") {
            this.notifyOnce(
              "onion-blocked",
              "warning",
              "An onion destination was blocked. Xuvon routes clear-web traffic only and never resolves onion addresses."
            );
          }
          callback({ cancel: true });
          return;
        }
      } catch {
        // Chromium handles malformed URLs.
      }

      const settings = this.options.getSettings();
      if (settings.adblockEnabled) {
        const topUrl = details.webContents?.getURL() || details.referrer || "";
        const decision = decideAdblock({
          url: details.url,
          resourceType: details.resourceType,
          topUrl,
          allowlist: settings.adblockAllowlist
        });
        if (decision) {
          const webContentsId =
            typeof details.webContentsId === "number" && details.webContentsId >= 0
              ? details.webContentsId
              : null;
          this.options.onRequestBlocked?.(webContentsId, decision.host, details.url);
          callback({ cancel: true });
          return;
        }
      }
      callback({ cancel: false });
    });

    ses.webRequest.onBeforeSendHeaders({ urls: ["<all_urls>"] }, (details, callback) => {
      const settings = this.options.getSettings();
      const headers = { ...details.requestHeaders };
      if (settings.sendDoNotTrack) {
        if (!hasHeader(headers, "DNT")) headers.DNT = "1";
      }
      if (settings.cookiePolicy !== "allow_all") {
        const topUrl = details.webContents?.getURL() ?? "";
        if (isThirdParty(topUrl, details.url) && hasHeader(headers, "Cookie")) {
          removeHeader(headers, "Cookie");
        }
      }
      callback({ requestHeaders: headers });
    });

    ses.webRequest.onHeadersReceived({ urls: ["<all_urls>"] }, (details, callback) => {
      const settings = this.options.getSettings();
      const responseHeaders = details.responseHeaders;
      if (!responseHeaders || settings.cookiePolicy === "allow_all") {
        callback({ responseHeaders });
        return;
      }
      const topUrl = details.webContents?.getURL() ?? "";
      const thirdParty = isThirdParty(topUrl, details.url);
      const next: Record<string, string[]> = {};
      for (const [rawName, values] of Object.entries(responseHeaders)) {
        const name = rawName.toLowerCase();
        if (name !== "set-cookie" && name !== "set-cookie2") {
          next[rawName] = values;
          continue;
        }
        if (settings.cookiePolicy === "block_third_party" && thirdParty) {
          continue;
        }
        if (settings.cookiePolicy === "session_only") {
          if (thirdParty) continue;
          const downgraded = values
            .map(stripCookiePersistence)
            .filter((value): value is string => value !== null);
          if (downgraded.length > 0) next[rawName] = downgraded;
          continue;
        }
        next[rawName] = values;
      }
      callback({ responseHeaders: next });
    });
  }

  private installPermissions(ses: Session): void {
    const allowed = new Set(["fullscreen", "clipboard-sanitized-write"]);
    ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
      if (allowed.has(permission)) {
        callback(true);
        return;
      }
      let host = "This site";
      try {
        host = new URL(details.requestingUrl).hostname || host;
      } catch {
        // Keep fallback.
      }
      this.notifyOnce(
        `permission-${host}-${permission}`,
        "info",
        `${host} requested ${permission} access. Xuvon denies sensitive permissions by default.`
      );
      callback(false);
    });
    ses.setPermissionCheckHandler((_contents, permission) => allowed.has(permission));
  }

  async clearPrivate(): Promise<void> {
    if (!this.privateSessionValue) return;
    await clearSession(this.privateSessionValue);
    log("info", "private session cleared");
  }

  async clearTor(): Promise<void> {
    if (!this.torSessionValue) return;
    await clearSession(this.torSessionValue);
    log("info", "tor session cleared");
  }

  async clearNormal(scope: "all" | "cookies" | "cache"): Promise<void> {
    const ses = this.normal();
    if (scope === "all" || scope === "cookies") {
      await ses.clearStorageData({
        storages: [
          "cookies",
          "localstorage",
          "indexdb",
          "serviceworkers",
          "cachestorage",
          "shadercache",
          "filesystem"
        ]
      });
      await ses.clearAuthCache();
    }
    if (scope === "all" || scope === "cache") {
      await ses.clearCache();
    }
    await ses.clearHostResolverCache();
    await ses.closeAllConnections();
  }

  async clearOnExit(): Promise<void> {
    const settings = this.options.getSettings();
    if (settings.clearDataOnExit || settings.cookiePolicy === "session_only") {
      await this.clearNormal("all");
    }
    await this.clearPrivate();
    await this.clearTor();
  }

  private notifyOnce(key: string, tone: Notice["tone"], message: string): void {
    const now = Date.now();
    const last = this.noticeCooldown.get(key) ?? 0;
    if (now - last < 8_000) return;
    this.noticeCooldown.set(key, now);
    this.options.notify({ tone, message });
  }
}

async function clearSession(ses: Session): Promise<void> {
  await ses
    .clearStorageData({
      storages: [
        "cookies",
        "localstorage",
        "indexdb",
        "serviceworkers",
        "cachestorage",
        "shadercache",
        "filesystem"
      ]
    })
    .catch(() => {});
  await ses.clearCache().catch(() => {});
  await ses.clearAuthCache().catch(() => {});
  await ses.clearHostResolverCache().catch(() => {});
  await ses.closeAllConnections().catch(() => {});
}

function isThirdParty(topUrl: string, requestUrl: string): boolean {
  try {
    const top = new URL(topUrl);
    const request = new URL(requestUrl);
    if (top.protocol !== "http:" && top.protocol !== "https:") return false;
    if (request.protocol !== "http:" && request.protocol !== "https:") return false;
    const topSite = getDomain(top.hostname, { allowPrivateDomains: true }) ?? top.hostname;
    const requestSite =
      getDomain(request.hostname, { allowPrivateDomains: true }) ?? request.hostname;
    return topSite.toLowerCase() !== requestSite.toLowerCase();
  } catch {
    return false;
  }
}

function stripCookiePersistence(value: string): string | null {
  const kept = value
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      const name = part.toLowerCase();
      return !name.startsWith("expires=") && !name.startsWith("max-age=");
    });
  const cookie = kept.join("; ").trim();
  return cookie.length > 0 ? cookie : null;
}

function hasHeader(headers: Record<string, string | string[]>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
}

function removeHeader(headers: Record<string, string | string[]>, name: string): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) delete headers[key];
  }
}
