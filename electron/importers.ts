import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BrowserImportSource } from "../shared/types";
import { log } from "./logger";

const MAX_SCANNED_DIRECTORIES = 80;
const MAX_SOURCES = 100;

interface ChromiumBrowser {
  name: string;
  roots: string[];
}

type Component =
  | "chromium-bookmarks"
  | "chromium-settings"
  | "firefox-bookmarks"
  | "firefox-settings"
  | "safari-bookmarks"
  | "safari-settings"
  | "html-bookmarks";

function chromiumBrowsers(): ChromiumBrowser[] {
  const home = os.homedir();
  if (process.platform === "darwin") {
    const support = path.join(home, "Library", "Application Support");
    return [
      { name: "Google Chrome", roots: [path.join(support, "Google", "Chrome")] },
      {
        name: "Google Chrome Beta",
        roots: [path.join(support, "Google", "Chrome Beta")]
      },
      {
        name: "Google Chrome Canary",
        roots: [path.join(support, "Google", "Chrome Canary")]
      },
      { name: "Chromium", roots: [path.join(support, "Chromium")] },
      {
        name: "Brave",
        roots: [path.join(support, "BraveSoftware", "Brave-Browser")]
      },
      { name: "Microsoft Edge", roots: [path.join(support, "Microsoft Edge")] },
      { name: "Vivaldi", roots: [path.join(support, "Vivaldi")] },
      {
        name: "Opera",
        roots: [path.join(support, "com.operasoftware.Opera")]
      }
    ];
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    const roaming = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return [
      { name: "Google Chrome", roots: [path.join(local, "Google", "Chrome", "User Data")] },
      {
        name: "Google Chrome Beta",
        roots: [path.join(local, "Google", "Chrome Beta", "User Data")]
      },
      {
        name: "Google Chrome Canary",
        roots: [path.join(local, "Google", "Chrome SxS", "User Data")]
      },
      { name: "Chromium", roots: [path.join(local, "Chromium", "User Data")] },
      {
        name: "Brave",
        roots: [path.join(local, "BraveSoftware", "Brave-Browser", "User Data")]
      },
      {
        name: "Microsoft Edge",
        roots: [path.join(local, "Microsoft", "Edge", "User Data")]
      },
      { name: "Vivaldi", roots: [path.join(local, "Vivaldi", "User Data")] },
      {
        name: "Opera",
        roots: [path.join(roaming, "Opera Software", "Opera Stable")]
      }
    ];
  }
  const config = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
  return [
    { name: "Google Chrome", roots: [path.join(config, "google-chrome")] },
    { name: "Google Chrome Beta", roots: [path.join(config, "google-chrome-beta")] },
    {
      name: "Google Chrome Canary",
      roots: [path.join(config, "google-chrome-unstable")]
    },
    { name: "Chromium", roots: [path.join(config, "chromium")] },
    {
      name: "Brave",
      roots: [path.join(config, "BraveSoftware", "Brave-Browser")]
    },
    { name: "Microsoft Edge", roots: [path.join(config, "microsoft-edge")] },
    { name: "Vivaldi", roots: [path.join(config, "vivaldi")] },
    { name: "Opera", roots: [path.join(config, "opera")] }
  ];
}

function firefoxRoots(): string[] {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return [path.join(home, "Library", "Application Support", "Firefox", "Profiles")];
  }
  if (process.platform === "win32") {
    const roaming = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return [path.join(roaming, "Mozilla", "Firefox", "Profiles")];
  }
  return [path.join(home, ".mozilla", "firefox")];
}

function safariPaths(): { bookmarks: string; settings: string } {
  const home = os.homedir();
  return {
    bookmarks: path.join(home, "Library", "Safari", "Bookmarks.plist"),
    settings: path.join(home, "Library", "Preferences", "com.apple.Safari.plist")
  };
}

async function statPath(target: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.stat(target);
  } catch {
    return null;
  }
}

async function fileExists(target: string): Promise<boolean> {
  const stats = await statPath(target);
  return Boolean(stats?.isFile());
}

async function directoryExists(target: string): Promise<boolean> {
  const stats = await statPath(target);
  return Boolean(stats?.isDirectory());
}

