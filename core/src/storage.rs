use crate::error::{CoreError, CoreResult};
use chrono::{SecondsFormat, Utc};
use rusqlite::{Connection, OptionalExtension};
use std::fs;
use std::path::Path;
use std::time::Duration;

pub fn timestamp_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

const ONBOARDING_KEY: &str = "onboarding.completed";

pub fn onboarding_completed(connection: &Connection) -> CoreResult<bool> {
    let value = connection
        .query_row(
            "SELECT value FROM meta WHERE key = ?1",
            rusqlite::params![ONBOARDING_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(CoreError::from)?;
    Ok(value.as_deref() == Some("1"))
}

pub fn set_onboarding_completed(connection: &Connection, completed: bool) -> CoreResult<()> {
    connection
        .execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![ONBOARDING_KEY, if completed { "1" } else { "0" }],
        )
        .map_err(CoreError::from)?;
    Ok(())
}

pub fn open(data_dir: &Path) -> CoreResult<Connection> {
    fs::create_dir_all(data_dir)
        .map_err(|error| CoreError::internal(format!("Cannot create data directory: {error}")))?;
    let path = data_dir.join("xuvon.sqlite3");
    let connection = Connection::open(&path)
        .map_err(|error| CoreError::internal(format!("Cannot open database: {error}")))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(CoreError::from)?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(CoreError::from)?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(CoreError::from)?;
    migrate(&connection)?;
    Ok(connection)
}

fn migrate(connection: &Connection) -> CoreResult<()> {
    connection
        .execute_batch(
            r#"
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS bookmarks (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            folder TEXT NOT NULL DEFAULT 'Bookmarks',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_bookmarks_folder ON bookmarks(folder);
        CREATE INDEX IF NOT EXISTS idx_bookmarks_updated ON bookmarks(updated_at DESC);

        CREATE TABLE IF NOT EXISTS history (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            last_visited_at TEXT NOT NULL,
            visit_count INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_history_visited ON history(last_visited_at DESC);
        CREATE INDEX IF NOT EXISTS idx_history_url ON history(url);

        CREATE TABLE IF NOT EXISTS downloads (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            filename TEXT NOT NULL,
            path TEXT NOT NULL,
            state TEXT NOT NULL,
            received_bytes INTEGER NOT NULL DEFAULT 0,
            total_bytes INTEGER NOT NULL DEFAULT -1,
            danger INTEGER NOT NULL DEFAULT 0,
            started_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_downloads_started ON downloads(started_at DESC);

        CREATE TABLE IF NOT EXISTS extensions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            version TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            enabled INTEGER NOT NULL DEFAULT 1,
            installed_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workspace (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
        )
        .map_err(CoreError::from)?;

    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(CoreError::from)?;
    if version < 1 {
        connection
            .pragma_update(None, "user_version", 1)
            .map_err(CoreError::from)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn creates_schema_and_reopens() {
        let dir = tempdir().unwrap();
        {
            let connection = open(dir.path()).unwrap();
            let count: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='bookmarks'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1);
        }
        open(dir.path()).unwrap();
    }
}
