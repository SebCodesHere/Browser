use crate::error::{CoreError, CoreResult};
use crate::tor;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use url::Url;

const MAX_TEXT: usize = 512;
const MAX_URL: usize = 8192;
const MAX_PATH: usize = 4096;
const MAX_ALLOWLIST: usize = 500;
const WALLPAPER_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccentTheme {
    #[default]
    Mint,
    Peach,
    Sky,
    Lilac,
    Rose,
    Sunset,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WallpaperId {
    #[default]
    None,
    Aurora,
    Dunes,
    Grid,
    Mist,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StartupBehavior {
    Newtab,
    Restore,
    Homepage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CookiePolicy {
    AllowAll,
    BlockThirdParty,
    SessionOnly,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "settings_version")]
    pub version: u32,
    pub theme: Theme,
    pub search_provider: String,
    pub custom_search_name: String,
    pub custom_search_url: String,
    pub homepage: String,
    pub startup_behavior: StartupBehavior,
    pub download_directory: String,
    pub ask_where_to_save: bool,
    pub tab_sleep_enabled: bool,
    pub tab_sleep_minutes: u32,
    pub dev_mode: bool,
    pub cookie_policy: CookiePolicy,
    pub clear_data_on_exit: bool,
    pub send_do_not_track: bool,
    pub tor_enabled: bool,
    pub tor_proxy: String,
    pub extensions_enabled: bool,
    #[serde(default = "default_true")]
    pub adblock_enabled: bool,
    #[serde(default)]
    pub adblock_allowlist: Vec<String>,
    #[serde(default)]
    pub accent_theme: AccentTheme,
    #[serde(default)]
    pub accent_color: String,
    #[serde(default)]
    pub wallpaper_id: WallpaperId,
    #[serde(default)]
    pub wallpaper_path: String,
}

fn default_true() -> bool {
    true
}

fn settings_version() -> u32 {
    1
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            theme: Theme::System,
            search_provider: "duckduckgo".into(),
            custom_search_name: "Custom".into(),
            custom_search_url: String::new(),
            homepage: "xuvon://newtab".into(),
            startup_behavior: StartupBehavior::Newtab,
            download_directory: String::new(),
            ask_where_to_save: false,
            tab_sleep_enabled: true,
            tab_sleep_minutes: 30,
            dev_mode: false,
            cookie_policy: CookiePolicy::AllowAll,
            clear_data_on_exit: false,
            send_do_not_track: true,
            tor_enabled: false,
            tor_proxy: "socks5://127.0.0.1:9050".into(),
            extensions_enabled: true,
            adblock_enabled: true,
            adblock_allowlist: Vec::new(),
            accent_theme: AccentTheme::Mint,
            accent_color: String::new(),
            wallpaper_id: WallpaperId::None,
            wallpaper_path: String::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsPatch {
    pub theme: Option<Theme>,
    pub search_provider: Option<String>,
    pub custom_search_name: Option<String>,
    pub custom_search_url: Option<String>,
    pub homepage: Option<String>,
    pub startup_behavior: Option<StartupBehavior>,
    pub download_directory: Option<String>,
    pub ask_where_to_save: Option<bool>,
    pub tab_sleep_enabled: Option<bool>,
    pub tab_sleep_minutes: Option<u32>,
    pub dev_mode: Option<bool>,
    pub cookie_policy: Option<CookiePolicy>,
    pub clear_data_on_exit: Option<bool>,
    pub send_do_not_track: Option<bool>,
    pub tor_enabled: Option<bool>,
    pub tor_proxy: Option<String>,
    pub extensions_enabled: Option<bool>,
    pub adblock_enabled: Option<bool>,
    pub adblock_allowlist: Option<Vec<String>>,
    pub accent_theme: Option<AccentTheme>,
    pub accent_color: Option<String>,
    pub wallpaper_id: Option<WallpaperId>,
    pub wallpaper_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchProvider {
    pub id: String,
    pub name: String,
    pub description: String,
    pub search_url: String,
    pub privacy_note: String,
    pub built_in: bool,
}

pub const INTERNAL_PAGES: &[&str] = &[
    "newtab",
    "settings",
    "bookmarks",
    "history",
    "downloads",
    "about",
    "welcome",
];

pub fn is_internal_url(value: &str) -> bool {
    let Some(rest) = value.strip_prefix("xuvon://") else {
        return false;
    };
    let route = rest.split(['/', '?', '#']).next().unwrap_or("");
    INTERNAL_PAGES.contains(&route)
}

pub fn built_in_providers() -> Vec<SearchProvider> {
    vec![
        SearchProvider {
            id: "duckduckgo".into(),
            name: "DuckDuckGo".into(),
            description: "Balanced results with an independent index.".into(),
            search_url: "https://duckduckgo.com/?q=%s".into(),
            privacy_note:
                "Queries are sent to DuckDuckGo. Xuvon sends no account or profile identifier."
                    .into(),
            built_in: true,
        },
        SearchProvider {
            id: "google".into(),
            name: "Google".into(),
            description: "The most comprehensive index.".into(),
            search_url: "https://www.google.com/search?q=%s".into(),
            privacy_note:
                "Queries are sent to Google and may be associated with your Google session.".into(),
            built_in: true,
        },
        SearchProvider {
            id: "brave".into(),
            name: "Brave Search".into(),
            description: "An independent index with a privacy focus.".into(),
            search_url: "https://search.brave.com/search?q=%s".into(),
            privacy_note: "Queries are sent to Brave Search. No API key is used.".into(),
            built_in: true,
        },
        SearchProvider {
            id: "kagi".into(),
            name: "Kagi".into(),
            description: "Ad-free search for Kagi subscribers.".into(),
            search_url: "https://kagi.com/search?q=%s".into(),
            privacy_note: "Kagi may require a paid account. Xuvon stores no Kagi credentials."
                .into(),
            built_in: true,
        },
        SearchProvider {
            id: "startpage".into(),
            name: "Startpage".into(),
            description: "Google results through a privacy proxy.".into(),
            search_url: "https://www.startpage.com/sp/search?query=%s".into(),
            privacy_note: "Queries are proxied by Startpage.".into(),
            built_in: true,
        },
    ]
}

pub fn providers_for(settings: &Settings) -> Vec<SearchProvider> {
    let mut providers = built_in_providers();
    if !settings.custom_search_url.trim().is_empty() {
        providers.push(SearchProvider {
            id: "custom".into(),
            name: if settings.custom_search_name.trim().is_empty() {
                "Custom search".into()
            } else {
                settings.custom_search_name.trim().to_string()
            },
            description: "Your own OpenSearch-style query template.".into(),
            search_url: settings.custom_search_url.trim().to_string(),
            privacy_note: "Queries are sent to the search provider you configured.".into(),
            built_in: false,
        });
    }
    providers
}

pub fn provider_for<'a>(providers: &'a [SearchProvider], id: &str) -> Option<&'a SearchProvider> {
    providers.iter().find(|provider| provider.id == id)
}

/// Lowercases, trims, dedupes, and drops malformed ad blocking allowlist
/// entries. Matching in the host treats entries as site suffixes.
pub fn normalize_allowlist(entries: &[String]) -> Vec<String> {
    let mut allowed: Vec<String> = Vec::new();
    for raw in entries {
        let mut host = raw.trim().to_ascii_lowercase();
        host = host.trim_start_matches('.').to_string();
        if let Some(rest) = host.strip_prefix("www.") {
            host = rest.to_string();
        }
        if !valid_allowlist_entry(&host) {
            continue;
        }
        if !allowed.contains(&host) && allowed.len() < MAX_ALLOWLIST {
            allowed.push(host);
        }
    }
    allowed
}

pub fn valid_allowlist_entry(host: &str) -> bool {
    if host.is_empty() || host.len() > 253 {
        return false;
    }
    if host.contains(|character: char| {
        character.is_whitespace() || character == '/' || character == '\\' || character == ':'
    }) {
        return false;
    }
    host.split('.').all(|label| {
        !label.is_empty()
            && label.chars().all(|character| {
                character.is_ascii_alphanumeric() || character == '-' || character == '_'
            })
    })
}

/// Wallpaper files live in `<data-dir>/wallpapers/` and are named
/// `wallpaper-<uuid>.<png|jpg|jpeg|webp|gif|avif|bmp>`.
pub fn is_wallpaper_filename(name: &str) -> bool {
    if name.len() > 200 || !name.starts_with("wallpaper-") {
        return false;
    }
    if name.contains('/') || name.contains('\\') {
        return false;
    }
    let Some((stem, extension)) = name.rsplit_once('.') else {
        return false;
    };
    if !WALLPAPER_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()) {
        return false;
    }
    stem.chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
}

