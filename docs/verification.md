# Verification

What has actually been executed, and what has not.

## Environment

- macOS 27.2 (build 26B5086k), Apple Silicon (arm64).
- Node 26.12.0, Rust stable, Electron 44.9.0 (Chromium 152.0.7977.167).
- Windows and Linux were **not** available for building or running.

## Rust core — `cargo test`

`53 passed; 0 failed` across `core/`:

- JSON-RPC framing, method routing, protocol handshake, and error shapes.
- URL vs. search resolution, provider selection, default-port handling.
- `.onion` blocking and proxy-address validation.
- Settings load/patch/reset, atomic writes, corrupt-file recovery, range checks.
- Ad blocking allowlist normalization and validation, accent-theme/color rules,
  custom-wallpaper filename rules.
- Onboarding flag persistence through `meta`, import preview/commit RPCs.
- Chromium bookmarks/Preferences, Firefox `places.sqlite`/`prefs.js`, Safari
  binary plist, and Netscape HTML parsing; folder paths, entity decoding,
  duplicate/invalid URL handling, and transactional import.
- Bookmarks (create/list/find/update/delete, folders, dedup by URL).
- History (insert/visit-count, list/paging, title update, delete, top sites).
- Downloads metadata CRUD and clear-finished.
- Extensions registry and workspace save/restore.

## End-to-end — `playwright test`

42 tests across 12 files. Electron tests launch a real app with an isolated
`XUVON_DATA_DIR` and a local HTTP server; the rule-engine tests run
deterministically in Node against the same compiled module:

| File | Coverage |
| --- | --- |
| `smoke.spec.ts` | Boot to new tab, every internal page renders (`settings`, `history`, `bookmarks`, `downloads`, `about`), theme switching updates the document and persists |
| `tabs.spec.ts` | Create/activate/close/reopen tabs, private-tab isolation and cleanup, Tor tabs rejected while disabled |
| `navigation.spec.ts` | Address-bar navigation records exactly one history visit, connection-refused error page with full host:port, `.onion` rejected before networking |
| `bookmarks.spec.ts` | Core CRUD, Bookmarks page renders the card, toolbar star toggles, private tabs cannot bookmark |
| `downloads.spec.ts` | Real Chromium download to the configured folder, record completes (not stuck active), file contents correct, Downloads page renders it, clear-finished works |
| `settings.spec.ts` | Settings survive an app restart, invalid providers/themes rejected, session-only cookie policy downgrades `Max-Age` cookies to session cookies |
| `adblock-rules.spec.ts` | Synthetic rule compilation and precedence: host/path/anchor/wildcard matching, `$document` gating, exceptions, resource types and aliases, first-/third-party, `$domain=` include/exclude, per-site bypass, malformed and unsupported rules, and shipped-list counts |
| `adblock.spec.ts` | Real requests blocked before the server sees them, subresource-only patterns do not block a matching document URL, per-tab counts and shield panel layout, per-site pause via the shield allows requests after reload, global toggle allows requests, and the Privacy disclosure exposes supported syntax, unsupported syntax, limits, list ownership, and version |
| `onboarding.spec.ts` | First-run welcome, native-folder stubbed profile import of bookmarks plus homepage/startup, result summary, completion persistence across restart, reopen from Settings, HTML file import, Chrome-profile auto-detection against a synthetic macOS `HOME`, and the macOS Full Disk Access settings hand-off |
| `appearance.spec.ts` | Preset/custom accent themes apply and reject invalid colors, preset wallpapers render, custom images are imported through a stubbed picker dialog, served/loaded through `xuvon-asset:`, and deleted on removal; invalid wallpaper paths are rejected, appearance controls render, AI disclosure is present |
| `tor.spec.ts` | Fails closed without a Tor daemon, circuit check reports unavailable, no pretend proxying |
| `packaged.spec.ts` | Packaged `.app` boots with the bundled Rust sidecar (`resourcesPath/bin/xuvon-core`) |

