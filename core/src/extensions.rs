use crate::error::{CoreError, CoreResult};
use crate::storage::timestamp_now;
use rusqlite::{params, Connection};
use serde::Serialize;

const MAX_TEXT: usize = 300;
const MAX_PATH: usize = 4096;

/// Registry of locally installed, unpacked extensions.
///
/// Xuvon delegates extension execution to the Chromium runtime in the Electron
/// host. This module records which directories the user has trusted so the host
/// can load them again after a restart, and it stores no extension content.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionRecord {
    pub id: String,
    pub name: String,
    pub version: String,
    pub path: String,
    pub enabled: bool,
    pub installed_at: String,
}

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<ExtensionRecord> {
    Ok(ExtensionRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        version: row.get(2)?,
        path: row.get(3)?,
        enabled: row.get::<_, i64>(4)? != 0,
        installed_at: row.get(5)?,
    })
}

pub fn list(connection: &Connection) -> CoreResult<Vec<ExtensionRecord>> {
    let mut statement = connection.prepare(
        "SELECT id, name, version, path, enabled, installed_at FROM extensions ORDER BY installed_at DESC",
    )?;
    let records = statement
        .query_map([], row_to_record)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(records)
}

pub fn upsert(
    connection: &Connection,
    id: &str,
    name: &str,
    version: &str,
    path: &str,
    enabled: bool,
) -> CoreResult<ExtensionRecord> {
    validate(id, 191, "Extension id")?;
    validate(name, MAX_TEXT, "Extension name")?;
    validate(version, 64, "Extension version")?;
    validate(path, MAX_PATH, "Extension path")?;

    connection.execute(
        "DELETE FROM extensions WHERE id = ?1 OR path = ?2",
        params![id, path],
    )?;
    let now = timestamp_now();
    connection.execute(
        "INSERT INTO extensions (id, name, version, path, enabled, installed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, name, version, path, i64::from(enabled), now],
    )?;
    connection
        .query_row(
            "SELECT id, name, version, path, enabled, installed_at FROM extensions WHERE path = ?1",
            params![path],
            row_to_record,
        )
        .map_err(CoreError::from)
}

pub fn set_enabled(
    connection: &Connection,
    id: &str,
    enabled: bool,
) -> CoreResult<ExtensionRecord> {
    let changed = connection.execute(
        "UPDATE extensions SET enabled = ?1 WHERE id = ?2",
        params![i64::from(enabled), id],
    )?;
    if changed == 0 {
        return Err(CoreError::not_found("Extension not found"));
    }
    connection
        .query_row(
            "SELECT id, name, version, path, enabled, installed_at FROM extensions WHERE id = ?1",
            params![id],
            row_to_record,
        )
        .map_err(CoreError::from)
}

pub fn remove(connection: &Connection, id: &str) -> CoreResult<bool> {
    let changed = connection.execute("DELETE FROM extensions WHERE id = ?1", params![id])?;
    Ok(changed > 0)
}

fn validate(value: &str, max: usize, label: &str) -> CoreResult<()> {
    if value.trim().is_empty() {
        return Err(CoreError::invalid_params(format!("{label} is required")));
    }
    if value.chars().count() > max {
        return Err(CoreError::invalid_params(format!("{label} is too long")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::open;
    use tempfile::tempdir;

    #[test]
    fn registry_lifecycle() {
        let dir = tempdir().unwrap();
        let connection = open(dir.path()).unwrap();
        let record = upsert(
            &connection,
            "abc",
            "Reader",
            "1.0",
            "/extensions/reader",
            true,
        )
        .unwrap();
        assert!(record.enabled);
        assert_eq!(list(&connection).unwrap().len(), 1);

        let disabled = set_enabled(&connection, "abc", false).unwrap();
        assert!(!disabled.enabled);
        assert!(remove(&connection, "abc").unwrap());
        assert!(list(&connection).unwrap().is_empty());
    }
}