pub fn valid_hex_color(value: &str) -> bool {
    value.len() == 7 && value.starts_with('#') && value[1..].chars().all(|c| c.is_ascii_hexdigit())
}

pub fn search_url(settings: &Settings, query: &str) -> CoreResult<String> {
    let providers = providers_for(settings);
    let provider = provider_for(&providers, &settings.search_provider)
        .or_else(|| provider_for(&providers, "duckduckgo"))
        .ok_or_else(|| CoreError::internal("No search provider is available"))?;

    let encoded: String = url::form_urlencoded::byte_serialize(query.as_bytes()).collect();
    let target = provider.search_url.replace("%s", &encoded);
    let parsed = Url::parse(&target)
        .map_err(|_| CoreError::internal("The configured search URL is invalid"))?;
    if !matches!(parsed.scheme(), "https" | "http") {
        return Err(CoreError::internal(
            "The configured search URL must use HTTP or HTTPS",
        ));
    }
    Ok(parsed.to_string())
}

impl Settings {
    pub fn validate(&self) -> CoreResult<()> {
        let providers = providers_for(self);
        if provider_for(&providers, &self.search_provider).is_none() {
            return Err(CoreError::invalid_params("Unknown search provider"));
        }

        if self.custom_search_name.chars().count() > MAX_TEXT {
            return Err(CoreError::invalid_params("Custom search name is too long"));
        }
        if !self.custom_search_url.trim().is_empty() {
            let url = self.custom_search_url.trim();
            if url.len() > MAX_URL || !url.contains("%s") {
                return Err(CoreError::invalid_params(
                    "A custom search URL must contain a %s query placeholder",
                ));
            }
            let parsed = Url::parse(&url.replace("%s", "xuvon"))
                .map_err(|_| CoreError::invalid_params("Custom search URL is invalid"))?;
            if !matches!(parsed.scheme(), "https" | "http") {
                return Err(CoreError::invalid_params(
                    "Custom search URL must use HTTP or HTTPS",
                ));
            }
        }

        if self.homepage.len() > MAX_URL {
            return Err(CoreError::invalid_params("Homepage URL is too long"));
        }
        if !self.homepage.is_empty()
            && !is_internal_url(&self.homepage)
            && !matches!(
                Url::parse(&self.homepage).map(|url| url.scheme().to_string()),
                Ok(scheme) if scheme == "http" || scheme == "https"
            )
        {
            return Err(CoreError::invalid_params(
                "Homepage must be an HTTP(S) or Xuvon internal URL",
            ));
        }

        if self.download_directory.chars().count() > MAX_PATH {
            return Err(CoreError::invalid_params("Download directory is too long"));
        }
        if !(1..=240).contains(&self.tab_sleep_minutes) {
            return Err(CoreError::invalid_params(
                "Tab sleep delay must be between 1 and 240 minutes",
            ));
        }

        tor::normalize_proxy(&self.tor_proxy)?;

        if self.adblock_allowlist.len() > MAX_ALLOWLIST {
            return Err(CoreError::invalid_params(
                "The ad blocking allowlist is limited to 500 sites",
            ));
        }
        if let Some(invalid) = self
            .adblock_allowlist
            .iter()
            .find(|host| !valid_allowlist_entry(host))
        {
            return Err(CoreError::invalid_params(format!(
                "Invalid allowlist host: {invalid}"
            )));
        }
        if !self.accent_color.is_empty() && !valid_hex_color(&self.accent_color) {
            return Err(CoreError::invalid_params(
                "Accent color must be a #rrggbb hex value",
            ));
        }
        if self.accent_theme == AccentTheme::Custom && !valid_hex_color(&self.accent_color) {
            return Err(CoreError::invalid_params(
                "Choose a custom accent color before selecting the custom theme",
            ));
        }
        if self.wallpaper_id == WallpaperId::Custom && !is_wallpaper_filename(&self.wallpaper_path)
        {
            return Err(CoreError::invalid_params(
                "The custom wallpaper file name is invalid",
            ));
        }

        // Defensive invariant: a configured homepage must never point at an
        // onion service.
        if !self.homepage.is_empty() {
            if let Ok(url) = Url::parse(&self.homepage) {
                if url.host_str().is_some_and(tor::is_onion_host) {
                    return Err(CoreError::blocked_onion());
                }
            }
        }

        Ok(())
    }

