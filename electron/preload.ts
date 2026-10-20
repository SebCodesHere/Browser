import { contextBridge, ipcRenderer } from "electron";
import type {
  BookmarkCreateInput,
  BookmarkUpdateInput,
  BrowserEvent,
  FindOptions,
  Rectangle,
  SettingsPatch,
  TabCreateInput,
  XuvonApi
} from "../shared/types";

const api: XuvonApi = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome
  },
  bootstrap: () => ipcRenderer.invoke("xuvon:bootstrap"),
  onEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, event: BrowserEvent) => listener(event);
    ipcRenderer.on("xuvon:event", wrapped);
    return () => ipcRenderer.removeListener("xuvon:event", wrapped);
  },
  app: {
    showMenu: () => ipcRenderer.invoke("xuvon:app:show-menu"),
    openSettings: () => ipcRenderer.invoke("xuvon:app:open-settings"),
    openDataDirectory: () => ipcRenderer.invoke("xuvon:app:open-data-directory"),
    openFullDiskAccessSettings: () =>
      ipcRenderer.invoke("xuvon:app:open-full-disk-access-settings"),
    chooseDownloadDirectory: () => ipcRenderer.invoke("xuvon:app:choose-download-directory"),
    chooseWallpaper: () => ipcRenderer.invoke("xuvon:app:choose-wallpaper"),
    removeWallpaper: () => ipcRenderer.invoke("xuvon:app:remove-wallpaper"),
    clearBrowsingData: () => ipcRenderer.invoke("xuvon:app:clear-browsing-data"),
    setContentBounds: (bounds: Rectangle | null, tabId: string | null) =>
      ipcRenderer.send("xuvon:app:set-content-bounds", { bounds, tabId }),
    quit: () => ipcRenderer.send("xuvon:app:quit")
  },
  tabs: {
    create: (input?: TabCreateInput) => ipcRenderer.invoke("xuvon:tabs:create", input ?? {}),
    close: (tabId: string) => ipcRenderer.invoke("xuvon:tabs:close", tabId),
    activate: (tabId: string) => ipcRenderer.invoke("xuvon:tabs:activate", tabId),
    navigate: (tabId: string, input: string) =>
      ipcRenderer.invoke("xuvon:tabs:navigate", { tabId, input }),
    back: (tabId: string) => ipcRenderer.invoke("xuvon:tabs:back", tabId),
    forward: (tabId: string) => ipcRenderer.invoke("xuvon:tabs:forward", tabId),
    reload: (tabId: string, ignoreCache?: boolean) =>
      ipcRenderer.invoke("xuvon:tabs:reload", { tabId, ignoreCache }),
    stop: (tabId: string) => ipcRenderer.invoke("xuvon:tabs:stop", tabId),
    home: (tabId: string) => ipcRenderer.invoke("xuvon:tabs:home", tabId),
    move: (tabId: string, toIndex: number) =>
      ipcRenderer.invoke("xuvon:tabs:move", { tabId, toIndex }),
    closeOthers: (tabId: string) => ipcRenderer.invoke("xuvon:tabs:close-others", tabId),
    reopenClosed: () => ipcRenderer.invoke("xuvon:tabs:reopen-closed"),
    contextMenu: (tabId: string) => ipcRenderer.invoke("xuvon:tabs:context-menu", tabId),
    toggleDevTools: (tabId: string) => ipcRenderer.invoke("xuvon:tabs:devtools", tabId),
    find: (tabId: string, query: string, options?: FindOptions) =>
      ipcRenderer.invoke("xuvon:tabs:find", { tabId, query, options }),
    stopFind: (tabId: string) => ipcRenderer.invoke("xuvon:tabs:stop-find", tabId)
  },
  settings: {
    update: (patch: SettingsPatch) => ipcRenderer.invoke("xuvon:settings:update", patch),
    reset: () => ipcRenderer.invoke("xuvon:settings:reset")
  },
  onboarding: {
    complete: () => ipcRenderer.invoke("xuvon:onboarding:complete")
  },
  imports: {
    detect: () => ipcRenderer.invoke("xuvon:imports:detect"),
    choose: (kind) => ipcRenderer.invoke("xuvon:imports:choose", kind),
    preview: (input) => ipcRenderer.invoke("xuvon:imports:preview", input),
    commit: (bookmarksPath) => ipcRenderer.invoke("xuvon:imports:commit", { bookmarksPath })
  },
  tor: {
    check: () => ipcRenderer.invoke("xuvon:tor:check"),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke("xuvon:tor:set-enabled", enabled)
  },
  bookmarks: {
    list: (query?: string, folder?: string) =>
      ipcRenderer.invoke("xuvon:bookmarks:list", { query, folder }),
    find: (url: string) => ipcRenderer.invoke("xuvon:bookmarks:find", url),
    create: (input: BookmarkCreateInput) => ipcRenderer.invoke("xuvon:bookmarks:create", input),
    update: (id: string, patch: BookmarkUpdateInput) =>
      ipcRenderer.invoke("xuvon:bookmarks:update", { id, patch }),
    remove: (id: string) => ipcRenderer.invoke("xuvon:bookmarks:remove", id),
    folders: () => ipcRenderer.invoke("xuvon:bookmarks:folders")
  },
  history: {
    list: (query?: string, limit?: number, offset?: number) =>
      ipcRenderer.invoke("xuvon:history:list", { query, limit, offset }),
    topSites: (limit?: number) => ipcRenderer.invoke("xuvon:history:top-sites", { limit }),
    remove: (id: string) => ipcRenderer.invoke("xuvon:history:remove", id),
    clear: () => ipcRenderer.invoke("xuvon:history:clear")
  },
  downloads: {
    list: () => ipcRenderer.invoke("xuvon:downloads:list"),
    pause: (id: string) => ipcRenderer.invoke("xuvon:downloads:pause", id),
    resume: (id: string) => ipcRenderer.invoke("xuvon:downloads:resume", id),
    cancel: (id: string) => ipcRenderer.invoke("xuvon:downloads:cancel", id),
    open: (id: string) => ipcRenderer.invoke("xuvon:downloads:open", id),
    showInFolder: (id: string) => ipcRenderer.invoke("xuvon:downloads:show", id),
    remove: (id: string) => ipcRenderer.invoke("xuvon:downloads:remove", id),
    clearFinished: () => ipcRenderer.invoke("xuvon:downloads:clear-finished")
  },
  extensions: {
    list: () => ipcRenderer.invoke("xuvon:extensions:list"),
    chooseAndAdd: () => ipcRenderer.invoke("xuvon:extensions:add"),
    setEnabled: (id: string, enabled: boolean) =>
      ipcRenderer.invoke("xuvon:extensions:set-enabled", { id, enabled }),
    remove: (id: string) => ipcRenderer.invoke("xuvon:extensions:remove", id)
  }
};

contextBridge.exposeInMainWorld("xuvon", Object.freeze(api));
