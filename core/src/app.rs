use crate::bookmarks;
use crate::downloads::{self, DownloadState};
use crate::error::{CoreError, CoreResult};
use crate::extensions;
use crate::history;
use crate::navigation::{self, ResolveRequest};
use crate::settings::{self, SettingsPatch, SettingsStore};
use crate::storage;
use crate::workspace::{self, Workspace};
use crate::{CORE_VERSION, PROTOCOL_VERSION};
use rusqlite::Connection;
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Mutex, RwLock};

pub struct App {
    pub data_dir: PathBuf,
    settings: RwLock<SettingsStore>,
    db: Mutex<Connection>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListBookmarksParams {
    #[serde(default)]
    query: String,
    #[serde(default)]
    folder: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateBookmarkParams {
    url: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    folder: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateBookmarkParams {
    id: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    folder: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IdParams {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UrlParams {
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoryListParams {
    #[serde(default)]
    query: String,
    #[serde(default)]
    limit: Option<u32>,
    #[serde(default)]
    offset: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoryAddParams {
    url: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    private: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoryTitleParams {
    url: String,
    title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LimitParams {
    #[serde(default)]
    limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DownloadCreateParams {
    id: String,
    url: String,
    filename: String,
    path: String,
    #[serde(default)]
    total_bytes: Option<i64>,
    #[serde(default)]
    danger: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DownloadUpdateParams {
    id: String,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    received_bytes: Option<i64>,
    #[serde(default)]
    total_bytes: Option<i64>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExtensionAddParams {
    id: String,
    name: String,
    version: String,
    path: String,
    #[serde(default)]
    enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExtensionToggleParams {
    id: String,
    enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceSaveParams {
    workspace: Workspace,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProxyParams {
    proxy: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportPreviewParams {
    #[serde(default)]
    bookmarks_path: Option<String>,
    #[serde(default)]
    settings_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportCommitParams {
    bookmarks_path: String,
}

impl App {
    pub fn open(data_dir: PathBuf) -> CoreResult<Self> {
        let settings = SettingsStore::open(&data_dir)?;
        let db = storage::open(&data_dir)?;
        Ok(Self {
            data_dir,
            settings: RwLock::new(settings),
            db: Mutex::new(db),
        })
    }

    pub fn settings_snapshot(&self) -> CoreResult<settings::Settings> {
        Ok(self
            .settings
            .read()
            .map_err(|_| CoreError::internal("Settings lock is poisoned"))?
            .settings()
            .clone())
    }

    pub fn handle(&self, method: &str, params: Value) -> CoreResult<Value> {
        match method {
            "app.ping" => {
                Self::expect_no_params(&params)?;
                Ok(json!({ "ok": true, "time": storage::timestamp_now() }))
            }
            "app.info" => {
                Self::expect_no_params(&params)?;
                Ok(json!({
                    "name": "xuvon-core",
                    "version": CORE_VERSION,
                    "protocol": PROTOCOL_VERSION,
                    "dataDir": self.data_dir.to_string_lossy(),
                    "platform": std::env::consts::OS,
                    "arch": std::env::consts::ARCH,
                }))
            }
            "settings.get" | "settings.update" | "settings.reset" => {
                self.handle_settings(method, params)
            }
            "navigation.resolve" => {
                let request: ResolveRequest = Self::parse(params)?;
                let settings = self.settings_snapshot()?;
                let resolution = navigation::resolve(&settings, &request.input, request.mode)?;
                Ok(serde_json::to_value(resolution)?)
            }
            "tor.validateProxy" => {
                let params: ProxyParams = Self::parse(params)?;
                let proxy = crate::tor::normalize_proxy(&params.proxy)?;
                Ok(json!({ "proxy": proxy }))
            }
            "onboarding.status" => {
                Self::expect_no_params(&params)?;
                let connection = self.connection()?;
                Ok(json!({
                    "completed": storage::onboarding_completed(&connection)?
                }))
            }
            "onboarding.complete" => {
                Self::expect_no_params(&params)?;
                let connection = self.connection()?;
                storage::set_onboarding_completed(&connection, true)?;
                Ok(json!({ "completed": true }))
            }
            "imports.preview" => {
                let params: ImportPreviewParams = Self::parse(params)?;
                let preview = crate::importers::preview(
                    params.bookmarks_path.as_deref(),
                    params.settings_path.as_deref(),
                )?;
                Ok(serde_json::to_value(preview)?)
            }
            "imports.commit" => {
                let params: ImportCommitParams = Self::parse(params)?;
                let mut connection = self.connection()?;
                let result =
                    crate::importers::import_bookmarks(&mut connection, &params.bookmarks_path)?;
                Ok(serde_json::to_value(result)?)
            }
            "bookmarks.list" => {
                let params: ListBookmarksParams = Self::parse(params)?;
                let connection = self.connection()?;
                let items = bookmarks::list(&connection, &params.query, params.folder.as_deref())?;
                Ok(json!({ "bookmarks": items }))
            }
            "bookmarks.create" => {
                let params: CreateBookmarkParams = Self::parse(params)?;
                let connection = self.connection()?;
                let (bookmark, created) = bookmarks::create(
                    &connection,
                    &params.url,
                    params.title.as_deref().unwrap_or(""),
                    params.folder.as_deref(),
                )?;
                Ok(json!({ "bookmark": bookmark, "created": created }))
            }
            "bookmarks.update" => {
                let params: UpdateBookmarkParams = Self::parse(params)?;
                let connection = self.connection()?;
                let bookmark = bookmarks::update(
                    &connection,
                    &params.id,
                    params.title.as_deref(),
                    params.url.as_deref(),
                    params.folder.as_deref(),
                )?;
                Ok(json!({ "bookmark": bookmark }))
            }
            "bookmarks.delete" => {
                let params: IdParams = Self::parse(params)?;
                let connection = self.connection()?;
                let deleted = bookmarks::delete(&connection, &params.id)?;
                Ok(json!({ "deleted": deleted }))
            }
            "bookmarks.folders" => {
                Self::expect_no_params(&params)?;
                let connection = self.connection()?;
                let folders = bookmarks::folders(&connection)?;
                Ok(json!({ "folders": folders }))
            }
            "bookmarks.find" => {
                let params: UrlParams = Self::parse(params)?;
                let connection = self.connection()?;
                let bookmark = bookmarks::find_by_url(&connection, params.url.trim())?;
                Ok(json!({ "bookmark": bookmark }))
            }
            "history.list" => {
                let params: HistoryListParams = Self::parse(params)?;
                let connection = self.connection()?;
                let page = history::list(
                    &connection,
                    &params.query,
                    params.limit.unwrap_or(200),
                    params.offset.unwrap_or(0),
                )?;
                Ok(json!({ "entries": page.entries, "total": page.total }))
            }
            "history.add" => {
                let params: HistoryAddParams = Self::parse(params)?;
                let connection = self.connection()?;
                let added = history::add(
                    &connection,
                    &params.url,
                    params.title.as_deref().unwrap_or(""),
                    params.private.unwrap_or(false),
                )?;
                Ok(json!({ "added": added }))
            }
            "history.updateTitle" => {
                let params: HistoryTitleParams = Self::parse(params)?;
                let connection = self.connection()?;
                let updated = history::update_title(&connection, &params.url, &params.title)?;
                Ok(json!({ "updated": updated }))
            }
            "history.topSites" => {
                let params: LimitParams = Self::parse(params)?;
                let connection = self.connection()?;
                let sites = history::top_sites(&connection, params.limit.unwrap_or(8))?;
                Ok(json!({ "sites": sites }))
            }
            "history.delete" => {
                let params: IdParams = Self::parse(params)?;
                let connection = self.connection()?;
                let deleted = history::delete(&connection, &params.id)?;
                Ok(json!({ "deleted": deleted }))
            }
            "history.clear" => {
                Self::expect_no_params(&params)?;
                let connection = self.connection()?;
                history::clear(&connection)?;
                Ok(json!({ "cleared": true }))
            }
            "downloads.list" => {
                let params: LimitParams = Self::parse(params)?;
                let connection = self.connection()?;
                let items = downloads::list(&connection, params.limit.unwrap_or(200))?;
                Ok(json!({ "downloads": items }))
            }
            "downloads.create" => {
                let params: DownloadCreateParams = Self::parse(params)?;
                let connection = self.connection()?;
                let record = downloads::create(
                    &connection,
                    &params.id,
                    &params.url,
                    &params.filename,
                    &params.path,
                    params.total_bytes.unwrap_or(-1),
                    params.danger.unwrap_or(false),
                )?;
                Ok(json!({ "download": record }))
            }
            "downloads.update" => {
                let params: DownloadUpdateParams = Self::parse(params)?;
                let state = match params.state.as_deref() {
                    Some(value) => Some(DownloadState::parse(value)?),
                    None => None,
                };
                let connection = self.connection()?;
                let record = downloads::update(
                    &connection,
                    &params.id,
                    state,
                    params.received_bytes,
                    params.total_bytes,
                    params.error.as_deref(),
                )?;
                Ok(json!({ "download": record }))
            }
            "downloads.delete" => {
                let params: IdParams = Self::parse(params)?;
                let connection = self.connection()?;
                let deleted = downloads::delete(&connection, &params.id)?;
                Ok(json!({ "deleted": deleted }))
            }
            "downloads.clearFinished" => {
                Self::expect_no_params(&params)?;
                let connection = self.connection()?;
                let removed = downloads::clear_finished(&connection)?;
                Ok(json!({ "removed": removed }))
            }
            "extensions.list" => {
                Self::expect_no_params(&params)?;
                let connection = self.connection()?;
                let items = extensions::list(&connection)?;
                Ok(json!({ "extensions": items }))
            }
            "extensions.add" => {
                let params: ExtensionAddParams = Self::parse(params)?;
                let connection = self.connection()?;
                let record = extensions::upsert(
                    &connection,
                    &params.id,
                    &params.name,
                    &params.version,
                    &params.path,
                    params.enabled.unwrap_or(true),
                )?;
                Ok(json!({ "extension": record }))
            }
            "extensions.setEnabled" => {
                let params: ExtensionToggleParams = Self::parse(params)?;
                let connection = self.connection()?;
                let record = extensions::set_enabled(&connection, &params.id, params.enabled)?;
                Ok(json!({ "extension": record }))
            }
            "extensions.remove" => {
                let params: IdParams = Self::parse(params)?;
                let connection = self.connection()?;
                let removed = extensions::remove(&connection, &params.id)?;
                Ok(json!({ "removed": removed }))
            }
            "workspace.get" => {
                Self::expect_no_params(&params)?;
                let connection = self.connection()?;
                let workspace = workspace::load(&connection)?;
                Ok(json!({ "workspace": workspace }))
            }
            "workspace.save" => {
                let params: WorkspaceSaveParams = Self::parse(params)?;
                let connection = self.connection()?;
                workspace::save(&connection, &params.workspace)?;
                Ok(json!({ "saved": true }))
            }
            "workspace.clear" => {
                Self::expect_no_params(&params)?;
                let connection = self.connection()?;
                workspace::clear(&connection)?;
                Ok(json!({ "cleared": true }))
            }
            other => Err(CoreError::new(
                "unknown_method",
                format!("Unknown core method: {other}"),
            )),
        }
    }

    fn handle_settings(&self, method: &str, params: Value) -> CoreResult<Value> {
        let mut store = self
            .settings
            .write()
            .map_err(|_| CoreError::internal("Settings lock is poisoned"))?;
        let updated = match method {
            "settings.get" => {
                Self::expect_no_params(&params)?;
                store.settings().clone()
            }
            "settings.reset" => {
                Self::expect_no_params(&params)?;
                store.reset()?
            }
            _ => {
                let patch: SettingsPatch = serde_json::from_value(params)
                    .map_err(|error| CoreError::invalid_params(clean_serde_error(&error)))?;
                store.update(patch)?
            }
        };
        Ok(json!({
            "settings": updated,
            "providers": settings::providers_for(&updated),
        }))
    }

    fn connection(&self) -> CoreResult<std::sync::MutexGuard<'_, Connection>> {
        self.db
            .lock()
            .map_err(|_| CoreError::internal("Database lock is poisoned"))
    }

    fn parse<T: DeserializeOwned>(params: Value) -> CoreResult<T> {
        serde_json::from_value(params)
            .map_err(|error| CoreError::invalid_params(clean_serde_error(&error)))
    }

    fn expect_no_params(params: &Value) -> CoreResult<()> {
        match params {
            Value::Null => Ok(()),
            Value::Object(map) if map.is_empty() => Ok(()),
            _ => Err(CoreError::invalid_params("This method takes no parameters")),
        }
    }
}

fn clean_serde_error(error: &serde_json::Error) -> String {
    let message = error.to_string();
    match message.split(" at line ").next() {
        Some(prefix) if !prefix.is_empty() => prefix.to_string(),
        _ => message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn app() -> (tempfile::TempDir, App) {
        let dir = tempdir().unwrap();
        let app = App::open(dir.path().to_path_buf()).unwrap();
        (dir, app)
    }

    #[test]
    fn dispatch_settings_roundtrip() {
        let (_dir, app) = app();
        let value = app
            .handle(
                "settings.update",
                json!({ "theme": "dark", "tabSleepMinutes": 10 }),
            )
            .unwrap();
        assert_eq!(value["settings"]["theme"], "dark");
        assert_eq!(value["settings"]["tabSleepMinutes"], 10);

        let fetched = app.handle("settings.get", Value::Null).unwrap();
        assert_eq!(fetched["settings"]["theme"], "dark");
    }

    #[test]
    fn dispatch_rejects_bad_settings() {
        let (_dir, app) = app();
        assert!(app
            .handle("settings.update", json!({ "tabSleepMinutes": 0 }))
            .is_err());
        assert!(app
            .handle("settings.update", json!({ "unexpectedField": true }))
            .is_err());
    }

    #[test]
    fn dispatch_navigation_and_onion_policy() {
        let (_dir, app) = app();
        let resolved = app
            .handle("navigation.resolve", json!({ "input": "example.com" }))
            .unwrap();
        assert_eq!(resolved["kind"], "url");

        let error = app
            .handle("navigation.resolve", json!({ "input": "https://x.onion" }))
            .unwrap_err();
        assert_eq!(error.code, "blocked_onion");
    }

    #[test]
    fn dispatch_bookmarks_and_history() {
        let (_dir, app) = app();
        let created = app
            .handle(
                "bookmarks.create",
                json!({ "url": "https://example.com", "title": "Example" }),
            )
            .unwrap();
        assert_eq!(created["created"], true);
        let listed = app.handle("bookmarks.list", json!({})).unwrap();
        assert_eq!(listed["bookmarks"].as_array().unwrap().len(), 1);

        app.handle(
            "history.add",
            json!({ "url": "https://example.com", "title": "Example" }),
        )
        .unwrap();
        let history = app.handle("history.list", json!({})).unwrap();
        assert_eq!(history["total"], 1);
    }

    #[test]
    fn onboarding_status_is_persisted_in_meta() {
        let (_dir, app) = app();
        let before = app.handle("onboarding.status", Value::Null).unwrap();
        assert_eq!(before["completed"], false);
        let completed = app.handle("onboarding.complete", Value::Null).unwrap();
        assert_eq!(completed["completed"], true);
        let after = app.handle("onboarding.status", Value::Null).unwrap();
        assert_eq!(after["completed"], true);
    }

    #[test]
    fn dispatch_preview_and_commit_imports() {
        let (dir, app) = app();
        let bookmarks = dir.path().join("bookmarks.html");
        std::fs::write(
            &bookmarks,
            r#"<DL><DT><A HREF="https://example.com/imported">Imported</A></DL>"#,
        )
        .unwrap();
        let preview = app
            .handle(
                "imports.preview",
                json!({ "bookmarksPath": bookmarks.to_string_lossy() }),
            )
            .unwrap();
        assert_eq!(preview["format"], "html");
        assert_eq!(preview["bookmarks"]["count"], 1);

        let imported = app
            .handle(
                "imports.commit",
                json!({ "bookmarksPath": bookmarks.to_string_lossy() }),
            )
            .unwrap();
        assert_eq!(imported["imported"], 1);
        let listed = app.handle("bookmarks.list", json!({})).unwrap();
        assert_eq!(listed["bookmarks"].as_array().unwrap().len(), 1);

        let skipped = app
            .handle(
                "imports.commit",
                json!({ "bookmarksPath": bookmarks.to_string_lossy() }),
            )
            .unwrap();
        assert_eq!(skipped["imported"], 0);
        assert_eq!(skipped["skipped"], 1);
    }

    #[test]
    fn dispatch_unknown_method() {
        let (_dir, app) = app();
        let error = app.handle("does.not.exist", Value::Null).unwrap_err();
        assert_eq!(error.code, "unknown_method");
    }

    #[test]
    fn workspace_roundtrip() {
        let (_dir, app) = app();
        app.handle(
            "workspace.save",
            json!({
                "workspace": {
                    "tabs": [{ "url": "https://example.com/", "title": "Example", "pinned": false }],
                    "activeIndex": 0
                }
            }),
        )
        .unwrap();
        let loaded = app.handle("workspace.get", Value::Null).unwrap();
        assert_eq!(
            loaded["workspace"]["tabs"][0]["url"],
            "https://example.com/"
        );
    }
}