    pub fn apply_patch(&self, patch: SettingsPatch) -> CoreResult<Self> {
        let mut next = self.clone();
        if let Some(value) = patch.theme {
            next.theme = value;
        }
        if let Some(value) = patch.search_provider {
            next.search_provider = value.trim().to_string();
        }
        if let Some(value) = patch.custom_search_name {
            next.custom_search_name = value.trim().to_string();
        }
        if let Some(value) = patch.custom_search_url {
            next.custom_search_url = value.trim().to_string();
        }
        if let Some(value) = patch.homepage {
            next.homepage = value.trim().to_string();
        }
        if let Some(value) = patch.startup_behavior {
            next.startup_behavior = value;
        }
        if let Some(value) = patch.download_directory {
            next.download_directory = value.trim().to_string();
        }
        if let Some(value) = patch.ask_where_to_save {
            next.ask_where_to_save = value;
        }
        if let Some(value) = patch.tab_sleep_enabled {
            next.tab_sleep_enabled = value;
        }
        if let Some(value) = patch.tab_sleep_minutes {
            next.tab_sleep_minutes = value;
        }
        if let Some(value) = patch.dev_mode {
            next.dev_mode = value;
        }
        if let Some(value) = patch.cookie_policy {
            next.cookie_policy = value;
        }
        if let Some(value) = patch.clear_data_on_exit {
            next.clear_data_on_exit = value;
        }
        if let Some(value) = patch.send_do_not_track {
            next.send_do_not_track = value;
        }
        if let Some(value) = patch.tor_enabled {
            next.tor_enabled = value;
        }
        if let Some(value) = patch.tor_proxy {
            next.tor_proxy = value.trim().to_string();
        }
        if let Some(value) = patch.extensions_enabled {
            next.extensions_enabled = value;
        }
        if let Some(value) = patch.adblock_enabled {
            next.adblock_enabled = value;
        }
        if let Some(value) = patch.adblock_allowlist {
            next.adblock_allowlist = normalize_allowlist(&value);
        }
        if let Some(value) = patch.accent_theme {
            next.accent_theme = value;
        }
        if let Some(value) = patch.accent_color {
            next.accent_color = value.trim().to_ascii_lowercase();
        }
        if let Some(value) = patch.wallpaper_id {
            next.wallpaper_id = value;
            if value != WallpaperId::Custom {
                next.wallpaper_path.clear();
            }
        }
        if let Some(value) = patch.wallpaper_path {
            next.wallpaper_path = value.trim().to_string();
        }
        next.validate()?;
        Ok(next)
    }
}

