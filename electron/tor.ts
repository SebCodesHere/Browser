import { session, type Session } from "electron";
import type { Settings, TorState } from "../shared/types";
import type { CoreApi } from "./core";
import { log } from "./logger";

const CHECK_URL = "https://check.torproject.org/api/ip";
const CHECK_TIMEOUT_MS = 25_000;
const FRESH_MS = 5 * 60 * 1000;
const PARTITION = "xuvon-tor-check";

export class TorUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TorUnavailableError";
  }
}

export class TorController {
  private state: TorState;
  private inFlight: Promise<TorState> | null = null;
  private checkedForProxy: string | null = null;
  private checkedAtMs = 0;

  constructor(
    private settings: Settings,
    private readonly api: CoreApi,
    private readonly emit: (state: TorState) => void
  ) {
    this.state = this.makeState(settings, settings.torEnabled ? "unavailable" : "disabled");
  }

  getState(): TorState {
    return { ...this.state };
  }

  updateSettings(settings: Settings): void {
    const proxyChanged = settings.torProxy !== this.settings.torProxy;
    this.settings = settings;
    if (!settings.torEnabled) {
      this.invalidate();
      this.state = this.makeState(settings, "disabled");
      this.emit(this.getState());
      return;
    }
    if (proxyChanged) {
      this.invalidate();
      this.state = {
        ...this.makeState(settings, "unavailable"),
        message: "The Tor proxy changed. Verify the circuit again before browsing."
      };
      this.emit(this.getState());
      return;
    }
    this.state = {
      ...this.state,
      enabled: true,
      proxy: settings.torProxy
    };
    this.emit(this.getState());
  }

  invalidate(): void {
    this.checkedForProxy = null;
    this.checkedAtMs = 0;
  }

  private makeState(settings: Settings, status: TorState["status"]): TorState {
    return {
      enabled: settings.torEnabled,
      proxy: settings.torProxy,
      status,
      message:
        status === "disabled"
          ? null
          : status === "unavailable"
            ? "Tor has not been verified yet."
            : null,
      exitIp: null,
      checkedAt: null
    };
  }

  isFreshAvailable(): boolean {
    return (
      this.state.status === "available" &&
      this.checkedForProxy === this.settings.torProxy &&
      Date.now() - this.checkedAtMs < FRESH_MS
    );
  }

  async check(): Promise<TorState> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runCheck().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runCheck(): Promise<TorState> {
    const settings = this.settings;
    this.state = {
      enabled: settings.torEnabled,
      proxy: settings.torProxy,
      status: "checking",
      message: "Verifying the Tor circuit…",
      exitIp: this.state.exitIp ?? null,
      checkedAt: this.state.checkedAt ?? null
    };
    this.emit(this.getState());

    let proxy: string;
    try {
      proxy = await this.api.validateTorProxy(settings.torProxy);
    } catch (error) {
      return this.finishUnavailable(
        error instanceof Error ? error.message : "The Tor proxy address is invalid."
      );
    }

    const checkSession: Session = session.fromPartition(PARTITION);
    try {
      await checkSession.setProxy({
        mode: "fixed_servers",
        proxyRules: proxy,
        proxyBypassRules: "<-loopback>"
      });
    } catch (error) {
      log("warn", "could not apply Tor proxy", { message: String(error) });
      return this.finishUnavailable("Xuvon could not apply the Tor proxy configuration.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    try {
      const response = await checkSession.fetch(CHECK_URL, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: "application/json"
        }
      });
      if (!response.ok) {
        return this.finishUnavailable(
          `The Tor check endpoint replied with HTTP ${response.status}.`
        );
      }
      const payload = (await response.json()) as {
        IsTor?: boolean;
        IP?: string;
      };
      if (payload.IsTor !== true) {
        return this.finishUnavailable(
          "The configured proxy is reachable but is not a verified Tor circuit."
        );
      }
      const checkedAt = new Date().toISOString();
      this.checkedForProxy = settings.torProxy;
      this.checkedAtMs = Date.now();
      this.state = {
        enabled: settings.torEnabled,
        proxy: settings.torProxy,
        status: "available",
        message: "Traffic is routed through a verified Tor circuit.",
        exitIp: typeof payload.IP === "string" ? payload.IP : null,
        checkedAt
      };
      this.emit(this.getState());
      return this.getState();
    } catch (error) {
      const message =
        error instanceof Error && error.name === "AbortError"
          ? "The Tor proxy did not respond in time. Is the Tor daemon running?"
          : "Xuvon could not reach the Tor check endpoint through the configured proxy.";
      log("warn", "tor check failed", {
        message: error instanceof Error ? error.message : String(error)
      });
      return this.finishUnavailable(message);
    } finally {
      clearTimeout(timeout);
      checkSession
        .clearStorageData({ storages: ["cookies", "localstorage", "serviceworkers", "cachestorage"] })
        .catch(() => {});
    }
  }

  private finishUnavailable(message: string): TorState {
    this.checkedForProxy = null;
    this.checkedAtMs = 0;
    this.state = {
      enabled: this.settings.torEnabled,
      proxy: this.settings.torProxy,
      status: "unavailable",
      message,
      exitIp: null,
      checkedAt: new Date().toISOString()
    };
    this.emit(this.getState());
    return this.getState();
  }

  async ensureReady(): Promise<void> {
    if (!this.settings.torEnabled) {
      throw new TorUnavailableError("Tor mode is not enabled.");
    }
    if (this.isFreshAvailable()) return;
    const state = await this.check();
    if (state.status !== "available") {
      throw new TorUnavailableError(
        state.message ?? "Tor is not available. Xuvon will not fall back to a direct connection."
      );
    }
  }
}
