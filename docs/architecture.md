# Architecture

Xuvon is three cooperating layers with strict boundaries. Chromium renders web
content; Rust owns application policy and persistence; the React renderer paints
browser chrome and internal pages. No layer impersonates another.

## Processes

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Renderer | React 19 + TypeScript + CSS | Tab strip, toolbar, address bar, library panel, internal pages (`xuvon://…`), settings UI |
| Main | Electron 44 (Chromium 152) | `WebContentsView` tabs, sessions/proxies, downloads, extensions, menus, DevTools, window |
| Core | Rust (`core/`) | Navigation resolution, settings, bookmarks, history, downloads metadata, extensions registry, workspace, proxy validation, onion policy, adblock allowlist, appearance validation, onboarding state and browser-data parsing |

The packaged app resolves the core at
`Contents/Resources/bin/xuvon-core` (development: `target/debug/xuvon-core`).
They speak newline-delimited **JSON-RPC 2.0 over stdio** with a protocol version
handshake (`core.ready`, protocol `1`). The core is a child process; if it dies
unexpectedly the window shows a boot error instead of running half-configured.

## RPC surface

`app.info`, `app.ping`, `app.shutdown`, `settings.get/update/reset`,
`navigation.resolve`, `bookmarks.*`, `history.*`, `downloads.*`,
`extensions.*`, `workspace.get/save/clear`, `tor.validateProxy`,
`onboarding.status/complete`, and `imports.preview/commit`. Requests are typed on
both sides; responses carry structured errors, and the core validates every
payload again even though the main process already validated it.

## Security model

- Renderer runs with `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, and only sees `window.xuvon` — a hand-written preload bridge.
- Every IPC handler validates the sender (`frame.url` must be the trusted app
  URL) and the payload with zod schemas.
- Website content lives in `WebContentsView` instances that never receive the
  preload; web pages cannot reach privileged APIs.
- `will-attach-webview` is cancelled, `setWindowOpenHandler` routes popups into
  managed tabs, and `will-navigate` only permits `http(s)` in web views.
- Sensitive permissions (camera, microphone, geolocation, notifications…) are
  denied by default and surfaced as a notice.
- Favicons from private and Tor tabs are suppressed before reaching the UI;
  only `data:` favicons are rendered so the chrome origin cannot leak requests.
- Custom wallpapers are copied into `<data-dir>/wallpapers/` and exposed only
  through the `xuvon-asset://wallpaper/<file>` protocol. The handler validates
  the `wallpaper-*` filename, refuses path traversal, and serves only known image
  extensions; the renderer never receives a usable filesystem path.
- The UI HTML carries a restrictive CSP (no remote scripts, no frames) and adds
  `xuvon-asset:` only to `img-src` for wallpapers.

## Sessions and isolation

| Mode | Partition | Lifetime | Extensions |
| --- | --- | --- | --- |
| Normal | `persist:xuvon-normal` | On disk | Unpacked extensions only |
| Private | `xuvon-private` | In-memory, cleared on close | Never |
| Tor | `xuvon-tor` | In-memory, cleared on close/disable | Never |
| Tor check | `xuvon-tor-check` | In-memory, fixed SOCKS5 proxy | Never |

Cookie policy is enforced in Chromium webRequest hooks: third-party blocking
drops third-party `Set-Cookie` and `Cookie` headers; session-only downgrades
persistent cookies by removing `Expires`/`Max-Age` and still drops third-party
ones. OAuth/localhost flows that need cookies keep them first-party.

## Ad and tracker blocking

The blocker runs in the main process, not in the React UI. Every browsing
session installs an `onBeforeRequest` hook after the onion check:

1. Settings are read live, so toggling the shield or adding a site exception
   takes effect on the next request without recreating a session.
2. `shared/adblock.ts` compiles the original Xuvon rules in
   `shared/adblock-rules.ts` once at module load. It supports a documented
   subset of Adblock Plus network syntax: host/path/wildcard patterns, edge
   anchors, `$document` and other resource types, `$domain=` include/exclude
   scopes, first-/third-party conditions, and `@@` exceptions.
