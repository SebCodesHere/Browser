import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  app,
  dialog,
  shell,
  type BrowserWindow,
  type DownloadItem as ElectronDownloadItem,
  type Event,
  type Session
} from "electron";
import type { DownloadItem, Notice, Settings } from "../shared/types";
import type { CoreApi, CoreDownload } from "./core";
import { mapDownload } from "./core";
import { log } from "./logger";

type DownloadSource = "normal" | "private" | "tor";

interface ActiveDownload {
  id: string;
  item: ElectronDownloadItem;
  data: DownloadItem;
  source: DownloadSource;
  persistent: boolean;
  lastEmit: number;
  lastPersist: number;
  emitTimer?: NodeJS.Timeout;
  /** Set when a failure or canceled save dialog should leave no history entry. */
  discard?: boolean;
  /** True once the persistent core record exists. */
  recordCreated?: boolean;
}

interface DownloadManagerOptions {
  api: CoreApi;
  getSettings: () => Settings;
  getWindow: () => BrowserWindow | null;
  onChanged: (downloads: DownloadItem[]) => void;
  notify: (notice: Omit<Notice, "id">) => void;
}

const DANGEROUS_EXTENSIONS = new Set([
  "exe",
  "msi",
  "msix",
  "bat",
  "cmd",
  "com",
  "scr",
  "ps1",
  "psm1",
  "vbs",
  "vbe",
  "wsf",
  "wsh",
  "hta",
  "jar",
  "app",
  "pkg",
  "dmg",
  "iso",
  "apk",
  "deb",
  "rpm",
  "sh",
  "command",
  "workflow",
  "reg"
]);

export class DownloadManager {
  private readonly active = new Map<string, ActiveDownload>();
  private history: DownloadItem[] = [];
  private readonly historySources = new Map<string, DownloadSource>();
  private readonly attached = new WeakSet<Session>();
  private readonly sources = new WeakMap<Session, DownloadSource>();
  private readonly assignedPaths = new Set<string>();

  constructor(private readonly options: DownloadManagerOptions) {}

  async init(): Promise<void> {
    try {
      const records = await this.options.api.listDownloads();
      this.history = records.map((record) => this.fromRecord(record));
      for (const record of this.history) this.historySources.set(record.id, "normal");
    } catch (error) {
      log("warn", "could not load download history", { message: String(error) });
      this.history = [];
    }
    this.emit();
  }

  attachSession(session: Session, source: DownloadSource): void {
    if (this.attached.has(session) && this.sources.get(session) === source) return;
    this.attached.add(session);
    this.sources.set(session, source);
    session.on("will-download", (_event: Event, item: ElectronDownloadItem) => {
      void this.onWillDownload(item, source);
    });
  }

  private fromRecord(record: CoreDownload): DownloadItem {
    return mapDownload(record, {
      isPrivate: false,
      active: false,
      canResume: false
    });
  }

