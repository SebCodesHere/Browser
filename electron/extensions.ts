import fs from "node:fs";
import path from "node:path";
import { dialog, type BrowserWindow, type Extension, type Session } from "electron";
import type { ExtensionInfo, Settings } from "../shared/types";
import type { CoreApi, CoreExtension } from "./core";
import { log } from "./logger";

interface ExtensionsOptions {
  api: CoreApi;
  getSettings: () => Settings;
  session: () => Session;
  getWindow: () => BrowserWindow | null;
}

/**
 * Unpacked Chromium extension integration.
 *
 * Electron exposes a subset of the Chrome extension APIs and cannot install
 * packed .crx files or browse the Chrome Web Store. This manager is explicit
 * about that boundary: users select a local unpacked directory and receive a
 * permission warning before the extension is loaded into the normal profile.
 */
export class ExtensionsManager {
  private loadErrors = new Map<string, string>();

  constructor(private readonly options: ExtensionsOptions) {}

  async loadAll(): Promise<void> {
    const records = await this.options.api.listExtensions().catch((error) => {
      log("warn", "could not read extension registry", { message: String(error) });
      return [] as CoreExtension[];
    });
    if (!this.options.getSettings().extensionsEnabled) return;
    for (const record of records) {
      if (!record.enabled) continue;
      try {
        await this.loadPath(record.path);
      } catch (error) {
        this.loadErrors.set(record.id, errorMessage(error));
        log("warn", "extension failed to load", {
          name: record.name,
          message: errorMessage(error)
        });
      }
    }
  }

  async list(): Promise<ExtensionInfo[]> {
    const records = await this.options.api.listExtensions();
    const ses = this.options.session();
    const loaded = getLoadedExtensions(ses);
    return records.map((record) => {
      const extension =
        loaded.find((entry) => entry.id === record.id) ??
        loaded.find((entry) => path.resolve(entry.path) === path.resolve(record.path));
      const manifest = readManifest(record.path);
      return {
        ...record,
        loaded: Boolean(extension),
        permissions: permissionsFromManifest(manifest),
        manifestVersion:
          typeof manifest?.manifest_version === "number" ? manifest.manifest_version : null,
        loadError: this.loadErrors.get(record.id) ?? null
      };
    });
  }

  async addFromFolder(): Promise<ExtensionInfo[]> {
    if (!this.options.getSettings().extensionsEnabled) {
      throw new Error("Extensions are disabled in Xuvon settings.");
    }
    const parent = this.options.getWindow();
    const result = parent
      ? await dialog.showOpenDialog(parent, {
          title: "Select an unpacked Chromium extension folder",
          properties: ["openDirectory"]
        })
      : await dialog.showOpenDialog({
          title: "Select an unpacked Chromium extension folder",
          properties: ["openDirectory"]
        });
    if (result.canceled || !result.filePaths[0]) return this.list();

    const directory = result.filePaths[0];
    const manifestPath = path.join(directory, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      throw new Error("That folder does not contain a manifest.json file.");
    }
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`The extension manifest is not valid JSON: ${errorMessage(error)}`);
    }
    if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
      throw new Error("The extension manifest is missing a name or version.");
    }
    const permissions = permissionsFromManifest(manifest);
    const confirm = parent
      ? await dialog.showMessageBox(parent, {
          type: "warning",
          title: "Add unpacked extension?",
          message: `${manifest.name} ${manifest.version}`,
          detail: [
            "Unpacked extensions run with access to the sites and APIs they request. Xuvon cannot verify or sandbox extension code beyond Chromium's own extension process.",
            permissions.length
              ? `Requested permissions: ${permissions.join(", ")}`
              : "This extension declares no explicit permissions.",
            "Chrome Web Store installation and full Chrome API compatibility are not available in this build."
          ].join("\n\n"),
          buttons: ["Cancel", "Add extension"],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        })
      : { response: 1 };
    if (confirm.response !== 1) return this.list();

    let extension: Extension;
    try {
      extension = await loadExtension(this.options.session(), directory);
    } catch (error) {
      throw new Error(`Chromium refused to load the extension: ${errorMessage(error)}`);
    }
    await this.options.api.addExtension({
      id: extension.id,
      name: extension.name || String(manifest.name),
      version: extension.version || String(manifest.version),
      path: extension.path || directory,
      enabled: true
    });
    this.loadErrors.delete(extension.id);
    return this.list();
  }

  async setEnabled(id: string, enabled: boolean): Promise<ExtensionInfo[]> {
    const records = await this.options.api.listExtensions();
    const record = records.find((entry) => entry.id === id);
    if (!record) throw new Error("Extension not found.");
    if (enabled) {
      if (!this.options.getSettings().extensionsEnabled) {
        throw new Error("Extensions are disabled in Xuvon settings.");
      }
      try {
        await this.loadPath(record.path);
        this.loadErrors.delete(id);
      } catch (error) {
        this.loadErrors.set(id, errorMessage(error));
        throw error;
      }
    } else {
      removeExtension(this.options.session(), id);
      this.loadErrors.delete(id);
    }
    await this.options.api.setExtensionEnabled(id, enabled);
    return this.list();
  }

  async unloadAll(): Promise<void> {
    const ses = this.options.session();
    for (const extension of getLoadedExtensions(ses)) {
      removeExtension(ses, extension.id);
    }
    this.loadErrors.clear();
  }

  async remove(id: string): Promise<ExtensionInfo[]> {
    const parent = this.options.getWindow();
    const result = parent
      ? await dialog.showMessageBox(parent, {
          type: "warning",
          title: "Remove extension?",
          message: "Remove this extension from Xuvon?",
          detail: "Its local folder will not be deleted. You can add it again later.",
          buttons: ["Cancel", "Remove"],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        })
      : { response: 1 };
    if (result.response !== 1) return this.list();
    removeExtension(this.options.session(), id);
    this.loadErrors.delete(id);
    await this.options.api.removeExtension(id);
    return this.list();
  }

  private async loadPath(directory: string): Promise<Extension> {
    if (!fs.existsSync(path.join(directory, "manifest.json"))) {
      throw new Error("The extension folder no longer contains manifest.json.");
    }
    return loadExtension(this.options.session(), directory);
  }
}

function loadExtension(ses: Session, directory: string): Promise<Extension> {
  const nextApi = (ses as unknown as { extensions?: { loadExtension?: (p: string, o: { allowFileAccess: boolean }) => Promise<Extension> } }).extensions;
  if (nextApi?.loadExtension) {
    return nextApi.loadExtension(directory, { allowFileAccess: false });
  }
  return ses.loadExtension(directory, { allowFileAccess: false });
}

function removeExtension(ses: Session, id: string): void {
  const nextApi = (ses as unknown as { extensions?: { removeExtension?: (id: string) => void } }).extensions;
  if (nextApi?.removeExtension) {
    nextApi.removeExtension(id);
    return;
  }
  ses.removeExtension(id);
}

function getLoadedExtensions(ses: Session): Extension[] {
  const nextApi = (ses as unknown as { extensions?: { getAllExtensions?: () => Extension[] } }).extensions;
  if (nextApi?.getAllExtensions) return nextApi.getAllExtensions();
  return ses.getAllExtensions();
}

function readManifest(directory: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function permissionsFromManifest(manifest: Record<string, unknown> | null): string[] {
  if (!manifest) return [];
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const hostPermissions = Array.isArray(manifest.host_permissions)
    ? manifest.host_permissions
    : [];
  return [...permissions, ...hostPermissions]
    .filter((value): value is string => typeof value === "string")
    .slice(0, 40);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