3. Host-only rules are indexed by host suffix. Path/generic rules use compiled
   regular expressions and literal prefilters. No rule text is parsed on the
   request path, and there is no network or disk I/O in the hook. Rule data and
   the compiler stay in the Electron main process; the React UI receives only
   summary counts and version metadata through the bootstrap payload.
4. A host-only rule without type options applies to top-level documents,
   preserving Xuvon's existing behavior. Path/generic rules are subresource-only
   unless they explicitly opt in with `$document`, so a page whose own path
   contains `/pagead/` still loads as a document.
5. An allowlisted top-level site, or an allowlisted request host, bypasses the
   list before rule matching. Then exception rules win over blocking rules,
   independent of file order. Exceptions are stored in the Rust core
   (`adblockAllowlist`) as normalized host suffixes.
6. Cancelled requests are counted per tab in `TabManager`, coalesced, and pushed
   through the normal tabs snapshot. The toolbar shield opens a reserved
   right-side panel with the count, the global switch, and a per-site pause.
   The panel takes layout space beside the native tab view instead of drawing
   an HTML overlay, which Chromium's `WebContentsView` would cover.

No third-party filter list is bundled. EasyList/EasyPrivacy are dual-licensed
GPLv3+ / CC BY-SA 3.0+ and were not copied; the bundled rules are original Xuvon
data under MIT. The blocker is not an EasyList engine and does no cosmetic
filtering. See [adblock.md](adblock.md) for the exact syntax, precedence,
limits, attribution, and update process.

## Appearance: accents and wallpapers

- `accentTheme` selects one of six persisted presets (`mint`, `peach`, `sky`,
  `lilac`, `rose`, `sunset`) or `custom` with a `#rrggbb` `accentColor`. The
  renderer maps it to `data-accent` on `<html>` and derives the accent/ink
  variables; light and dark chrome use separate contrast-safe values.
- `wallpaperId` selects `none` or a built-in gradient (`aurora`, `dunes`,
  `grid`, `mist`), or `custom` with a `wallpaperPath` filename. The picker in
  Settings uses a native file dialog; the main process validates size/extension,
  copies the image into the data directory, and updates settings atomically.
- The Rust core validates accent colors and custom wallpaper filenames, and
  clears `wallpaperPath` whenever a non-custom preset is selected. The main
  process deletes the superseded file when the path changes.

## Onboarding and browser-data import

On first run, the main process reads the `onboarding.completed` flag from the
core's SQLite `meta` table. When it is unset, Xuvon reuses the initial
`xuvon://newtab` tab for `xuvon://welcome` rather than leaving a blank extra tab.
Restored sessions keep their tabs and receive a separate welcome tab. Finishing
or skipping writes the flag through the Rust core, so onboarding does not return
on every launch. The same page can be reopened from Startup settings.

The Electron main process owns filesystem discovery:

- It scans common Chrome/Chromium, Chrome Beta/Canary, Brave, Edge, Vivaldi and
  Opera profile roots, Firefox profile roots, and Safari's standard macOS files.
- Recursive folder scans are capped, profile names come from Chromium's
  `Local State` or Firefox's `profiles.ini` where available, and duplicates are
  removed by component paths.
- Native file/folder dialogs add a source manually. Files are classified by name,
  extension and a small content sniff, and known siblings (`Bookmarks` next to
  `Preferences`, `places.sqlite` next to `prefs.js`) are paired.
- `XUVON_DETECT_BROWSERS=0` disables home-directory scanning. End-to-end tests set
  this except for one synthetic-`HOME` detection test, so tests never read a
  developer's real browser profiles.

The Rust core owns parsing, validation, preview and writes:

| Input | Bookmarks | Portable settings |
| --- | --- | --- |
| Chromium | `Bookmarks` JSON | `Preferences` homepage + startup mode |
| Firefox | `places.sqlite` read-only, with a temp-copy fallback if locked | `prefs.js` |
| Safari | `Bookmarks.plist` | `com.apple.Safari.plist` homepage |
| Any browser export | Netscape bookmarks HTML | — |