async function readJsonFile<T>(target: string): Promise<T | null> {
  try {
    const raw = await fs.promises.readFile(target, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function source(
  browser: string,
  profile: string,
  bookmarksPath: string | null,
  settingsPath: string | null,
  origin: BrowserImportSource["origin"]
): BrowserImportSource {
  return {
    id: randomUUID(),
    browser,
    profile,
    label: profile ? `${browser} · ${profile}` : browser,
    bookmarksPath,
    settingsPath,
    origin
  };
}

async function chromiumProfileSources(
  root: string,
  browser: string
): Promise<BrowserImportSource[]> {
  if (!(await directoryExists(root))) return [];
  const sources: BrowserImportSource[] = [];
  const state = await readJsonFile<{
    profile?: { info_cache?: Record<string, { name?: string }> };
  }>(path.join(root, "Local State"));
  const names = state?.profile?.info_cache ?? {};

  const rootBookmarks = path.join(root, "Bookmarks");
  const rootSettings = path.join(root, "Preferences");
  const hasRootBookmarks = await fileExists(rootBookmarks);
  const hasRootSettings = await fileExists(rootSettings);
  if (hasRootBookmarks || hasRootSettings) {
    sources.push(
      source(
        browser,
        "Default",
        hasRootBookmarks ? rootBookmarks : null,
        hasRootSettings ? rootSettings : null,
        "detected"
      )
    );
  }

  const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
  const profileDirectories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter(
      (name) =>
        name !== "Guest Profile" &&
        name !== "System Profile" &&
        name !== "Crashpad" &&
        name !== "ShaderCache" &&
        name !== "GrShaderCache"
    )
    .slice(0, MAX_SCANNED_DIRECTORIES);

  for (const name of profileDirectories) {
    const profileRoot = path.join(root, name);
    const bookmarks = path.join(profileRoot, "Bookmarks");
    const settings = path.join(profileRoot, "Preferences");
    const hasBookmarks = await fileExists(bookmarks);
    const hasSettings = await fileExists(settings);
    if (!hasBookmarks && !hasSettings) continue;
    const displayName =
      names[name]?.name?.trim() ||
      (name === "Default" ? "Default" : name.replace(/_/g, " "));
    sources.push(
      source(
        browser,
        displayName,
        hasBookmarks ? bookmarks : null,
        hasSettings ? settings : null,
        "detected"
      )
    );
  }
  return sources;
}

function parseFirefoxProfileNames(
  ini: string,
  baseDirectory: string
): Map<string, string> {
  const names = new Map<string, string>();
  let pendingName: string | null = null;
  let pendingPath: string | null = null;
  const flush = () => {
    if (pendingName && pendingPath) {
      const resolved = path.isAbsolute(pendingPath)
        ? path.normalize(pendingPath)
        : path.normalize(path.join(baseDirectory, pendingPath));
      names.set(resolved, pendingName);
    }
    pendingName = null;
    pendingPath = null;
  };
  for (const rawLine of ini.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      flush();
      continue;
    }
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === "Name") pendingName = value;
    if (key === "Path") pendingPath = value;
  }
  flush();
  return names;
}

async function firefoxProfileSources(root: string): Promise<BrowserImportSource[]> {
  if (!(await directoryExists(root))) return [];
  const sources: BrowserImportSource[] = [];
  // macOS/Windows keep profiles.ini beside Profiles/; Firefox on Linux keeps it
  // inside the profile root.
  const iniPath = [path.join(path.dirname(root), "profiles.ini"), path.join(root, "profiles.ini")];
  let ini: string | null = null;
  let iniDirectory = path.dirname(root);
  for (const candidate of iniPath) {
    const raw = await fs.promises.readFile(candidate, "utf8").catch(() => null);
    if (raw) {
      ini = raw;
      iniDirectory = path.dirname(candidate);
      break;
    }
  }
  const names = ini
    ? parseFirefoxProfileNames(ini, iniDirectory)
    : new Map<string, string>();
  const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);

  for (const entry of entries.filter((item) => item.isDirectory()).slice(0, MAX_SCANNED_DIRECTORIES)) {
    const profileRoot = path.join(root, entry.name);
    const bookmarks = path.join(profileRoot, "places.sqlite");
    const settings = path.join(profileRoot, "prefs.js");
    const hasBookmarks = await fileExists(bookmarks);
    const hasSettings = await fileExists(settings);
    if (!hasBookmarks && !hasSettings) continue;
    const configured = names.get(path.normalize(profileRoot));
    const fallback = entry.name.replace(/\.(default|default-release|default-esr).*$/i, "");
    sources.push(
      source(
        "Firefox",
        configured || fallback || "Default",
        hasBookmarks ? bookmarks : null,
        hasSettings ? settings : null,
        "detected"
      )
    );
  }
  return sources;
}

