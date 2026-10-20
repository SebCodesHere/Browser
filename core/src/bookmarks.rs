use crate::error::{CoreError, CoreResult};
use crate::navigation;
use crate::storage::timestamp_now;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const MAX_TITLE: usize = 300;
const MAX_FOLDER: usize = 120;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: String,
    pub url: String,
    pub title: String,
    pub folder: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkFolder {
    pub name: String,
    pub count: i64,
}

fn row_to_bookmark(row: &rusqlite::Row<'_>) -> rusqlite::Result<Bookmark> {
    Ok(Bookmark {
        id: row.get(0)?,
        url: row.get(1)?,
        title: row.get(2)?,
        folder: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

pub fn list(
    connection: &Connection,
    query: &str,
    folder: Option<&str>,
) -> CoreResult<Vec<Bookmark>> {
    let query = query.trim();
    let like = format!("%{query}%");
    let folder = folder.unwrap_or("").trim();
    let mut statement = connection.prepare(
        "SELECT id, url, title, folder, created_at, updated_at
         FROM bookmarks
         WHERE (?1 = '' OR title LIKE ?2 OR url LIKE ?2)
           AND (?3 = '' OR folder = ?3)
         ORDER BY updated_at DESC
         LIMIT 1000",
    )?;
    let rows = statement
        .query_map(params![query, like, folder], row_to_bookmark)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn find_by_url(connection: &Connection, url: &str) -> CoreResult<Option<Bookmark>> {
    let bookmark = connection
        .query_row(
            "SELECT id, url, title, folder, created_at, updated_at FROM bookmarks WHERE url = ?1",
            params![url],
            row_to_bookmark,
        )
        .optional()?;
    Ok(bookmark)
}

pub fn create(
    connection: &Connection,
    url: &str,
    title: &str,
    folder: Option<&str>,
) -> CoreResult<(Bookmark, bool)> {
    let parsed = navigation::validate_web_url(url)?;
    let normalized_url = parsed.to_string();
    let folder = normalize_folder(folder);
    let title = normalize_title(title, parsed.host_str().unwrap_or("Bookmark"))?;

    if let Some(existing) = find_by_url(connection, &normalized_url)? {
        let updated = update(connection, &existing.id, Some(&title), None, Some(&folder))?;
        return Ok((updated, false));
    }

    let id = Uuid::new_v4().to_string();
    let now = timestamp_now();
    connection.execute(
        "INSERT INTO bookmarks (id, url, title, folder, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, normalized_url, title, folder, now],
    )?;
    let bookmark = connection.query_row(
        "SELECT id, url, title, folder, created_at, updated_at FROM bookmarks WHERE id = ?1",
        params![id],
        row_to_bookmark,
    )?;
    Ok((bookmark, true))
}

pub fn update(
    connection: &Connection,
    id: &str,
    title: Option<&str>,
    url: Option<&str>,
    folder: Option<&str>,
) -> CoreResult<Bookmark> {
    let existing = connection
        .query_row(
            "SELECT id, url, title, folder, created_at, updated_at FROM bookmarks WHERE id = ?1",
            params![id],
            row_to_bookmark,
        )
        .optional()?
        .ok_or_else(|| CoreError::not_found("Bookmark not found"))?;

    let next_url = match url {
        Some(value) if !value.trim().is_empty() => navigation::validate_web_url(value)?.to_string(),
        _ => existing.url.clone(),
    };
    if connection
        .query_row(
            "SELECT id FROM bookmarks WHERE url = ?1 AND id <> ?2",
            params![next_url, id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .is_some()
    {
        return Err(CoreError::new(
            "conflict",
            "Another bookmark already uses this address",
        ));
    }

    let next_title = match title {
        Some(value) => normalize_title(value, "Bookmark")?,
        None => existing.title,
    };
    let next_folder = match folder {
        Some(value) => normalize_folder(Some(value)),
        None => existing.folder,
    };
    let now = timestamp_now();
    connection.execute(
        "UPDATE bookmarks SET url = ?1, title = ?2, folder = ?3, updated_at = ?4 WHERE id = ?5",
        params![next_url, next_title, next_folder, now, id],
    )?;
    connection
        .query_row(
            "SELECT id, url, title, folder, created_at, updated_at FROM bookmarks WHERE id = ?1",
            params![id],
            row_to_bookmark,
        )
        .map_err(CoreError::from)
}

pub fn delete(connection: &Connection, id: &str) -> CoreResult<bool> {
    let changed = connection.execute("DELETE FROM bookmarks WHERE id = ?1", params![id])?;
    Ok(changed > 0)
}

pub fn folders(connection: &Connection) -> CoreResult<Vec<BookmarkFolder>> {
    let mut statement = connection.prepare(
        "SELECT folder, COUNT(*) FROM bookmarks GROUP BY folder ORDER BY folder COLLATE NOCASE",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok(BookmarkFolder {
                name: row.get(0)?,
                count: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn normalize_title(title: &str, fallback: &str) -> CoreResult<String> {
    let trimmed = title.trim();
    let value = if trimmed.is_empty() {
        fallback
    } else {
        trimmed
    };
    if value.chars().count() > MAX_TITLE {
        return Err(CoreError::invalid_params("Bookmark title is too long"));
    }
    Ok(value.to_string())
}

fn normalize_folder(folder: Option<&str>) -> String {
    let value = folder.unwrap_or("").trim();
    let value = if value.is_empty() { "Bookmarks" } else { value };
    value.chars().take(MAX_FOLDER).collect()
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
    fn create_update_search_delete() {
        let (_dir, connection) = database();
        let (bookmark, created) = create(
            &connection,
            "https://example.com/docs",
            "Example Docs",
            Some("Work"),
        )
        .unwrap();
        assert!(created);
        assert_eq!(bookmark.folder, "Work");

        let (again, created) = create(
            &connection,
            "https://example.com/docs",
            "Updated Docs",
            Some("Reading"),
        )
        .unwrap();
        assert!(!created);
        assert_eq!(again.title, "Updated Docs");
        assert_eq!(again.folder, "Reading");

        let found = list(&connection, "updated", None).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(folders(&connection).unwrap()[0].count, 1);

        let updated = update(
            &connection,
            &bookmark.id,
            Some("Docs"),
            None,
            Some("Reference"),
        )
        .unwrap();
        assert_eq!(updated.folder, "Reference");
        assert!(delete(&connection, &bookmark.id).unwrap());
        assert!(list(&connection, "", None).unwrap().is_empty());
    }

    #[test]
    fn rejects_non_web_and_onion_urls() {
        let (_dir, connection) = database();
        assert!(create(&connection, "file:///etc/passwd", "No", None).is_err());
        assert!(create(&connection, "https://hidden.onion", "No", None).is_err());
    }

    #[test]
    fn rejects_duplicate_url_on_update() {
        let (_dir, connection) = database();
        let (first, _) = create(&connection, "https://a.example", "A", None).unwrap();
        let (_second, _) = create(&connection, "https://b.example", "B", None).unwrap();
        let result = update(
            &connection,
            &first.id,
            None,
            Some("https://b.example"),
            None,
        );
        assert_eq!(result.unwrap_err().code, "conflict");
    }
}