Previews are read-only and return counts, folder counts, warnings and up to five
samples. Import is transactional: URLs must pass the same HTTP(S)/onion policy as
navigation, duplicates inside a source and URLs already in the library are
skipped, existing bookmarks are never rewritten, paths are capped at 10,000 items
and text files at 64 MB. Folder paths are preserved as a single truncated string.
Settings import is limited to `homepage` and `startupBehavior`; no other settings
are applied. Passwords, cookies, history, extensions, open tabs and search-engine
configuration are never read or imported. All parsing stays on-device; the core
has no network access.

Safari files may be protected by macOS TCC. On macOS, the import screen always
offers an **Allow disk access…** button that opens System Settings → Privacy &
Security → Full Disk Access. macOS does not allow an app to grant itself this
permission; the user enables Xuvon there and then chooses **Check again** in the
app (or reopens Xuvon if macOS has not refreshed the grant). The Rust parser
still rejects unreadable files honestly, and exporting bookmarks to HTML remains
an alternative. The TCC deep link is never used to claim that access was granted.

## Tor and onion policy

- Tor uses a global SOCKS5 proxy (`settings.torProxy`, default
  `socks5://127.0.0.1:9050`) applied to normal sessions.
- Enabling Tor runs a real circuit check against
  `https://check.torproject.org/api/ip`. Only `IsTor === true` marks the circuit
  available; anything else fails closed and leaves `torEnabled` off.
- Enabling converts existing normal tabs to Tor and makes new normal tabs
  late-bound to the Tor session; disabling converts them back.
- Private tabs remain “Private · direct” and are never proxied.
- `.onion` requests are blocked in `onBeforeRequest` before DNS in **every**
  mode, and the URL resolver rejects them. Xuvon does not support hidden
  services.

## Downloads

Chromium performs the transfer. The main process reserves the destination
synchronously when no save dialog is requested — a tiny or cached transfer can
otherwise finish in Chromium's default folder before the async setup — then
pauses the item, registers `updated`/`done` listeners, and only goes async for
the native save dialog. The Rust core stores metadata (url, filename, path,
size, state, danger flag); files themselves are never copied. Normal downloads
persist; private/Tor downloads live only in memory and are purged when their
session closes. Dangerous extensions are flagged and never auto-opened.

## Resource management

- Browsing happens in retained `WebContentsView` instances; the renderer
  measures the viewport and sends bounds over IPC, so HTML chrome and web
  content stay pixel-aligned.
- Background tabs can sleep: their views are destroyed and reloaded on
  activation, which releases renderer processes.
- Progress events are coalesced per animation frame; animations use
  `transform`/`opacity` only and honour `prefers-reduced-motion`.
- Heavy work (SQLite, provider resolution, proxy checks) happens in Rust or the
  main process, never on the UI thread.

## Data and recovery

The core owns `xuvon.sqlite3` (SQLite, WAL, including the onboarding flag in
`meta`), `settings.json` (atomic temp+rename), `workspace.json`, and the
`wallpapers/` folder inside the data directory
(`~/Library/Application Support/Xuvon Browser` on macOS). `XUVON_DATA_DIR`
overrides the location for tests and portable use. Schema migrations run on
startup; malformed settings fall back to defaults rather than failing the boot.

## Update and maintenance strategy

- Versioning: the core protocol carries a version integer; breaking RPC changes
  bump it and the host refuses to run against a mismatched core.
- Releases are built manually (`npm run package`) per platform. There is no
  auto-updater yet; adding `electron-updater` requires code signing and a feed,
  documented in [packaging.md](packaging.md).
- Electron majors land roughly every eight weeks. The host code isolates
  Chromium-facing behaviour in `electron/sessions.ts`, `tabs.ts`, and
  `downloads.ts` so upgrades are reviewed in three files, not across the app.
- Rust dependencies are ordinary crates pinned in `Cargo.lock`; the core has no
  async runtime and no network access, which keeps the audit surface small.