pub struct SettingsStore {
    path: PathBuf,
    settings: Settings,
}

impl SettingsStore {
    pub fn open(data_dir: &Path) -> CoreResult<Self> {
        fs::create_dir_all(data_dir).map_err(|error| {
            CoreError::internal(format!("Cannot create data directory: {error}"))
        })?;
        let path = data_dir.join("settings.json");
        let settings = load_settings(&path);
        let store = Self { path, settings };
        store.persist()?;
        Ok(store)
    }

    pub fn settings(&self) -> &Settings {
        &self.settings
    }

    pub fn update(&mut self, patch: SettingsPatch) -> CoreResult<Settings> {
        let next = self.settings.apply_patch(patch)?;
        let previous = self.settings.clone();
        self.settings = next;
        if let Err(error) = self.persist() {
            self.settings = previous;
            return Err(error);
        }
        Ok(self.settings.clone())
    }

    pub fn reset(&mut self) -> CoreResult<Settings> {
        let previous = self.settings.clone();
        self.settings = Settings::default();
        if let Err(error) = self.persist() {
            self.settings = previous;
            return Err(error);
        }
        Ok(self.settings.clone())
    }

    pub fn reload(&mut self) -> CoreResult<Settings> {
        self.settings = load_settings(&self.path);
        Ok(self.settings.clone())
    }

