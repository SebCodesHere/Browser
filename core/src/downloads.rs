use crate::error::{CoreError, CoreResult};
use crate::storage::timestamp_now;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const MAX_FILENAME: usize = 255;
const MAX_PATH: usize = 4096;
const MAX_URL: usize = 8192;
const MAX_ERROR: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadState {
    Progressing,
    Paused,
    Completed,
    Cancelled,
    Interrupted,
}

impl DownloadState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Progressing => "progressing",
            Self::Paused => "paused",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
            Self::Interrupted => "interrupted",
        }
    }

    pub fn parse(value: &str) -> CoreResult<Self> {
        match value {
            "progressing" => Ok(Self::Progressing),
            "paused" => Ok(Self::Paused),
            "completed" => Ok(Self::Completed),
            "cancelled" => Ok(Self::Cancelled),
            "interrupted" => Ok(Self::Interrupted),
            _ => Err(CoreError::invalid_params("Unknown download state")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecord {
    pub id: String,
    pub url: String,
    pub filename: String,
    pub path: String,
    pub state: DownloadState,
    pub received_bytes: i64,
    pub total_bytes: i64,
    pub danger: bool,
    pub started_at: String,
    pub updated_at: String,
    pub error: Option<String>,
}

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<DownloadRecord> {
    let state: String = row.get(4)?;
    Ok(DownloadRecord {
        id: row.get(0)?,
        url: row.get(1)?,
        filename: row.get(2)?,
        path: row.get(3)?,
        state: DownloadState::parse(&state).unwrap_or(DownloadState::Interrupted),
        received_bytes: row.get(5)?,
        total_bytes: row.get(6)?,
        danger: row.get::<_, i64>(7)? != 0,
        started_at: row.get(8)?,
        updated_at: row.get(9)?,
        error: row.get(10)?,
    })
}

pub fn create(
    connection: &Connection,
    id: &str,
    url: &str,
    filename: &str,
    path: &str,
    total_bytes: i64,
    danger: bool,
) -> CoreResult<DownloadRecord> {
    validate_short(id, 128, "Download id")?;
    validate_short(url, MAX_URL, "Download URL")?;
    validate_short(filename, MAX_FILENAME, "Download filename")?;
    validate_short(path, MAX_PATH, "Download path")?;
    let now = timestamp_now();
    connection.execute(
        "INSERT INTO downloads
            (id, url, filename, path, state, received_bytes, total_bytes, danger, started_at, updated_at, error)
         VALUES (?1, ?2, ?3, ?4, 'progressing', 0, ?5, ?6, ?7, ?7, NULL)
         ON CONFLICT(id) DO NOTHING",
        params![id, url, filename, path, total_bytes, i64::from(danger), now],
    )?;
    get(connection, id)?.ok_or_else(|| CoreError::internal("Download record was not created"))
}

pub fn get(connection: &Connection, id: &str) -> CoreResult<Option<DownloadRecord>> {
    let record = connection
        .query_row(
            "SELECT id, url, filename, path, state, received_bytes, total_bytes, danger,
                    started_at, updated_at, error
             FROM downloads WHERE id = ?1",
            params![id],
            row_to_record,
        )
        .optional()?;
    Ok(record)
}

pub fn list(connection: &Connection, limit: u32) -> CoreResult<Vec<DownloadRecord>> {
    let limit = limit.clamp(1, 500) as i64;
    let mut statement = connection.prepare(
        "SELECT id, url, filename, path, state, received_bytes, total_bytes, danger,
                started_at, updated_at, error
         FROM downloads ORDER BY started_at DESC LIMIT ?1",
    )?;
    let records = statement
        .query_map(params![limit], row_to_record)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(records)
}

pub fn update(
    connection: &Connection,
    id: &str,
    state: Option<DownloadState>,
    received_bytes: Option<i64>,
    total_bytes: Option<i64>,
    error: Option<&str>,
) -> CoreResult<DownloadRecord> {
    let existing =
        get(connection, id)?.ok_or_else(|| CoreError::not_found("Download not found"))?;
    let next_state = state.unwrap_or(existing.state);
    let received = received_bytes.unwrap_or(existing.received_bytes).max(0);
    let total = total_bytes.unwrap_or(existing.total_bytes);
    let error = error
        .map(|value| value.chars().take(MAX_ERROR).collect::<String>())
        .or(existing.error);
    let now = timestamp_now();
    connection.execute(
        "UPDATE downloads SET state = ?1, received_bytes = ?2, total_bytes = ?3,
                updated_at = ?4, error = ?5 WHERE id = ?6",
        params![next_state.as_str(), received, total, now, error, id],
    )?;
    get(connection, id)?.ok_or_else(|| CoreError::not_found("Download not found"))
}

pub fn delete(connection: &Connection, id: &str) -> CoreResult<bool> {
    let changed = connection.execute("DELETE FROM downloads WHERE id = ?1", params![id])?;
    Ok(changed > 0)
}

pub fn clear_finished(connection: &Connection) -> CoreResult<usize> {
    let changed = connection.execute(
        "DELETE FROM downloads WHERE state IN ('completed', 'cancelled', 'interrupted')",
        [],
    )?;
    Ok(changed)
}

fn validate_short(value: &str, max: usize, label: &str) -> CoreResult<()> {
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

    fn database() -> (tempfile::TempDir, Connection) {
        let dir = tempdir().unwrap();
        let connection = open(dir.path()).unwrap();
        (dir, connection)
    }

    #[test]
    fn lifecycle() {
        let (_dir, connection) = database();
        let record = create(
            &connection,
            "dl-1",
            "https://example.com/file.zip",
            "file.zip",
            "/tmp/file.zip",
            1024,
            false,
        )
        .unwrap();
        assert_eq!(record.state, DownloadState::Progressing);

        let updated = update(
            &connection,
            "dl-1",
            Some(DownloadState::Completed),
            Some(1024),
            Some(1024),
            None,
        )
        .unwrap();
        assert_eq!(updated.state, DownloadState::Completed);
        assert_eq!(list(&connection, 10).unwrap().len(), 1);
        assert_eq!(clear_finished(&connection).unwrap(), 1);
        assert!(list(&connection, 10).unwrap().is_empty());
    }

    #[test]
    fn interrupted_with_error() {
        let (_dir, connection) = database();
        create(
            &connection,
            "dl-2",
            "https://example.com/a",
            "a",
            "/tmp/a",
            -1,
            true,
        )
        .unwrap();
        let updated = update(
            &connection,
            "dl-2",
            Some(DownloadState::Interrupted),
            None,
            None,
            Some("Network error"),
        )
        .unwrap();
        assert!(updated.danger);
        assert_eq!(updated.error.as_deref(), Some("Network error"));
    }

    #[test]
    fn rejects_unknown_state() {
        assert!(DownloadState::parse("running").is_err());
    }
}