  snapshot(): DownloadItem[] {
    const items = new Map<string, DownloadItem>();
    for (const record of this.history) items.set(record.id, record);
    for (const active of this.active.values()) items.set(active.id, active.data);
    return [...items.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  private emit(): void {
    this.options.onChanged(this.snapshot());
  }

  private notify(notice: Omit<Notice, "id">): void {
    this.options.notify(notice);
  }

  private persistNewDownload(active: ActiveDownload): void {
    if (!active.persistent) return;
    active.recordCreated = true;
    void this.options.api
      .createDownload({
        id: active.id,
        url: active.data.url,
        filename: active.data.filename,
        path: active.data.path,
        totalBytes: active.data.totalBytes,
        danger: active.data.danger
      })
      .catch((error) => {
        active.recordCreated = false;
        log("warn", "could not persist download", { message: String(error) });
      });
  }

  private warnIfDangerous(active: ActiveDownload): void {
    if (!active.data.danger) return;
    this.notify({
      tone: "warning",
      message: `${active.data.filename} can run code. Xuvon will not open it automatically.`,
      actionLabel: "Downloads",
      action: "open-downloads"
    });
  }

  private onWillDownload(item: ElectronDownloadItem, source: DownloadSource): void {
    const id = randomUUID();
    const transient = source !== "normal";
    const filename = sanitizeFilename(item.getFilename() || "download");
    const now = new Date().toISOString();
    const data: DownloadItem = {
      id,
      filename,
      url: item.getURL(),
      path: "",
      state: "progressing",
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      danger: isDangerousFilename(filename),
      isPrivate: transient,
      startedAt: now,
      updatedAt: now,
      error: null,
      canResume: false,
      active: true
    };
    const active: ActiveDownload = {
      id,
      item,
      data,
      source,
      persistent: source === "normal",
      lastEmit: 0,
      lastPersist: 0
    };

    // Reserve the destination synchronously when no save dialog is needed. A
    // tiny or cached transfer can otherwise complete before the async path
    // setup below, saving to Chromium's default folder instead.
    const settings = this.options.getSettings();
    if (!settings.askWhereToSave) {
      try {
        const directory = settings.downloadDirectory || app.getPath("downloads");
        fs.mkdirSync(directory, { recursive: true });
        const destination = uniquePath(directory, filename, this.assignedPaths);
        this.assignedPaths.add(destination);
        const preparedName = path.basename(destination);
        active.data = {
          ...active.data,
          filename: preparedName,
          path: destination,
          danger: isDangerousFilename(preparedName),
          updatedAt: new Date().toISOString()
        };
        item.setSavePath(destination);
      } catch (error) {
        log("warn", "could not reserve download path", { message: String(error) });
      }
    }

    // Pause and register listeners synchronously. A tiny or cached transfer
    // can otherwise finish before the async save-path setup below completes,
    // which would leave a stale "progressing" record behind.
    item.pause();
    this.active.set(id, active);
    this.emit();

    item.on("updated", (_event, state) => {
      if (this.active.get(id) !== active) return;
      const nextState = item.isPaused()
        ? "paused"
        : state === "interrupted"
          ? "interrupted"
          : "progressing";
      active.data = {
        ...active.data,
        state: nextState,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        canResume: item.canResume(),
        updatedAt: new Date().toISOString()
      };
      this.scheduleEmit(active);
      this.persist(active);
    });

    item.once("done", (_event, state) => {
      if (this.active.get(id) !== active) {
        // The record was discarded (removed or its private session was
        // cleared) while the transfer was still in flight.
        if (active.emitTimer) clearTimeout(active.emitTimer);
        if (active.data.path) this.assignedPaths.delete(active.data.path);
        return;
      }
      active.data = {
        ...active.data,
        state:
          state === "completed"
            ? "completed"
            : state === "cancelled"
              ? "cancelled"
              : "interrupted",
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        path: item.getSavePath() || active.data.path,
        canResume: false,
        active: false,
        updatedAt: new Date().toISOString(),
        error:
          state === "interrupted"
            ? "The download was interrupted before it finished."
            : null
      };
      if (active.emitTimer) clearTimeout(active.emitTimer);
      if (active.data.path) this.assignedPaths.delete(active.data.path);
      this.active.delete(id);
      if (active.discard) {
        this.emit();
        return;
      }
      this.history = [active.data, ...this.history.filter((entry) => entry.id !== id)];
      this.historySources.set(id, active.source);
      this.emit();
      if (active.persistent) {
        void this.options.api
          .updateDownload({
            id,
            state: active.data.state,
            receivedBytes: active.data.receivedBytes,
            totalBytes: active.data.totalBytes,
            error: active.data.error ?? null
          })
          .catch((error) => {
            log("warn", "could not update download", { message: String(error) });
          });
      }
      if (state === "completed") {
        this.notify({
          tone: "success",
          message: `${active.data.filename} finished downloading.`,
          actionLabel: "Show",
          action: "open-downloads"
        });
      }
    });

    void this.placeDownload(active, item, filename);
  }

  private async placeDownload(
    active: ActiveDownload,
    item: ElectronDownloadItem,
    originalName: string
  ): Promise<void> {
    try {
      const settings = this.options.getSettings();
      const directory = settings.downloadDirectory || app.getPath("downloads");

      if (!settings.askWhereToSave && active.data.path) {
        // The path was already reserved synchronously in onWillDownload.
        this.persistNewDownload(active);
        this.emit();
        item.resume();
        this.warnIfDangerous(active);
        return;
      }

      await fs.promises.mkdir(directory, { recursive: true });

      const proposed = uniquePath(directory, originalName, this.assignedPaths);
      let destination = proposed;
      if (settings.askWhereToSave) {
        const parent = this.options.getWindow();
        const result = parent
          ? await dialog.showSaveDialog(parent, { defaultPath: proposed })
          : await dialog.showSaveDialog({ defaultPath: proposed });
        if (result.canceled || !result.filePath) {
          active.discard = true;
          item.cancel();
          this.active.delete(active.id);
          this.emit();
          return;
        }
        destination = result.filePath;
      }

      this.assignedPaths.add(destination);
      const filename = path.basename(destination);
      const danger = isDangerousFilename(filename);
      active.data = {
        ...active.data,
        filename,
        path: destination,
        danger,
        updatedAt: new Date().toISOString()
      };
      item.setSavePath(destination);

      this.persistNewDownload(active);
      this.emit();
      item.resume();
      this.warnIfDangerous(active);
    } catch (error) {
      active.discard = true;
      item.cancel();
      this.active.delete(active.id);
      if (active.persistent && active.recordCreated) {
        void this.options.api.removeDownload(active.id).catch(() => {});
      }
      this.emit();
      this.notify({
        tone: "error",
        message: `The download could not be started: ${
          error instanceof Error ? error.message : String(error)
        }`
      });
    }
  }

  private scheduleEmit(active: ActiveDownload): void {
    if (active.emitTimer) return;
    const delay = Math.max(0, 250 - (Date.now() - active.lastEmit));
    active.emitTimer = setTimeout(() => {
      active.emitTimer = undefined;
      active.lastEmit = Date.now();
      this.emit();
    }, delay);
  }

  private persist(active: ActiveDownload): void {
    if (!active.persistent || !active.recordCreated) return;
    const now = Date.now();
    if (now - active.lastPersist < 1_000) return;
    active.lastPersist = now;
    void this.options.api
      .updateDownload({
        id: active.id,
        state: active.data.state,
        receivedBytes: active.data.receivedBytes,
        totalBytes: active.data.totalBytes,
        error: active.data.error ?? null
      })
      .catch(() => {
        // Non-fatal; the visible in-memory state remains correct.
      });
  }

  private find(id: string): { active?: ActiveDownload; history?: DownloadItem } {
    return {
      active: this.active.get(id),
      history: this.history.find((entry) => entry.id === id)
    };
  }

  pause(id: string): void {
    const { active } = this.find(id);
    if (!active || active.data.state !== "progressing") return;
    active.item.pause();
    active.data = { ...active.data, state: "paused", canResume: active.item.canResume() };
    this.emit();
    if (active.persistent) {
      void this.options.api.updateDownload({ id, state: "paused" }).catch(() => {});
    }
  }

  resume(id: string): void {
    const { active } = this.find(id);
    if (!active || !active.item.canResume() || !active.item.isPaused()) return;
    active.item.resume();
    active.data = { ...active.data, state: "progressing", canResume: false };
    this.emit();
    if (active.persistent) {
      void this.options.api.updateDownload({ id, state: "progressing" }).catch(() => {});
    }
  }

  cancel(id: string): void {
    const { active } = this.find(id);
    if (!active) return;
    active.item.cancel();
    active.data = { ...active.data, state: "cancelled", canResume: false };
    this.emit();
    if (active.persistent) {
      void this.options.api.updateDownload({ id, state: "cancelled" }).catch(() => {});
    }
  }

  async open(id: string): Promise<void> {
    const { active, history } = this.find(id);
    const data = active?.data ?? history;
    if (!data) return;
    if (data.state !== "completed") {
      throw new Error("This download has not finished.");
    }
    if (!fs.existsSync(data.path)) {
      throw new Error("The downloaded file is no longer at this location.");
    }
    if (data.danger) {
      const parent = this.options.getWindow();
      const options = {
        type: "warning" as const,
        title: "Open potentially unsafe file?",
        message: `${data.filename} can run code or install software.`,
        detail:
          "Only open this file if you trust the website it came from. Chromium's sandbox does not protect you after a file is opened in another application.",
        buttons: ["Cancel", "Open anyway"],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      };
      const result = parent
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options);
      if (result.response !== 1) return;
    }
    const error = await shell.openPath(data.path);
    if (error) throw new Error(error);
  }

  showInFolder(id: string): void {
    const { active, history } = this.find(id);
    const data = active?.data ?? history;
    if (!data) return;
    if (!fs.existsSync(data.path)) {
      throw new Error("The downloaded file is no longer at this location.");
    }
    shell.showItemInFolder(data.path);
  }

  async remove(id: string): Promise<void> {
    const { active, history } = this.find(id);
    if (active) {
      if (active.data.state === "progressing" || active.data.state === "paused") {
        active.item.cancel();
      }
      this.active.delete(id);
      this.assignedPaths.delete(active.data.path);
      if (active.persistent) {
        await this.options.api.removeDownload(id).catch(() => {});
      }
    }
    if (history) {
      this.history = this.history.filter((entry) => entry.id !== id);
      const source = this.historySources.get(id);
      this.historySources.delete(id);
      if (source === "normal") {
        await this.options.api.removeDownload(id).catch(() => {});
      }
    }
    this.emit();
  }

  async clearFinished(): Promise<void> {
    for (const [id, active] of this.active) {
      if (
        active.data.state === "completed" ||
        active.data.state === "cancelled" ||
        active.data.state === "interrupted"
      ) {
        this.active.delete(id);
        this.assignedPaths.delete(active.data.path);
      }
    }
    this.history = [];
    this.historySources.clear();
    await this.options.api.clearFinishedDownloads().catch(() => {});
    this.emit();
  }

  async clearSource(source: DownloadSource): Promise<void> {
    for (const [id, active] of this.active) {
      if (active.source !== source) continue;
      if (active.data.state === "progressing" || active.data.state === "paused") {
        active.item.cancel();
      }
      this.active.delete(id);
      this.assignedPaths.delete(active.data.path);
    }
    this.history = this.history.filter((entry) => {
      if (this.historySources.get(entry.id) !== source) return true;
      this.historySources.delete(entry.id);
      return false;
    });
    this.emit();
  }

  async removeHistoryRecord(id: string): Promise<void> {
    const source = this.historySources.get(id);
    this.historySources.delete(id);
    this.history = this.history.filter((entry) => entry.id !== id);
    if (source === undefined || source === "normal") {
      await this.options.api.removeDownload(id).catch(() => {});
    }
    this.emit();
  }
}

function sanitizeFilename(value: string): string {
  const base = path.basename(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const safe = base.replace(/[/:\\]/g, "-");
  return (safe || "download").slice(0, 180);
}

export function isDangerousFilename(filename: string): boolean {
  const extension = path.extname(filename).slice(1).toLowerCase();
  return DANGEROUS_EXTENSIONS.has(extension);
}

function uniquePath(directory: string, filename: string, reserved: Set<string>): string {
  const extension = path.extname(filename);
  const stem = path.basename(filename, extension) || "download";
  let candidate = path.join(directory, `${stem}${extension}`);
  let counter = 1;
  while (fs.existsSync(candidate) || reserved.has(candidate)) {
    candidate = path.join(directory, `${stem} (${counter})${extension}`);
    counter += 1;
    if (counter > 10_000) {
      candidate = path.join(directory, `${stem}-${Date.now()}${extension}`);
      break;
    }
  }
  return candidate;
}