    fn persist(&self) -> CoreResult<()> {
        let serialized = serde_json::to_vec_pretty(&self.settings)?;
        let temporary = self.path.with_extension("json.tmp");
        fs::write(&temporary, &serialized)
            .map_err(|error| CoreError::internal(format!("Cannot write settings: {error}")))?;
        if let Err(error) = fs::rename(&temporary, &self.path) {
            // Windows cannot always replace an existing file atomically.
            let _ = fs::remove_file(&self.path);
            fs::rename(&temporary, &self.path).map_err(|_| {
                CoreError::internal(format!("Cannot commit settings file: {error}"))
            })?;
        }
        Ok(())
    }
}

fn load_settings(path: &Path) -> Settings {
    let Ok(raw) = fs::read_to_string(path) else {
        return Settings::default();
    };
    match serde_json::from_str::<Settings>(&raw) {
        Ok(settings) if settings.validate().is_ok() => settings,
        _ => {
            let backup = path.with_file_name(format!(
                "settings.invalid-{}.json",
                chrono::Utc::now().timestamp()
            ));
            let _ = fs::rename(path, &backup);
            eprintln!(
                "{{\"level\":\"warn\",\"msg\":\"invalid settings file moved\",\"path\":{}}}",
                serde_json::to_string(&backup).unwrap_or_default()
            );
            Settings::default()
        }
    }
}

