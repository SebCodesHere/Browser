use crate::error::CoreResult;
use crate::navigation;
use crate::storage::timestamp_now;
use rusqlite::{params, Connection};
use serde::Serialize;
use uuid::Uuid;

const MAX_TITLE: usize = 300;
const MAX_HISTORY_ROWS: i64 = 20_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub url: String,
    pub title: String,
    pub last_visited_at: String,
    pub visit_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub entries: Vec<HistoryEntry>,
    pub total: i64,
}

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryEntry> {
    Ok(HistoryEntry {
        id: row.get(0)?,
        url: row.get(1)?,
        title: row.get(2)?,
        last_visited_at: row.get(3)?,
        visit_count: row.get(4)?,
    })
}

pub fn add(connection: &Connection, url: &str, title: &str, private: bool) -> CoreResult<bool> {
    if private {
        return Ok(false);
    }
    if url.starts_with("xuvon://") {
        return Ok(false);
    }
    let parsed = navigation::validate_web_url(url)?;
    let normalized_url = parsed.to_string();
    let title = normalize_title(title, parsed.host_str().unwrap_or("Untitled"));

    let now = timestamp_now();
    connection.execute(
        "INSERT INTO history (id, url, title, last_visited_at, visit_count)
         VALUES (?1, ?2, ?3, ?4, 1)
         ON CONFLICT(url) DO UPDATE SET
             title = CASE WHEN excluded.title = excluded.url THEN history.title ELSE excluded.title END,
             last_visited_at = excluded.last_visited_at,
             visit_count = history.visit_count + 1",
        params![Uuid::new_v4().to_string(), normalized_url, title, now],
    )?;

    // Bound the local history table without deleting bookmarks or settings.
    connection.execute(
        "DELETE FROM history WHERE id IN (
            SELECT id FROM history ORDER BY last_visited_at DESC LIMIT -1 OFFSET ?1
         )",
        params![MAX_HISTORY_ROWS],
    )?;
    Ok(true)
}

pub fn update_title(connection: &Connection, url: &str, title: &str) -> CoreResult<bool> {
    if url.starts_with("xuvon://") {
        return Ok(false);
    }
    let parsed = match navigation::validate_web_url(url) {
        Ok(value) => value,
        Err(_) => return Ok(false),
    };
    let title = normalize_title(title, parsed.host_str().unwrap_or("Untitled"));
    let changed = connection.execute(
        "UPDATE history SET title = ?1 WHERE url = ?2",
        params![title, parsed.to_string()],
    )?;
    Ok(changed > 0)
}

pub fn list(
    connection: &Connection,
    query: &str,
    limit: u32,
    offset: u32,
) -> CoreResult<HistoryPage> {
    let limit = limit.clamp(1, 500) as i64;
    let offset = offset as i64;
    let query = query.trim();
    let like = format!("%{query}%");
    let total: i64 = connection.query_row(
        "SELECT COUNT(*) FROM history WHERE (?1 = '' OR title LIKE ?2 OR url LIKE ?2)",
        params![query, like],
        |row| row.get(0),
    )?;
    let mut statement = connection.prepare(
        "SELECT id, url, title, last_visited_at, visit_count
         FROM history
         WHERE (?1 = '' OR title LIKE ?2 OR url LIKE ?2)
         ORDER BY last_visited_at DESC
         LIMIT ?3 OFFSET ?4",
    )?;
    let entries = statement
        .query_map(params![query, like, limit, offset], row_to_entry)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(HistoryPage { entries, total })
}

pub fn top_sites(connection: &Connection, limit: u32) -> CoreResult<Vec<HistoryEntry>> {
    let limit = limit.clamp(1, 24) as i64;
    let mut statement = connection.prepare(
        "SELECT id, url, title, last_visited_at, visit_count
         FROM history
         ORDER BY visit_count DESC, last_visited_at DESC
         LIMIT ?1",
    )?;
    let entries = statement
        .query_map(params![limit], row_to_entry)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(entries)
}

pub fn delete(connection: &Connection, id: &str) -> CoreResult<bool> {
    let changed = connection.execute("DELETE FROM history WHERE id = ?1", params![id])?;
    Ok(changed > 0)
}

pub fn clear(connection: &Connection) -> CoreResult<()> {
    connection.execute("DELETE FROM history", [])?;
    Ok(())
}

fn normalize_title(title: &str, fallback: &str) -> String {
    let trimmed = title.trim();
    let value = if trimmed.is_empty() || trimmed == "Untitled" {
        fallback
    } else {
        trimmed
    };
    value.chars().take(MAX_TITLE).collect()
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
    fn tracks_visits_and_updates_titles() {
        let (_dir, connection) = database();
        assert!(add(&connection, "https://example.com/a", "Example", false).unwrap());
        assert!(add(&connection, "https://example.com/a", "Example", false).unwrap());
        let page = list(&connection, "", 20, 0).unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.entries[0].visit_count, 2);

        update_title(&connection, "https://example.com/a", "New title").unwrap();
        let page = list(&connection, "new", 20, 0).unwrap();
        assert_eq!(page.entries.len(), 1);
        assert_eq!(page.entries[0].title, "New title");
    }

    #[test]
    fn private_and_internal_visits_are_not_recorded() {
        let (_dir, connection) = database();
        assert!(!add(&connection, "https://example.com", "Example", true).unwrap());
        assert!(!add(&connection, "xuvon://settings", "Settings", false).unwrap());
        assert_eq!(list(&connection, "", 20, 0).unwrap().total, 0);
    }

    #[test]
    fn search_clear_and_delete() {
        let (_dir, connection) = database();
        add(&connection, "https://a.example", "Alpha", false).unwrap();
        add(&connection, "https://b.example", "Beta", false).unwrap();
        let found = list(&connection, "alp", 20, 0).unwrap();
        assert_eq!(found.total, 1);
        assert!(delete(&connection, &found.entries[0].id).unwrap());
        assert_eq!(list(&connection, "", 20, 0).unwrap().total, 1);
        clear(&connection).unwrap();
        assert_eq!(list(&connection, "", 20, 0).unwrap().total, 0);
    }

    #[test]
    fn rejects_onion_history() {
        let (_dir, connection) = database();
        assert!(add(&connection, "https://secret.onion", "Secret", false).is_err());
    }

    #[test]
    fn top_sites_order_by_visits() {
        let (_dir, connection) = database();
        add(&connection, "https://a.example", "A", false).unwrap();
        add(&connection, "https://b.example", "B", false).unwrap();
        add(&connection, "https://b.example", "B", false).unwrap();
        let sites = top_sites(&connection, 8).unwrap();
        assert_eq!(sites[0].url, "https://b.example/");
    }
}
