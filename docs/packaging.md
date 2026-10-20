# Packaging, signing, and maintenance

## Prerequisites per platform

| Platform | Toolchain | Notes |
| --- | --- | --- |
| macOS | Node 20+, Rust stable, Xcode CLT | Produces `dmg` + `zip`; tested |
| Windows | Node 20+, Rust stable (MSVC), VS Build Tools | Produces NSIS installer; **unverified** |
| Linux | Node 20+, Rust stable, `fakeroot`/`dpkg` for `.deb` | Produces AppImage + deb; **unverified** |

## Build pipeline

```bash
npm run icons             # regenerate build/icon.png from an inline SVG
npm run build:core:release # cargo --release → target/release/xuvon-core[.exe]
npm run build             # typecheck, host tsc, Vite renderer → dist/
npm run package:dir       # unpacked app in release/
npm run package           # installers in release/
```

`electron-builder` copies the Rust binary into `Contents/Resources/bin/xuvon-core`
(`bin/xuvon-core.exe` on Windows) via platform-specific `extraResources`. The
`scripts/afterPack.cjs` hook fails the build if the sidecar is missing or empty
and restores the executable bit on POSIX. At runtime the packaged app resolves
`process.resourcesPath/bin/xuvon-core`; the host never searches the user's PATH.

The `.app`/installer contains only `dist/` (renderer), `dist-electron/` (host),
production `node_modules`, and the core binary. TypeScript sources and maps are
excluded by the `files` globs.

## macOS signing and notarization

Local builds are unsigned. `electron-builder` reports

```
skipped macOS application code signing reason=cannot find valid "Developer ID Application"
```

which is expected and acceptable for local use. To produce a distributable
build:

1. Install a **Developer ID Application** certificate in the login keychain.
2. Provide credentials, for example:

   ```bash
   export CSC_LINK=/path/to/cert.p12
   export CSC_KEY_PASSWORD=…
   # and for notarization
   export APPLE_ID=you@example.com
   export APPLE_APP_SPECIFIC_PASSWORD=…   # app-specific password
   export APPLE_TEAM_ID=XXXXXXXXXX
   ```

3. Set `"notarize": true` under `build.mac` (or `APPLE_NOTARIZE=true`) and run
   `npm run package`. `hardenedRuntime` and
   `build/entitlements.mac.plist` are already configured; the entitlements cover
   V8 JIT, library validation for the signed sidecar, and user-selected file
   access for the download-folder picker.

Without an identity, packages still run locally (the Rust binary carries an
ad-hoc signature from the linker, which Apple Silicon requires).

## Windows

- `build.win.target` is `nsis`; `nsis.oneClick` is off and the install directory
  is user-selectable.
- The Rust core must be built on Windows so the file is `xuvon-core.exe`.
- Code signing via `CSC_LINK`/`CSC_KEY_PASSWORD` (EV certificates work with
  electron-builder's `signtool` integration).
- **Not yet built or tested.** The first Windows release must be smoke-tested
  (boot, tabs, downloads, proxy settings) before this claim changes.

## Linux

- Targets are `AppImage` and `deb`, category `Network;WebBrowser`, maintainer
  `Seb`. `build/icon.png` is used; electron-builder derives the hicolor icon set.
- AppImage bundling requires FUSE on the target machine or `--appimage-extract`.
- **Not yet built or tested.** Verify on a real desktop session (Wayland and
  X11) before claiming support.

## Auto-update

There is no auto-updater in this repository. The honest options for a
maintainer:

1. **Manual releases (current).** Publish signed installers; users update by
   reinstalling. No background code execution.
2. **electron-updater.** Add `electron-updater`, a publish provider (GitHub
   Releases, S3, or a static feed), and configure `build.publish`. This requires
   code signing on macOS/Windows and a stable feed. Update checks must be
   surfaced in Settings before they are enabled.

Until (2) is implemented and documented, Xuvon never contacts a server for
updates.

## Update strategy for Chromium/Electron

- Electron releases land every ~8 weeks. Upgrade in a branch, run
  `npm test` (core + 30 end-to-end tests), and rebuild all three platforms.
- Chromium-facing behaviour is concentrated in `electron/sessions.ts`,
  `electron/tabs.ts`, and `electron/downloads.ts`; read those files when an
  upgrade changes `WebContentsView`, sessions, or download events.
- The core protocol integer (`core.ready.protocol`) guards host/core drift
  during staggered releases.

## Licensing and third-party notices

Xuvon's own source is MIT (`LICENSE`). Bundled components:

| Component | License | Notes |
| --- | --- | --- |
| Electron | MIT | Bundles Chromium and Node |
| Chromium | BSD-3-Clause + third-party components | Chromium's `about:credits` lists them |
| Node.js | MIT | Embedded in Electron |
| React, React DOM | MIT | Renderer |
| Inter (fontsource) | SIL OFL 1.1 | Variable font files |
| tldts | MIT | Third-party cookie detection and adblock party matching |
| zod | MIT | IPC validation |
| Xuvon adblock rules | MIT | Original rules authored for Xuvon; no third-party filter-list data is bundled |
| Rust crates | Apache-2.0 / MIT (mostly) | `Cargo.lock` is authoritative |

Because Xuvon is not distributed in this repository and is otherwise a local
build, a generated license bundle is not shipped yet. Before public binary
distribution, add a `THIRD_PARTY_NOTICES.md` generated from
`license-checker` (npm) and `cargo-license` (Rust), and surface Chromium's
`chrome://credits` through an internal page. Chromium's license terms are
satisfied by that credits page plus the notices file; do not strip them.
