use std::env;
use std::path::PathBuf;

/// Resolve the platform-appropriate application data directory.
///
/// The Electron host normally passes an explicit `--data-dir`, so this is a
/// fallback for running the core directly and for tests.
pub fn default_data_dir() -> PathBuf {
    if let Ok(value) = env::var("XUVON_DATA_DIR") {
        if !value.trim().is_empty() {
            return PathBuf::from(value);
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = env::var_os("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("Xuvon Browser");
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(appdata) = env::var_os("APPDATA") {
            return PathBuf::from(appdata).join("Xuvon Browser");
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(xdg) = env::var_os("XDG_DATA_HOME") {
            if !xdg.is_empty() {
                return PathBuf::from(xdg).join("xuvon-browser");
            }
        }
        if let Some(home) = env::var_os("HOME") {
            return PathBuf::from(home)
                .join(".local")
                .join("share")
                .join("xuvon-browser");
        }
    }

    PathBuf::from(".xuvon")
}
