# Xuvon Browser (旭文瀏覽器)

A minimalist, privacy-focused Chromium browser with a Rust application core and a
React surface, built by one person. No account, no telemetry, no sync — settings,
bookmarks, history, downloads, and the workspace live in a local SQLite database
owned by the Rust core.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Xuvon Browser.app                                                     │
│                                                                       │
│  ┌─────────────────────────┐        ┌──────────────────────────────┐  │
│  │ Electron main process   │ stdio  │ xuvon-core (Rust)            │  │
│  │ • Chromium (rendering)  │◄──────►│ • policy & validation        │  │
│  │ • WebContentsView tabs  │ JSON-  │ • SQLite persistence         │  │
│  │ • sessions & proxies    │ RPC    │ • URL/search resolution      │  │
│  │ • downloads/extensions  │ 2.0    │ • onion & proxy policy       │  │
│  └───────────┬─────────────┘        └──────────────────────────────┘  │
│              │ typed IPC (contextIsolation, sandbox)                  │
│  ┌───────────▼─────────────┐                                           │
│  │ React + TypeScript UI   │  chrome, internal pages, settings         │
│  └─────────────────────────┘                                           │
└──────────────────────────────────────────────────────────────────────┘
```

**Chromium renders. Rust decides.** Electron supplies the Chromium engine and
its sandbox; the Rust core is the authority for navigation resolution, settings,
persistence, and privacy policy. Neither is claimed to be the other, and the
renderer never gets direct Node or shell access.

> **Made with AI.** Xuvon is completely vibecoded: the design, Rust core,
> Electron host, React interface, tests, and documentation were produced through
> AI assistance, directed and reviewed by Seb. See the About page for the same
> disclosure in the app.

## Feature status

| Area | Status |
| --- | --- |
| Tabs, private tabs, Tor tabs | Working (Chromium `WebContentsView`) |
| Navigation + address bar | Working (Rust URL/search resolution) |
| Search providers (DuckDuckGo, Google, Brave, Kagi, Startpage) | Working |
| Bookmarks, history, downloads, top sites | Working (SQLite via Rust) |
| Settings, themes, startup behaviour | Working, persisted atomically |
| Ad & tracker blocking | Working: precompiled Xuvon network-rule engine, ABP-syntax subset, per-tab shield, per-site pauses (no cosmetic filtering) |
| First-run onboarding + browser import | Working: Chromium, Firefox, Safari and bookmarks-HTML parsers; bookmark + homepage/startup subset only |
| Accent themes + custom wallpapers | Working: 6 presets + custom color, 4 preset wallpapers + local images |
| Cookie policy, HTTPS handling, permissions | Working (session-level) |
| Tor clear-web routing | Implemented, fail-closed; verified without a live daemon only |
| `.onion` blocking | Working, blocked before DNS in every mode |
| DevTools | Working (Development settings + View menu) |
| Extensions | Unpacked Chromium extensions only; no Chrome Web Store, no CRX |
| Auto-update | Not implemented (see [docs/packaging.md](docs/packaging.md)) |
| macOS | Built, packaged, and tested on this machine |
| Windows | Configured, **not built or tested** |
| Linux | Configured, **not built or tested** |

## Quick start

Requirements: Node 20+, Rust (stable), and on macOS the Xcode command line tools.

```bash
npm install
npm run dev        # builds the Rust core, starts Vite + Electron
```

Useful commands:

```bash
npm run build:core          # debug Rust core
npm run build:core:release  # optimized Rust core used by packages
npm run typecheck           # renderer + host TypeScript
npm test                    # Rust tests + Playwright end-to-end tests
npm run icons               # regenerate build/icon.png from code
npm run package:dir         # unpacked app in release/
npm run package             # dmg + zip (macOS)
```

## Verification

- `cargo test`: 53 unit tests (`core/`).
- `playwright test`: 42 tests covering boot, tabs, private isolation,
  navigation, history, error pages, onion blocking, bookmarks, downloads,
  settings persistence, cookie policy, Tor fail-closed behaviour, synthetic
  adblock rule matching, real ad/tracker request blocking and exceptions,
  onboarding and browser-data import, accent themes, wallpapers, and the
  packaged app booting with its bundled core.

See [docs/verification.md](docs/verification.md) for exactly what has and has
not been exercised. Windows and Linux are configured but unverified until they
are built and tested on those platforms.

## Honest limitations

- **Ad blocking is a small rule engine, not EasyList or uBlock Origin.** Xuvon
  compiles an original MIT-licensed rule set once and enforces it in Chromium's
  `onBeforeRequest`. It supports a documented subset of Adblock Plus network
  syntax: host/path/wildcard patterns, edge anchors, resource types,
  `$domain=` scoping, first-/third-party conditions, and `@@` exceptions. It
  does not support cosmetic filters, scriptlets, regex rules, advanced options,
  custom rules, or automatic list updates. No third-party filter list is
  bundled; EasyList and uBlock Origin compatibility is not claimed. Unlisted
  networks and empty ad slots can remain. Per-site pauses and a global toggle
  are available in the shield.
- **Wallpapers are local files.** Custom images are copied into
  `<data-dir>/wallpapers/` and served through a private `xuvon-asset:` protocol;
  nothing is uploaded. Native image-picker dialogs are not automated in tests.
- **Browser import is deliberately narrow.** Xuvon reads bookmarks and only a
  portable homepage/startup pair. Passwords, cookies, history, extensions, open
  tabs, and search-engine settings are never imported. Chromium, Firefox, Safari
  and HTML parsers are tested with fixtures; profile auto-detection is tested
  against a synthetic macOS home. Live Firefox and Safari profiles were not
  available. Safari files are protected by macOS TCC, so the onboarding import
  screen has an Allow disk access button that opens the Full Disk Access pane;
  macOS requires the user to enable Xuvon there and does not let the app grant
  the permission itself.
- **Tor mode routes clear-web traffic** through a SOCKS proxy and refuses to
  start unless `check.torproject.org` confirms `IsTor === true`. It does not
  serve `.onion` hidden services; those are always blocked.
- **Extensions** load only as unpacked directories into the normal profile.
  Private and Tor sessions never load extensions. Chrome Web Store installation
  is not supported by Electron's extension surface.
- **One window.** `Cmd+N`/new-window is intentionally not implemented; new tabs
  are used instead so tab policy and resource management stay in one place.
- **No auto-update.** Packages are unsigned in this repository; update and
  notarization steps are documented for the maintainer.

## Documentation

- [Architecture](docs/architecture.md) — process boundaries, security model, data flow.
- [Ad blocking](docs/adblock.md) — supported rule syntax, precedence, limits, attribution, and update process.
- [Packaging](docs/packaging.md) — builds per platform, signing, updates, licensing.
- [Verification](docs/verification.md) — tested behaviour and test strategy.

## License

MIT © 2026 Seb. Xuvon bundles Electron and Chromium; the built-in adblock rules
are also original MIT-licensed Xuvon data. No third-party filter list is bundled.
See [Licensing and third-party notices](docs/packaging.md#licensing-and-third-party-notices).

Made with love by Seb &lt;3