Run them with:

```bash
npm run test:core    # Rust
npm run test:e2e     # builds, then Playwright
npm run package:dir && npx playwright test tests/packaged.spec.ts
```

## Manual UI verification

Screenshots of the new-tab page (with and without preset wallpapers), settings,
history, bookmarks, downloads, about page, and all three onboarding states were
captured from a real window at the default 1320×860 window size (retina, scaled
to the available display) during development in both dark and light system
themes. Address-bar focus, tab drag/reorder, context menus, find bar, DevTools,
notification shelf, the ad-blocking shield side panel, the Privacy settings
rule-syntax/list disclosure (expanded and collapsed), accent swatches, preset
wallpaper rendering, browser import review/settings choice, and the library panel
were exercised by hand. A packaged-app smoke run also confirmed that the bundle
loaded 190 rules with zero rejected rules, blocked the local `/pagead/` script and
`/pixel.gif` before the test server saw them, loaded the page's normal script, and
updated the per-tab blocked count to 2.

## Not verified (do not claim otherwise)

- Windows and Linux builds (no installers produced or run).
- Live Tor routing (no `tor` daemon is installed; only fail-closed and policy
  paths were tested). With Tor installed, re-run:
  `tor` then enable Tor mode in Settings; the check must report
  `IsTor === true` and the exit IP must match a Tor relay.
- Real onion services (intentionally unsupported).
- Extension loading from the Chrome Web Store / `.crx` (unsupported by the
  Electron surface Xuvon targets).
- Code signing, notarization, and auto-update (no certificates or feed).
- Download-folder picker, native save dialog, and dangerous-file confirmation
  are covered by code but not by automated tests (they require native dialogs);
  `XUVON_E2E=1` bypasses confirmations for destructive actions.
- The native wallpaper and browser-import dialog UI itself is not automated; the
  tests stub `showOpenDialog` and exercise the real discovery, parsing,
  validation, persistence, and settings application around it.
- Live Firefox and Safari profiles were not available. Firefox `places.sqlite`
  and Safari `Bookmarks.plist`/preferences parsing is unit-tested with generated
  fixtures, including a Firefox lock fallback path by code inspection, not against
  a running browser. Safari's macOS TCC permission path is surfaced in the UI, and
  the Full Disk Access button is tested with the OS hand-off stubbed; an actual
  TCC-denied read and a real System Settings toggle were not reproduced in
  automation.
- Browser-profile auto-detection was tested against a synthetic macOS home for
  Chrome only. Windows/Linux profile roots are implemented but unverified.
- Full EasyList/EasyPrivacy or uBlock Origin compatibility, cosmetic element
  hiding, scriptlets, regex filters, advanced ABP options, custom rules, and
  automatic list updates are not implemented. Tests exercise the documented
  subset and the original bundled rules only; no third-party list is bundled.
- Adblock rule matching is exercised in normal browsing. The same hook is
  installed in private and Tor sessions, but live Tor request blocking was not
  exercised because no Tor daemon is available.

## Test strategy notes

- Website `WebContentsView`s are outside the React renderer, so tests inspect
  host state through `electronApp.evaluate` (sessions, cookies) and renderer
  state through `window.xuvon.bootstrap()`. The ad-blocking test also compares
  the native tab-view bounds with the shield panel bounds, so an HTML overlay
  that could be covered by Chromium cannot regress silently.
- Destructive actions (clear data, enabling/disabling Tor) ask for native
  confirmation outside E2E; `XUVON_E2E=1` auto-confirms and disables the
  single-instance lock so tests can run in sequence.
- Every test gets a fresh temporary data directory; core state never leaks
  between tests. Onboarding auto-completes through the real IPC/core path for
  browser-focused tests, while onboarding tests opt out and keep the welcome page.
- The default launcher sets `XUVON_DETECT_BROWSERS=0`; only the synthetic-home
  detection test enables profile scanning, so no real browser data is read.
