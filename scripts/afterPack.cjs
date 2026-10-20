const fs = require("node:fs");
const path = require("node:path");

// electron-builder afterPack hook.
//
// Verifies that the Rust core sidecar made it into the packaged resources and
// that it is executable on POSIX platforms (npm/zip archives can lose the mode
// bit). macOS code signing, when configured, runs after this hook and signs the
// sidecar along with the rest of the bundle.

exports.default = async function afterPack(context) {
  const resources = context.packager.getResourcesDir(context.appOutDir);
  const name = process.platform === "win32" ? "xuvon-core.exe" : "xuvon-core";
  const binary = path.join(resources, "bin", name);

  if (!fs.existsSync(binary)) {
    throw new Error(
      `[afterPack] xuvon-core is missing from the packaged resources (${binary}). ` +
        "Run `npm run build:core:release` before packaging."
    );
  }

  const stat = fs.statSync(binary);
  if (!stat.size) {
    throw new Error(`[afterPack] xuvon-core at ${binary} is empty.`);
  }

  if (process.platform !== "win32") {
    fs.chmodSync(binary, 0o755);
  }

  console.log(`[afterPack] verified Rust core: ${binary} (${stat.size} bytes)`);
};
