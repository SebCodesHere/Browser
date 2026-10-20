import {
  ipcMain,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from "electron";
import { z } from "zod";
import type {
  Bootstrap,
  BrowserImportSource,
  ClearResult,
  ExtensionInfo,
  ImportCommitResult,
  ImportPickerKind,
  ImportPreview,
  ImportPreviewRequest,
  Settings,
  SettingsBundle,
  SettingsMutation,
  SettingsPatch
} from "../shared/types";
import type { CoreApi } from "./core";
import type { DownloadManager } from "./downloads";
import type { ExtensionsManager } from "./extensions";
import { log } from "./logger";
import {
  bookmarkCreateSchema,
  bookmarkQuerySchema,
  bookmarkUpdateSchema,
  boundsSchema,
  extensionToggleSchema,
  findSchema,
  historyQuerySchema,
  importCommitSchema,
  importPickerSchema,
  importPreviewSchema,
  moveSchema,
  navigateSchema,
  parseOrThrow,
  reloadSchema,
  settingsPatchSchema,
  tabCreateSchema,
  tabIdSchema,
  tabOnlySchema,
  topSitesSchema
} from "./schemas";
import type { TabManager } from "./tabs";
import type { TorController } from "./tor";

export interface IpcContext {
  api: CoreApi;
  downloads: DownloadManager;
  extensions: ExtensionsManager;
  tor: TorController;
  getWindow(): BrowserWindow | null;
  getTabs(): TabManager;
  getSettings(): Settings;
  bootstrap(): Promise<Bootstrap>;
  showAppMenu(): Promise<void>;
  openSettings(): Promise<void>;
  openDataDirectory(): Promise<void>;
  openFullDiskAccessSettings(): Promise<void>;
  chooseDownloadDirectory(): Promise<SettingsBundle | null>;
  chooseWallpaper(): Promise<SettingsBundle | null>;
  removeWallpaper(): Promise<SettingsBundle>;
  clearBrowsingData(): Promise<ClearResult>;
  clearHistory(): Promise<boolean>;
  quit(): void;
  updateSettings(patch: SettingsPatch): Promise<SettingsBundle>;
  resetSettings(): Promise<SettingsBundle>;
  setTorEnabled(enabled: boolean): Promise<SettingsMutation>;
  extensionsChanged(extensions: ExtensionInfo[]): void;
  detectBrowserSources(): Promise<BrowserImportSource[]>;
  chooseImportSources(kind: ImportPickerKind): Promise<BrowserImportSource[]>;
  previewImport(input: ImportPreviewRequest): Promise<ImportPreview>;
  commitImport(bookmarksPath: string): Promise<ImportCommitResult>;
  completeOnboarding(): Promise<{ completed: boolean }>;
}

let registered = false;

export function registerIpcHandlers(context: IpcContext): void {
  if (registered) return;
  registered = true;

  const trusted = (event: IpcMainInvokeEvent | IpcMainEvent): void => {
    const window = context.getWindow();
    if (!window || window.isDestroyed()) {
      throw new Error("The Xuvon window is not available.");
    }
    if (event.sender !== window.webContents) {
      throw new Error("Untrusted IPC sender.");
    }
    const frame = event.senderFrame;
    if (frame && frame !== window.webContents.mainFrame) {
      throw new Error("Untrusted IPC frame.");
    }
  };

  const invoke = (
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void => {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      trusted(event);
      try {
        return await handler(event, ...args);
      } catch (error) {
        log("warn", "IPC request failed", {
          channel,
          message: error instanceof Error ? error.message : String(error)
        });
        throw error instanceof Error ? error : new Error(String(error));
      }
    });
  };

  const send = (
    channel: string,
    handler: (event: IpcMainEvent, ...args: unknown[]) => unknown
  ): void => {
    ipcMain.on(channel, (event, ...args: unknown[]) => {
      try {
        trusted(event);
        handler(event, ...args);
      } catch (error) {
        log("warn", "IPC message rejected", {
          channel,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });
  };

  invoke("xuvon:bootstrap", () => context.bootstrap());

  invoke("xuvon:app:show-menu", () => context.showAppMenu());
  invoke("xuvon:app:open-settings", () => context.openSettings());
  invoke("xuvon:app:open-data-directory", () => context.openDataDirectory());
  invoke("xuvon:app:open-full-disk-access-settings", () =>
    context.openFullDiskAccessSettings()
  );
  invoke("xuvon:app:choose-download-directory", () => context.chooseDownloadDirectory());
  invoke("xuvon:app:choose-wallpaper", () => context.chooseWallpaper());
  invoke("xuvon:app:remove-wallpaper", () => context.removeWallpaper());
  invoke("xuvon:app:clear-browsing-data", () => context.clearBrowsingData());

  send("xuvon:app:set-content-bounds", (_event, raw) => {
    const input = parseOrThrow(boundsSchema, raw);
    context.getTabs().setBounds(input.bounds, input.tabId);
  });
  send("xuvon:app:quit", () => context.quit());

  invoke("xuvon:tabs:create", (_event, raw) =>
    context.getTabs().create(parseOrThrow(tabCreateSchema, raw))
  );
  invoke("xuvon:tabs:close", (_event, raw) => context.getTabs().close(parseOrThrow(tabIdSchema, raw)));
  invoke("xuvon:tabs:activate", (_event, raw) =>
    context.getTabs().activate(parseOrThrow(tabIdSchema, raw))
  );
  invoke("xuvon:tabs:navigate", (_event, raw) => {
    const input = parseOrThrow(navigateSchema, raw);
    return context.getTabs().navigate(input.tabId, input.input);
  });
  invoke("xuvon:tabs:back", (_event, raw) =>
    context.getTabs().back(parseOrThrow(tabIdSchema, raw))
  );
  invoke("xuvon:tabs:forward", (_event, raw) =>
    context.getTabs().forward(parseOrThrow(tabIdSchema, raw))
  );
  invoke("xuvon:tabs:reload", (_event, raw) => {
    const input = parseOrThrow(reloadSchema, raw);
    return context.getTabs().reload(input.tabId, input.ignoreCache ?? false);
  });
  invoke("xuvon:tabs:stop", (_event, raw) =>
    context.getTabs().stop(parseOrThrow(tabIdSchema, raw))
  );
  invoke("xuvon:tabs:home", (_event, raw) =>
    context.getTabs().home(parseOrThrow(tabIdSchema, raw))
  );
  invoke("xuvon:tabs:move", (_event, raw) => {
    const input = parseOrThrow(moveSchema, raw);
    return context.getTabs().move(input.tabId, input.toIndex);
  });
  invoke("xuvon:tabs:close-others", (_event, raw) =>
    context.getTabs().closeOthers(parseOrThrow(tabIdSchema, raw))
  );
  invoke("xuvon:tabs:reopen-closed", () => context.getTabs().reopenClosed());
  invoke("xuvon:tabs:context-menu", (_event, raw) =>
    context.getTabs().contextMenu(parseOrThrow(tabIdSchema, raw))
  );
  invoke("xuvon:tabs:devtools", (_event, raw) =>
    context.getTabs().toggleDevTools(parseOrThrow(tabIdSchema, raw))
  );
  invoke("xuvon:tabs:find", (_event, raw) => {
    const input = parseOrThrow(findSchema, raw);
    return context.getTabs().find(input.tabId, input.query, input.options);
  });
  invoke("xuvon:tabs:stop-find", (_event, raw) => {
    const input = parseOrThrow(tabOnlySchema, raw);
    context.getTabs().stopFind(input.tabId);
  });

  invoke("xuvon:settings:update", (_event, raw) =>
    context.updateSettings(parseOrThrow(settingsPatchSchema, raw))
  );
  invoke("xuvon:settings:reset", () => context.resetSettings());

  invoke("xuvon:onboarding:complete", () => context.completeOnboarding());

  invoke("xuvon:imports:detect", () => context.detectBrowserSources());
  invoke("xuvon:imports:choose", (_event, raw) =>
    context.chooseImportSources(parseOrThrow(importPickerSchema, raw))
  );
  invoke("xuvon:imports:preview", (_event, raw) =>
    context.previewImport(parseOrThrow(importPreviewSchema, raw))
  );
  invoke("xuvon:imports:commit", (_event, raw) => {
    const input = parseOrThrow(importCommitSchema, raw);
    return context.commitImport(input.bookmarksPath);
  });

  invoke("xuvon:tor:check", () => context.tor.check());
  invoke("xuvon:tor:set-enabled", (_event, raw) =>
    context.setTorEnabled(parseOrThrow(z.boolean(), raw))
  );

  invoke("xuvon:bookmarks:list", (_event, raw) => {
    const input = parseOrThrow(bookmarkQuerySchema, raw);
    return context.api.listBookmarks(input.query ?? "", input.folder);
  });
  invoke("xuvon:bookmarks:find", (_event, raw) =>
    context.api.findBookmark(parseOrThrow(z.string().max(8192), raw))
  );
  invoke("xuvon:bookmarks:create", (_event, raw) =>
    context.api.createBookmark(parseOrThrow(bookmarkCreateSchema, raw))
  );
  invoke("xuvon:bookmarks:update", (_event, raw) => {
    const input = parseOrThrow(
      z.object({ id: tabIdSchema, patch: bookmarkUpdateSchema }),
      raw
    );
    return context.api.updateBookmark(input.id, input.patch);
  });
  invoke("xuvon:bookmarks:remove", (_event, raw) =>
    context.api.removeBookmark(parseOrThrow(tabIdSchema, raw))
  );
  invoke("xuvon:bookmarks:folders", () => context.api.bookmarkFolders());

  invoke("xuvon:history:list", (_event, raw) => {
    const input = parseOrThrow(historyQuerySchema, raw);
    return context.api.listHistory(input.query ?? "", input.limit ?? 250, input.offset ?? 0);
  });
  invoke("xuvon:history:top-sites", (_event, raw) => {
    const input = parseOrThrow(topSitesSchema, raw);
    return context.api.topSites(input.limit ?? 8);
  });
  invoke("xuvon:history:remove", (_event, raw) =>
    context.api.removeHistory(parseOrThrow(tabIdSchema, raw))
  );
  invoke("xuvon:history:clear", () => context.clearHistory());

  invoke("xuvon:downloads:list", () => context.downloads.snapshot());
  invoke("xuvon:downloads:pause", (_event, raw) => {
    context.downloads.pause(parseOrThrow(tabIdSchema, raw));
  });
  invoke("xuvon:downloads:resume", (_event, raw) => {
    context.downloads.resume(parseOrThrow(tabIdSchema, raw));
  });
  invoke("xuvon:downloads:cancel", (_event, raw) => {
    context.downloads.cancel(parseOrThrow(tabIdSchema, raw));
  });
  invoke("xuvon:downloads:open", (_event, raw) =>
    context.downloads.open(parseOrThrow(tabIdSchema, raw))
  );
  invoke("xuvon:downloads:show", (_event, raw) => {
    context.downloads.showInFolder(parseOrThrow(tabIdSchema, raw));
  });
  invoke("xuvon:downloads:remove", (_event, raw) =>
    context.downloads.remove(parseOrThrow(tabIdSchema, raw))
  );
  invoke("xuvon:downloads:clear-finished", () => context.downloads.clearFinished());

  invoke("xuvon:extensions:list", async () => {
    const list = await context.extensions.list();
    context.extensionsChanged(list);
    return list;
  });
  invoke("xuvon:extensions:add", async () => {
    const list = await context.extensions.addFromFolder();
    context.extensionsChanged(list);
    return list;
  });
  invoke("xuvon:extensions:set-enabled", async (_event, raw) => {
    const input = parseOrThrow(extensionToggleSchema, raw);
    const list = await context.extensions.setEnabled(input.id, input.enabled);
    context.extensionsChanged(list);
    return list;
  });
  invoke("xuvon:extensions:remove", async (_event, raw) => {
    const list = await context.extensions.remove(parseOrThrow(tabIdSchema, raw));
    context.extensionsChanged(list);
    return list;
  });
}