function dedupe(sources: BrowserImportSource[]): BrowserImportSource[] {
  const seen = new Set<string>();
  const output: BrowserImportSource[] = [];
  for (const item of sources) {
    const key = `${item.bookmarksPath ?? ""}\u0000${item.settingsPath ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
    if (output.length >= MAX_SOURCES) break;
  }
  return output;
}

/** Scan common browser locations without touching passwords, cookies, or history. */
export async function detectBrowserSources(): Promise<BrowserImportSource[]> {
  // End-to-end runs must never read the developer's real browser profiles.
  // Uploaded-profile tests still exercise the real file discovery path.
  if (process.env.XUVON_DETECT_BROWSERS === "0") return [];

  const detected: BrowserImportSource[] = [];

  for (const browser of chromiumBrowsers()) {
    for (const root of browser.roots) {
      try {
        detected.push(...(await chromiumProfileSources(root, browser.name)));
      } catch (error) {
        log("warn", "could not scan Chromium profile root", {
          root,
          message: String(error)
        });
      }
    }
  }

  for (const root of firefoxRoots()) {
    try {
      detected.push(...(await firefoxProfileSources(root)));
    } catch (error) {
      log("warn", "could not scan Firefox profile root", {
        root,
        message: String(error)
      });
    }
  }

  if (process.platform === "darwin") {
    const safari = safariPaths();
    const bookmarks = (await fileExists(safari.bookmarks)) ? safari.bookmarks : null;
    const settings = (await fileExists(safari.settings)) ? safari.settings : null;
    if (bookmarks || settings) {
      detected.push(source("Safari", "Default", bookmarks, settings, "detected"));
    }
  }

  return dedupe(detected);
}

function inferBrowser(target: string): string {
  const value = target.toLowerCase();
  if (value.includes("brave")) return "Brave";
  if (value.includes("microsoft edge") || value.includes("microsoft-edge")) {
    return "Microsoft Edge";
  }
  if (value.includes("vivaldi")) return "Vivaldi";
  if (value.includes("opera")) return "Opera";
  if (value.includes("chromium")) return "Chromium";
  if (
    value.includes("google/chrome") ||
    value.includes("google\\chrome") ||
    value.includes("google-chrome") ||
    /(^|[/\\])chrome([/\\]|$)/.test(value)
  ) {
    return "Google Chrome";
  }
  if (value.includes("firefox") || value.includes("mozilla")) return "Firefox";
  if (value.includes("safari")) return "Safari";
  return "Browser data";
}

function profileLabelFor(target: string): string {
  const base = path.basename(target);
  if (base === "Default" || base === "default") return "Default";
  return base.replace(/\.default(-release|-esr)?$/i, "") || "Default";
}

async function sniffComponent(file: string): Promise<Component | null> {
  const name = path.basename(file).toLowerCase();
  const extension = path.extname(file).toLowerCase();

  if (name === "places.sqlite" || /\.(sqlite|sqlite3|db)$/.test(name)) {
    return "firefox-bookmarks";
  }
  if (name === "prefs.js") return "firefox-settings";
  if (name === "preferences") return "chromium-settings";
  if (name === "bookmarks") return "chromium-bookmarks";
  if (name === "bookmarks.plist") return "safari-bookmarks";
  if (name === "com.apple.safari.plist") return "safari-settings";
  if (extension === "html" || extension === "htm" || extension === "xhtml") {
    return "html-bookmarks";
  }

  const stats = await statPath(file);
  if (!stats?.isFile() || stats.size > 12 * 1024 * 1024) return null;
  const raw = await fs.promises.readFile(file).catch(() => null);
  if (!raw) return null;

  if (extension === "json") {
    try {
      const value = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
      if (value.roots && typeof value.roots === "object") return "chromium-bookmarks";
      if (
        "homepage" in value ||
        "homepage_is_newtabpage" in value ||
        "session" in value ||
        "profile" in value
      ) {
        return "chromium-settings";
      }
    } catch {
      return null;
    }
    return null;
  }

  if (extension === "plist" || raw.subarray(0, 8).toString("latin1") === "bplist00") {
    const text = raw.toString("latin1");
    if (text.includes("WebBookmarkType") || text.includes("URLString")) {
      return "safari-bookmarks";
    }
    if (text.includes("HomePage") || text.includes("Safari")) {
      return "safari-settings";
    }
    return "safari-bookmarks";
  }
  if (raw.subarray(0, 16).toString("latin1").startsWith("SQLite format 3")) {
    return "firefox-bookmarks";
  }
  const text = raw.subarray(0, 8192).toString("utf8").toLowerCase();
  if (text.includes("user_pref(")) return "firefox-settings";
  if (text.includes("<dl") || text.includes("<!doctype netscape") || text.includes("<a ")) {
    return "html-bookmarks";
  }
  if (text.trimStart().startsWith("{")) {
    if (text.includes('"roots"')) return "chromium-bookmarks";
    if (
      text.includes('"homepage"') ||
      text.includes('"homepage_is_newtabpage"') ||
      text.includes('"session"')
    ) {
      return "chromium-settings";
    }
  }
  return null;
}

async function siblingFor(file: string, component: Component): Promise<string | null> {
  const directory = path.dirname(file);
  if (component === "chromium-bookmarks") {
    const preferences = path.join(directory, "Preferences");
    return (await fileExists(preferences)) ? preferences : null;
  }
  if (component === "chromium-settings") {
    const bookmarks = path.join(directory, "Bookmarks");
    return (await fileExists(bookmarks)) ? bookmarks : null;
  }
  if (component === "firefox-bookmarks") {
    const prefs = path.join(directory, "prefs.js");
    return (await fileExists(prefs)) ? prefs : null;
  }
  if (component === "firefox-settings") {
    const places = path.join(directory, "places.sqlite");
    return (await fileExists(places)) ? places : null;
  }
  if (process.platform === "darwin") {
    const safari = safariPaths();
    if (component === "safari-bookmarks") {
      return (await fileExists(safari.settings)) ? safari.settings : null;
    }
    if (component === "safari-settings") {
      return (await fileExists(safari.bookmarks)) ? safari.bookmarks : null;
    }
  }
  return null;
}

function specificFileIn(directory: string, names: string[]): string | null {
  for (const name of names) {
    const candidate = path.join(directory, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function sourceForDirectory(
  directory: string,
  origin: BrowserImportSource["origin"]
): Promise<BrowserImportSource | null> {
  const chromiumBookmarks = specificFileIn(directory, ["Bookmarks"]);
  const chromiumSettings = specificFileIn(directory, ["Preferences"]);
  const firefoxBookmarks = specificFileIn(directory, ["places.sqlite"]);
  const firefoxSettings = specificFileIn(directory, ["prefs.js"]);
  const safariBookmarks = specificFileIn(directory, ["Bookmarks.plist"]);
  const htmlBookmarks = specificFileIn(directory, ["bookmarks.html", "Bookmarks.html"]);

  const bookmarks =
    chromiumBookmarks ?? firefoxBookmarks ?? safariBookmarks ?? htmlBookmarks ?? null;
  const settings = chromiumSettings ?? firefoxSettings ?? null;
  if (!bookmarks && !settings) return null;

  const browser =
    chromiumBookmarks || chromiumSettings
      ? inferBrowser(directory) === "Browser data"
        ? "Chromium-format browser"
        : inferBrowser(directory)
      : firefoxBookmarks || firefoxSettings
        ? "Firefox"
        : safariBookmarks
          ? "Safari"
          : inferBrowser(directory);
  return source(
    browser,
    profileLabelFor(directory),
    bookmarks,
    settings,
    origin
  );
}

async function scanDirectory(
  directory: string,
  origin: BrowserImportSource["origin"],
  depth: number
): Promise<BrowserImportSource[]> {
  const direct = await sourceForDirectory(directory, origin);
  if (direct) return [direct];
  if (depth > 1) return [];
  const entries = await fs.promises.readdir(directory, { withFileTypes: true }).catch(() => []);
  const sources: BrowserImportSource[] = [];
  for (const entry of entries.filter((item) => item.isDirectory()).slice(0, MAX_SCANNED_DIRECTORIES)) {
    const child = path.join(directory, entry.name);
    const found = await scanDirectory(child, origin, depth + 1);
    sources.push(...found);
    if (sources.length >= MAX_SOURCES) break;
  }
  return sources;
}

/** Build sources from a file or folder chosen in the native dialog. */
export async function sourcesFromPath(
  chosenPath: string,
  origin: "file" | "folder"
): Promise<BrowserImportSource[]> {
  const stats = await statPath(chosenPath);
  if (!stats) throw new Error("That browser data location could not be read.");

  if (stats.isDirectory()) {
    const sources = await scanDirectory(chosenPath, "folder", 0);
    if (sources.length === 0) {
      throw new Error(
        "No supported bookmarks or settings files were found in that folder. Choose a browser profile folder or a bookmarks file instead."
      );
    }
    return dedupe(sources);
  }

  if (!stats.isFile()) {
    throw new Error("Choose a browser bookmarks or settings file.");
  }

  const component = await sniffComponent(chosenPath);
  if (!component) {
    throw new Error(
      "Xuvon could not recognize that file. Choose a Chromium Bookmarks file, Firefox places.sqlite, Safari Bookmarks.plist, a bookmarks HTML export, Chromium Preferences, or a Firefox prefs.js file."
    );
  }

  const isBookmarks = component.endsWith("bookmarks");
  const sibling = await siblingFor(chosenPath, component);
  const browser = inferBrowser(chosenPath);
  const fileLabel = path.basename(chosenPath);
  return [
    source(
      browser === "Browser data" ? "Browser data" : browser,
      fileLabel || "Imported file",
      isBookmarks ? chosenPath : (sibling?.endsWith("Bookmarks") || sibling?.endsWith("places.sqlite") || sibling?.endsWith("Bookmarks.plist") ? sibling : null),
      isBookmarks ? (sibling?.endsWith("Preferences") || sibling?.endsWith("prefs.js") || sibling?.endsWith(".plist") ? sibling : null) : chosenPath,
      "file"
    )
  ];
}