pub fn internal_default_home() -> &'static str {
    "xuvon://newtab"
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn defaults_are_valid() {
        Settings::default().validate().unwrap();
    }

    #[test]
    fn patch_validates_provider() {
        let settings = Settings::default();
        let patch = SettingsPatch {
            search_provider: Some("unknown".into()),
            ..Default::default()
        };
        assert!(settings.apply_patch(patch).is_err());
    }

    #[test]
    fn custom_search_requires_placeholder_and_http() {
        let mut settings = Settings::default();
        settings.custom_search_url = "https://search.example/?q=no-placeholder".into();
        settings.search_provider = "custom".into();
        assert!(settings.validate().is_err());

        settings.custom_search_url = "javascript:alert(%s)".into();
        assert!(settings.validate().is_err());

        settings.custom_search_url = "https://search.example/?q=%s".into();
        settings.validate().unwrap();
        let resolved = search_url(&settings, "xuvon browser").unwrap();
        assert!(resolved.starts_with("https://search.example/?q=xuvon+browser"));
    }

    #[test]
    fn settings_persist_and_reload() {
        let dir = tempdir().unwrap();
        {
            let mut store = SettingsStore::open(dir.path()).unwrap();
            let settings = store
                .update(SettingsPatch {
                    theme: Some(Theme::Dark),
                    tab_sleep_minutes: Some(12),
                    ..Default::default()
                })
                .unwrap();
            assert_eq!(settings.theme, Theme::Dark);
            assert_eq!(settings.tab_sleep_minutes, 12);
        }
        let store = SettingsStore::open(dir.path()).unwrap();
        assert_eq!(store.settings().theme, Theme::Dark);
        assert_eq!(store.settings().tab_sleep_minutes, 12);
    }

    #[test]
    fn rejects_out_of_range_sleep() {
        let mut settings = Settings::default();
        settings.tab_sleep_minutes = 0;
        assert!(settings.validate().is_err());
        settings.tab_sleep_minutes = 241;
        assert!(settings.validate().is_err());
    }

    #[test]
    fn internal_url_allowlist() {
        assert!(is_internal_url("xuvon://newtab"));
        assert!(is_internal_url("xuvon://settings/appearance"));
        assert!(!is_internal_url("xuvon://evil"));
        assert!(!is_internal_url("xuvon://"));
    }

    #[test]
    fn adblock_allowlist_is_normalized() {
        let settings = Settings::default();
        let next = settings
            .apply_patch(SettingsPatch {
                adblock_allowlist: Some(vec![
                    " Example.COM ".into(),
                    ".example.com".into(),
                    "www.example.com".into(),
                    "".into(),
                    "bad host".into(),
                    "https://example.org".into(),
                    "sub.example.org".into(),
                ]),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(
            next.adblock_allowlist,
            vec!["example.com".to_string(), "sub.example.org".to_string()]
        );
    }

    #[test]
    fn accent_and_wallpaper_settings_are_validated() {
        let settings = Settings::default();

        assert!(settings
            .apply_patch(SettingsPatch {
                accent_theme: Some(AccentTheme::Custom),
                ..Default::default()
            })
            .is_err());

        assert!(settings
            .apply_patch(SettingsPatch {
                accent_theme: Some(AccentTheme::Custom),
                accent_color: Some("not-a-color".into()),
                ..Default::default()
            })
            .is_err());

        let themed = settings
            .apply_patch(SettingsPatch {
                accent_theme: Some(AccentTheme::Custom),
                accent_color: Some("#FF00AA".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(themed.accent_color, "#ff00aa");

        assert!(settings
            .apply_patch(SettingsPatch {
                wallpaper_id: Some(WallpaperId::Custom),
                wallpaper_path: Some("../escape.png".into()),
                ..Default::default()
            })
            .is_err());

        let wallpapered = settings
            .apply_patch(SettingsPatch {
                wallpaper_id: Some(WallpaperId::Custom),
                wallpaper_path: Some("wallpaper-1234abcd.png".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(wallpapered.wallpaper_path, "wallpaper-1234abcd.png");

        let cleared = wallpapered
            .apply_patch(SettingsPatch {
                wallpaper_id: Some(WallpaperId::Aurora),
                ..Default::default()
            })
            .unwrap();
        assert!(cleared.wallpaper_path.is_empty());
    }

    #[test]
    fn wallpaper_filename_rules() {
        assert!(is_wallpaper_filename("wallpaper-1a2b3c.png"));
        assert!(is_wallpaper_filename("wallpaper-1a2b3c.WEBP"));
        assert!(!is_wallpaper_filename("wallpaper-1a2b3c.svg"));
        assert!(!is_wallpaper_filename("wallpaper-../x.png"));
        assert!(!is_wallpaper_filename("other.png"));
        assert!(!is_wallpaper_filename("wallpaper-"));
    }
}
