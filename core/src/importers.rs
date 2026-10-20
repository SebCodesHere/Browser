use crate::error::{CoreError, CoreResult};
use crate::navigation;
use crate::settings::StartupBehavior;
use plist::Value as PlistValue;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

const MAX_TEXT_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_IMPORTED_BOOKMARKS: usize = 10_000;
const MAX_RAW_BOOKMARKS: usize = 50_000;
const MAX_PATH_CHARS: usize = 4096;
const MAX_URL_CHARS: usize = 8192;
const MAX_FOLDER_CHARS: usize = 120;
const MAX_TITLE_CHARS: usize = 300;
const PREVIEW_SAMPLE_SIZE: usize = 5;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkSample {
    pub title: String,
    pub url: String,
    pub folder: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkPreview {
    pub count: usize,
    pub folder_count: usize,
    pub invalid: usize,
    pub duplicates: usize,
    pub sample: Vec<BookmarkSample>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPreview {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub startup_behavior: Option<StartupBehavior>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub format: String,
    pub bookmarks: Option<BookmarkPreview>,
    pub settings: Option<SettingsPreview>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCommitResult {
    pub imported: usize,
    pub skipped: usize,
    pub invalid: usize,
    pub folders: usize,
}

#[derive(Debug, Clone)]
struct RawBookmark {
    url: String,
    title: String,
    folder: String,
}

#[derive(Debug, Clone)]
struct ParsedBookmarks {
    format: &'static str,
    bookmarks: Vec<ImportedBookmark>,
    invalid: usize,
    duplicates: usize,
}

#[derive(Debug, Clone)]
struct ImportedBookmark {
    url: String,
    title: String,
    folder: String,
}

#[derive(Debug, Clone)]
struct ParsedSettings {
    format: &'static str,
    settings: SettingsPreview,
}

#[derive(Debug, Clone)]
enum PrefValue {
    String(String),
    Integer(i64),
    Bool,
}

/// Parse and summarize bookmark/settings files without writing anything.
pub fn preview(
    bookmarks_path: Option<&str>,
    settings_path: Option<&str>,
) -> CoreResult<ImportPreview> {
    if bookmarks_path.is_none() && settings_path.is_none() {
        return Err(CoreError::invalid_params(
            "Choose a bookmarks file, a settings file, or a browser profile folder.",
        ));
    }

    let mut warnings = Vec::new();
    let mut formats = Vec::new();
    let mut bookmarks = None;
    let mut settings = None;

    if let Some(raw_path) = bookmarks_path {
        let path = checked_file(raw_path, "bookmarks")?;
        match parse_bookmarks(&path) {
            Ok(parsed) => {
                formats.push(parsed.format);
                let folder_count = parsed
                    .bookmarks
                    .iter()
                    .map(|bookmark| bookmark.folder.as_str())
                    .collect::<HashSet<_>>()
                    .len();
                let sample = parsed
                    .bookmarks
                    .iter()
                    .take(PREVIEW_SAMPLE_SIZE)
                    .map(|bookmark| BookmarkSample {
                        title: bookmark.title.clone(),
                        url: bookmark.url.clone(),
                        folder: bookmark.folder.clone(),
                    })
                    .collect();
                bookmarks = Some(BookmarkPreview {
                    count: parsed.bookmarks.len(),
                    folder_count,
                    invalid: parsed.invalid,
                    duplicates: parsed.duplicates,
                    sample,
                });
            }
            Err(error) => warnings.push(format!("Bookmarks could not be read: {}", error.message)),
        }
    }

    if let Some(raw_path) = settings_path {
        let path = checked_file(raw_path, "settings")?;
        match parse_settings(&path) {
            Ok(parsed) => {
                formats.push(parsed.format);
                settings = Some(parsed.settings);
            }
            Err(error) => warnings.push(format!("Settings could not be read: {}", error.message)),
        }
    }

    if bookmarks.is_none() && settings.is_none() {
        return Err(CoreError::new(
            "import_failed",
            warnings
                .first()
                .cloned()
                .unwrap_or_else(|| "No supported browser data could be read.".into()),
        ));
    }

    let mut unique_formats = formats;
    unique_formats.sort_unstable();
    unique_formats.dedup();
    let format = match unique_formats.as_slice() {
        [] => "unknown",
        [single] => single,
        _ => "mixed",
    }
    .to_string();

    Ok(ImportPreview {
        format,
        bookmarks,
        settings,
        warnings,
    })
}

/// Copy bookmarks into SQLite. Existing URLs are left untouched, not updated.
pub fn import_bookmarks(
    connection: &mut Connection,
    bookmarks_path: &str,
) -> CoreResult<ImportCommitResult> {
    let path = checked_file(bookmarks_path, "bookmarks")?;
    let parsed = parse_bookmarks(&path)?;
    let transaction = connection.transaction()?;
    let mut imported = 0;
    let mut skipped = 0;
    let mut folders = HashSet::new();

    for bookmark in parsed.bookmarks {
        if crate::bookmarks::find_by_url(&transaction, &bookmark.url)?.is_some() {
            skipped += 1;
            continue;
        }
        let (_, created) = crate::bookmarks::create(
            &transaction,
            &bookmark.url,
            &bookmark.title,
            Some(&bookmark.folder),
        )?;
        if created {
            imported += 1;
            folders.insert(bookmark.folder);
        } else {
            skipped += 1;
        }
    }
    transaction.commit()?;

    Ok(ImportCommitResult {
        imported,
        skipped,
        invalid: parsed.invalid,
        folders: folders.len(),
    })
}

fn checked_file(raw_path: &str, label: &str) -> CoreResult<PathBuf> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err(CoreError::invalid_params(format!("Choose a {label} file.")));
    }
    if trimmed.chars().count() > MAX_PATH_CHARS || trimmed.contains('\0') {
        return Err(CoreError::invalid_params("That file path is not valid."));
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(CoreError::invalid_params(
            "Choose the file through the system file dialog.",
        ));
    }
    let metadata = fs::metadata(&path).map_err(|error| {
        CoreError::invalid_params(format!("The {label} file could not be opened: {error}"))
    })?;
    if !metadata.is_file() {
        return Err(CoreError::invalid_params(format!(
            "The selected {label} location is not a file."
        )));
    }
    Ok(path)
}

fn read_text_file(path: &Path) -> CoreResult<String> {
    let metadata = fs::metadata(path).map_err(|error| {
        CoreError::invalid_params(format!("The file could not be read: {error}"))
    })?;
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err(CoreError::invalid_params(
            "That browser data file is larger than 64 MB.",
        ));
    }
    fs::read_to_string(path)
        .map_err(|error| CoreError::invalid_params(format!("The file could not be read: {error}")))
}

fn parse_bookmarks(path: &Path) -> CoreResult<ParsedBookmarks> {
    let (format, raw) = match bookmark_format(path)? {
        "chromium" => {
            let raw = read_text_file(path)?;
            ("chromium", parse_chromium_bookmarks(&raw)?)
        }
        "firefox" => ("firefox", parse_firefox_bookmarks(path)?),
        "safari" => ("safari", parse_safari_bookmarks(path)?),
        "html" => {
            let raw = read_text_file(path)?;
            ("html", parse_netscape_html(&raw)?)
        }
        _ => {
            return Err(CoreError::invalid_params(
                "This file does not look like a supported bookmarks file.",
            ))
        }
    };
    let (bookmarks, invalid, duplicates) = finalize_bookmarks(raw);
    Ok(ParsedBookmarks {
        format,
        bookmarks,
        invalid,
        duplicates,
    })
}

fn parse_settings(path: &Path) -> CoreResult<ParsedSettings> {
    match settings_format(path)? {
        "chromium" => {
            let raw = read_text_file(path)?;
            Ok(ParsedSettings {
                format: "chromium",
                settings: parse_chromium_settings(&raw)?,
            })
        }
        "firefox" => {
            let raw = read_text_file(path)?;
            Ok(ParsedSettings {
                format: "firefox",
                settings: parse_firefox_settings(&raw),
            })
        }
        "safari" => Ok(ParsedSettings {
            format: "safari",
            settings: parse_safari_settings(path)?,
        }),
        _ => Err(CoreError::invalid_params(
            "This file does not look like a supported settings file.",
        )),
    }
}

fn bookmark_format(path: &Path) -> CoreResult<&'static str> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if name == "places.sqlite" || matches!(extension.as_str(), "sqlite" | "sqlite3" | "db") {
        return Ok("firefox");
    }
    if name == "bookmarks.plist" || extension == "plist" {
        return Ok("safari");
    }
    if name == "bookmarks" {
        return Ok("chromium");
    }
    if matches!(extension.as_str(), "html" | "htm" | "xhtml") {
        return Ok("html");
    }
    if extension == "json" {
        return Ok("chromium");
    }

    let bytes = fs::read(path).map_err(|error| {
        CoreError::invalid_params(format!("The file could not be read: {error}"))
    })?;
    let head = &bytes[..bytes.len().min(4096)];
    if head.starts_with(b"SQLite format 3\0") {
        return Ok("firefox");
    }
    if head.starts_with(b"bplist00") || head.starts_with(b"<?xml") {
        if head
            .windows(7)
            .any(|window| window.eq_ignore_ascii_case(b"<plist"))
            || head.starts_with(b"bplist00")
        {
            return Ok("safari");
        }
    }
    let text = String::from_utf8_lossy(head).to_ascii_lowercase();
    if text.contains("<dl") || text.contains("<a ") || text.contains("<!doctype netscape") {
        return Ok("html");
    }
    if text.trim_start().starts_with('{') {
        return Ok("chromium");
    }
    Err(CoreError::invalid_params(
        "This file does not look like a supported bookmarks file.",
    ))
}

fn settings_format(path: &Path) -> CoreResult<&'static str> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if name == "preferences" || extension == "json" {
        return Ok("chromium");
    }
    if name == "prefs.js" {
        return Ok("firefox");
    }
    if extension == "plist" || name.ends_with(".safari.plist") {
        return Ok("safari");
    }

    let bytes = fs::read(path).map_err(|error| {
        CoreError::invalid_params(format!("The file could not be read: {error}"))
    })?;
    let head = &bytes[..bytes.len().min(4096)];
    if head.starts_with(b"bplist00") {
        return Ok("safari");
    }
    let text = String::from_utf8_lossy(head);
    if text.contains("user_pref(") {
        return Ok("firefox");
    }
    if text.trim_start().starts_with('{') {
        return Ok("chromium");
    }
    if text.trim_start().starts_with("<?xml") && text.contains("<plist") {
        return Ok("safari");
    }
    Err(CoreError::invalid_params(
        "This file does not look like a supported settings file.",
    ))
}

fn finalize_bookmarks(raw: Vec<RawBookmark>) -> (Vec<ImportedBookmark>, usize, usize) {
    let mut bookmarks = Vec::new();
    let mut seen = HashSet::new();
    let mut invalid = 0;
    let mut duplicates = 0;

    for item in raw.into_iter().take(MAX_RAW_BOOKMARKS) {
        if item.url.chars().count() > MAX_URL_CHARS {
            invalid += 1;
            continue;
        }
        let Ok(url) = navigation::validate_web_url(&item.url) else {
            invalid += 1;
            continue;
        };
        let normalized = url.to_string();
        if !seen.insert(normalized.clone()) {
            duplicates += 1;
            continue;
        }
        if bookmarks.len() >= MAX_IMPORTED_BOOKMARKS {
            break;
        }
        let raw_title = item.title.trim();
        let title = if raw_title.is_empty() {
            url.host_str().unwrap_or("Bookmark")
        } else {
            raw_title
        };
        let title = truncate_chars(title, MAX_TITLE_CHARS);
        let folder = if item.folder.trim().is_empty() {
            "Imported bookmarks".to_string()
        } else {
            truncate_chars(item.folder.trim(), MAX_FOLDER_CHARS)
        };
        bookmarks.push(ImportedBookmark {
            url: normalized,
            title,
            folder,
        });
    }
    (bookmarks, invalid, duplicates)
}

fn truncate_chars(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn parse_chromium_bookmarks(raw: &str) -> CoreResult<Vec<RawBookmark>> {
    let value: Value = serde_json::from_str(raw).map_err(|_| {
        CoreError::invalid_params("This JSON file is not valid Chromium bookmarks.")
    })?;
    let roots = value
        .get("roots")
        .and_then(Value::as_object)
        .ok_or_else(|| CoreError::invalid_params("This JSON file is not Chromium bookmarks."))?;

    let mut keys = roots.keys().collect::<Vec<_>>();
    keys.sort_by_key(|key| match key.as_str() {
        "bookmark_bar" => 0,
        "other" => 1,
        "synced" => 2,
        _ => 3,
    });

    let mut output = Vec::new();
    for key in keys {
        let Some(root) = roots.get(key) else {
            continue;
        };
        let mut path = vec![chromium_root_label(key)];
        if let Some(children) = root.get("children").and_then(Value::as_array) {
            for child in children {
                walk_chromium_node(child, &mut path, &mut output, 0);
                if output.len() >= MAX_RAW_BOOKMARKS {
                    break;
                }
            }
        }
    }
    Ok(output)
}

fn chromium_root_label(key: &str) -> String {
    match key {
        "bookmark_bar" => "Bookmarks bar".into(),
        "other" => "Other bookmarks".into(),
        "synced" => "Mobile bookmarks".into(),
        _ => key.replace('_', " "),
    }
}

fn walk_chromium_node(
    node: &Value,
    path: &mut Vec<String>,
    output: &mut Vec<RawBookmark>,
    depth: usize,
) {
    if depth > 64 || output.len() >= MAX_RAW_BOOKMARKS {
        return;
    }
    let kind = node.get("type").and_then(Value::as_str).unwrap_or_default();
    let name = node
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();

    match kind {
        "url" => {
            let Some(url) = node.get("url").and_then(Value::as_str) else {
                return;
            };
            output.push(RawBookmark {
                url: url.to_string(),
                title: name.to_string(),
                folder: path.join(" / "),
            });
        }
        "folder" => {
            let folder_name = if name.is_empty() { "Folder" } else { name };
            path.push(folder_name.to_string());
            if let Some(children) = node.get("children").and_then(Value::as_array) {
                for child in children {
                    walk_chromium_node(child, path, output, depth + 1);
                    if output.len() >= MAX_RAW_BOOKMARKS {
                        break;
                    }
                }
            }
            path.pop();
        }
        _ => {
            if let Some(children) = node.get("children").and_then(Value::as_array) {
                for child in children {
                    walk_chromium_node(child, path, output, depth + 1);
                    if output.len() >= MAX_RAW_BOOKMARKS {
                        break;
                    }
                }
            }
        }
    }
}

fn parse_netscape_html(raw: &str) -> CoreResult<Vec<RawBookmark>> {
    let mut output = Vec::new();
    let mut folders: Vec<Option<String>> = Vec::new();
    let mut pending_folder: Option<String> = None;
    let mut heading: Option<String> = None;
    let mut link: Option<(String, String)> = None;
    let mut index = 0;

    while index < raw.len() {
        let Some(relative) = raw[index..].find('<') else {
            append_html_text(&raw[index..], heading.as_mut(), link.as_mut());
            break;
        };
        let text_end = index + relative;
        append_html_text(&raw[index..text_end], heading.as_mut(), link.as_mut());
        index = text_end;

        if raw[index..].starts_with("<!--") {
            if let Some(end) = raw[index + 4..].find("-->") {
                index += 4 + end + 3;
            } else {
                break;
            }
            continue;
        }

        let Some(end) = raw[index..].find('>') else {
            break;
        };
        let tag = &raw[index + 1..index + end];
        index += end + 1;
        let tag = tag.trim();
        if tag.is_empty() || tag.starts_with('!') || tag.starts_with('?') {
            continue;
        }

        if let Some(closing) = tag.strip_prefix('/') {
            let name = closing
                .split_whitespace()
                .next()
                .unwrap_or_default()
                .to_ascii_lowercase();
            match name.as_str() {
                "a" => {
                    if let Some((href, title)) = link.take() {
                        push_html_bookmark(&href, &title, &folders, &mut output);
                    }
                }
                "h3" => {
                    let title = heading.take().unwrap_or_default();
                    let title = decode_html_entities(title.trim());
                    pending_folder = if title.is_empty() { None } else { Some(title) };
                }
                "dl" => {
                    folders.pop();
                }
                _ => {}
            }
            continue;
        }

        let self_closing = tag.ends_with('/');
        let tag = tag.trim_end_matches('/').trim();
        let name = tag
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        match name.as_str() {
            "a" => {
                if let Some(href) = extract_attribute(tag, "href") {
                    if !href.trim().is_empty() && !href.trim_start().starts_with('#') {
                        link = Some((href, String::new()));
                    }
                }
            }
            "h3" => {
                heading = Some(String::new());
            }
            "dl" if !self_closing => {
                folders.push(pending_folder.take());
            }
            _ => {}
        }
    }

    if let Some((href, title)) = link.take() {
        push_html_bookmark(&href, &title, &folders, &mut output);
    }
    Ok(output)
}

fn append_html_text(text: &str, heading: Option<&mut String>, link: Option<&mut (String, String)>) {
    if let Some(heading) = heading {
        heading.push_str(text);
    }
    if let Some((_, title)) = link {
        title.push_str(text);
    }
}

fn push_html_bookmark(
    href: &str,
    title: &str,
    folders: &[Option<String>],
    output: &mut Vec<RawBookmark>,
) {
    let folder = folders
        .iter()
        .flatten()
        .cloned()
        .collect::<Vec<_>>()
        .join(" / ");
    output.push(RawBookmark {
        url: decode_html_entities(href.trim()),
        title: decode_html_entities(title.trim()),
        folder,
    });
}

fn extract_attribute(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let name = name.to_ascii_lowercase();
    let mut cursor = 0;
    while let Some(relative) = lower[cursor..].find(&name) {
        let start = cursor + relative;
        let before_ok = start == 0
            || lower[..start]
                .chars()
                .next_back()
                .is_some_and(|character| character.is_whitespace());
        if !before_ok {
            cursor = start + name.len();
            continue;
        }
        let mut position = start + name.len();
        while lower[position..]
            .chars()
            .next()
            .is_some_and(|character| character.is_whitespace())
        {
            position += 1;
        }
        if !lower[position..].starts_with('=') {
            cursor = start + name.len();
            continue;
        }
        position += 1;
        while lower[position..]
            .chars()
            .next()
            .is_some_and(|character| character.is_whitespace())
        {
            position += 1;
        }
        let rest = &tag[position..];
        if let Some(quote) = rest
            .chars()
            .next()
            .filter(|value| *value == '"' || *value == '\'')
        {
            let after = &rest[quote.len_utf8()..];
            let end = after.find(quote)?;
            return Some(after[..end].to_string());
        }
        let end = rest
            .find(|character: char| character.is_whitespace() || character == '>')
            .unwrap_or(rest.len());
        return Some(rest[..end].to_string());
    }
    None
}

fn decode_html_entities(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(position) = rest.find('&') {
        output.push_str(&rest[..position]);
        let after = &rest[position + 1..];
        let entity = after
            .find(';')
            .filter(|end| *end <= 12)
            .and_then(|end| decode_entity(&after[..end]).map(|decoded| (decoded, end)));
        if let Some((decoded, end)) = entity {
            output.push_str(&decoded);
            rest = &after[end + 1..];
        } else {
            output.push('&');
            rest = after;
        }
    }
    output.push_str(rest);
    output
}

fn decode_entity(entity: &str) -> Option<String> {
    let lower = entity.to_ascii_lowercase();
    let value = match lower.as_str() {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        "nbsp" => '\u{a0}',
        _ => {
            let number = if let Some(hex) = lower.strip_prefix("#x") {
                u32::from_str_radix(hex, 16).ok()
            } else if let Some(decimal) = lower.strip_prefix('#') {
                decimal.parse::<u32>().ok()
            } else {
                return None;
            };
            return number
                .and_then(char::from_u32)
                .map(|character| character.to_string());
        }
    };
    Some(value.to_string())
}

fn parse_firefox_bookmarks(path: &Path) -> CoreResult<Vec<RawBookmark>> {
    match read_firefox_database(path) {
        Ok(bookmarks) => Ok(bookmarks),
        Err(error) if is_database_lock(&error) => {
            let temporary = tempfile::tempdir().map_err(|copy_error| {
                CoreError::internal(format!(
                    "Firefox's bookmark database is locked and a temporary copy could not be created: {copy_error}"
                ))
            })?;
            let target = temporary.path().join("places.sqlite");
            fs::copy(path, &target).map_err(|copy_error| {
                CoreError::invalid_params(format!(
                    "Firefox's bookmark database is locked and could not be copied: {copy_error}"
                ))
            })?;
            for suffix in ["-wal", "-shm"] {
                let source = PathBuf::from(format!("{}{suffix}", path.to_string_lossy()));
                if source.exists() {
                    let destination =
                        PathBuf::from(format!("{}{suffix}", target.to_string_lossy()));
                    let _ = fs::copy(source, destination);
                }
            }
            read_firefox_database(&target)
        }
        Err(error) => Err(error),
    }
}

fn is_database_lock(error: &CoreError) -> bool {
    let message = error.message.to_ascii_lowercase();
    message.contains("locked")
        || message.contains("busy")
        || message.contains("readonly")
        || message.contains("unable to open database")
}

fn read_firefox_database(path: &Path) -> CoreResult<Vec<RawBookmark>> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| {
        CoreError::invalid_params(format!(
            "Firefox's bookmark database could not be opened: {error}"
        ))
    })?;
    let _ = connection.busy_timeout(Duration::from_secs(2));

    let mut statement = connection
        .prepare(
            "SELECT b.id, b.parent, b.type, b.title, p.url
             FROM moz_bookmarks b
             LEFT JOIN moz_places p ON p.id = b.fk
             WHERE b.type IN (1, 2)",
        )
        .map_err(|_| {
            CoreError::invalid_params("This SQLite file does not contain Firefox bookmarks.")
        })?;

    let rows = statement
        .query_map([], |row| {
            Ok(FirefoxNode {
                id: row.get(0)?,
                parent: row.get(1)?,
                kind: row.get(2)?,
                title: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                url: row.get(4)?,
            })
        })
        .map_err(CoreError::from)?;

    let mut nodes = HashMap::new();
    for row in rows {
        let node = row.map_err(CoreError::from)?;
        nodes.insert(node.id, node);
    }

    let mut output = Vec::new();
    for node in nodes.values() {
        if node.kind != 1 {
            continue;
        }
        let Some(url) = node.url.as_deref() else {
            continue;
        };
        if url.trim().is_empty() {
            continue;
        }
        let Some(folder) = firefox_folder_path(&nodes, node.parent) else {
            // Bookmarks filed only under the tags root are duplicates.
            continue;
        };
        output.push(RawBookmark {
            url: url.to_string(),
            title: node.title.clone(),
            folder,
        });
    }
    Ok(output)
}

struct FirefoxNode {
    id: i64,
    parent: i64,
    kind: i64,
    title: String,
    url: Option<String>,
}

fn firefox_folder_path(nodes: &HashMap<i64, FirefoxNode>, parent: i64) -> Option<String> {
    let mut parts = Vec::new();
    let mut current = parent;
    let mut seen = HashSet::new();
    while current != 0 {
        if !seen.insert(current) {
            break;
        }
        let node = nodes.get(&current)?;
        // Firefox's tag root is a view of bookmarks that already exist
        // elsewhere; importing those rows would create misleading folders.
        if current == 4 {
            return None;
        }
        if current <= 5 {
            if !node.title.trim().is_empty() {
                parts.push(node.title.trim().to_string());
            }
            break;
        }
        if node.kind == 2 && !node.title.trim().is_empty() {
            parts.push(node.title.trim().to_string());
        }
        current = node.parent;
    }
    parts.reverse();
    Some(parts.join(" / "))
}

fn parse_safari_bookmarks(path: &Path) -> CoreResult<Vec<RawBookmark>> {
    let value = read_plist(path, "Safari bookmarks")?;
    let mut output = Vec::new();
    let mut folder = Vec::new();
    walk_safari_node(&value, &mut folder, &mut output, 0);
    Ok(output)
}

fn walk_safari_node(
    value: &PlistValue,
    folder: &mut Vec<String>,
    output: &mut Vec<RawBookmark>,
    depth: usize,
) {
    if depth > 64 {
        return;
    }
    let Some(dictionary) = value.as_dictionary() else {
        return;
    };
    let kind = dictionary
        .get("WebBookmarkType")
        .and_then(PlistValue::as_string)
        .unwrap_or_default();

    match kind {
        "WebBookmarkTypeList" => {
            let title = dictionary
                .get("Title")
                .and_then(PlistValue::as_string)
                .unwrap_or_default()
                .trim();
            let pushed = !title.is_empty();
            if pushed {
                folder.push(title.to_string());
            }
            if let Some(children) = dictionary.get("Children").and_then(PlistValue::as_array) {
                for child in children {
                    walk_safari_node(child, folder, output, depth + 1);
                }
            }
            if pushed {
                folder.pop();
            }
        }
        "WebBookmarkTypeLeaf" => {
            let Some(url) = dictionary.get("URLString").and_then(PlistValue::as_string) else {
                return;
            };
            let title = dictionary
                .get("URIDictionary")
                .and_then(PlistValue::as_dictionary)
                .and_then(|dictionary| dictionary.get("title"))
                .and_then(PlistValue::as_string)
                .or_else(|| dictionary.get("Title").and_then(PlistValue::as_string))
                .unwrap_or_default();
            output.push(RawBookmark {
                url: url.to_string(),
                title: title.to_string(),
                folder: folder.join(" / "),
            });
        }
        _ => {}
    }
}

fn read_plist(path: &Path, label: &str) -> CoreResult<PlistValue> {
    PlistValue::from_file(path).map_err(|error| {
        let message = error.to_string();
        let lower = message.to_ascii_lowercase();
        if lower.contains("permission") || lower.contains("not permitted") || lower.contains("denied") {
            CoreError::invalid_params(format!(
                "macOS denied access to {label}. Grant Full Disk Access to Xuvon or export the bookmarks to HTML."
            ))
        } else {
            CoreError::invalid_params(format!("{label} could not be read: {message}"))
        }
    })
}

fn parse_chromium_settings(raw: &str) -> CoreResult<SettingsPreview> {
    let value: Value = serde_json::from_str(raw).map_err(|_| {
        CoreError::invalid_params("This JSON file is not valid Chromium Preferences.")
    })?;
    let mut notes = Vec::new();
    let homepage_is_newtab = value
        .get("homepage_is_newtabpage")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut homepage = None;

    if !homepage_is_newtab {
        if let Some(candidate) = value.get("homepage").and_then(Value::as_str) {
            let candidate = candidate.trim();
            if !candidate.is_empty() {
                match navigation::validate_web_url(candidate) {
                    Ok(url) => homepage = Some(url.to_string()),
                    Err(error) if error.code == "blocked_onion" => {
                        notes.push("An onion homepage was not imported.".into());
                    }
                    Err(_) => {
                        if !candidate.to_ascii_lowercase().starts_with("chrome://")
                            && candidate.to_ascii_lowercase() != "about:newtab"
                        {
                            notes.push(
                                "The browser's homepage uses a scheme Xuvon cannot import.".into(),
                            );
                        }
                    }
                }
            }
        }
    }

    let restore_on_startup = value
        .get("session")
        .and_then(|session| session.get("restore_on_startup"))
        .and_then(Value::as_i64);
    let startup_behavior = match restore_on_startup {
        Some(1) => Some(StartupBehavior::Restore),
        Some(4) => {
            if homepage.is_some() {
                Some(StartupBehavior::Homepage)
            } else {
                notes.push(
                    "Chrome starts with specific pages, but none could be imported as a homepage."
                        .into(),
                );
                None
            }
        }
        Some(5) => Some(StartupBehavior::Newtab),
        _ => None,
    };

    if homepage.is_none() && homepage_is_newtab {
        notes.push("Chrome is set to open its new tab page. Xuvon keeps its own new tab.".into());
    }

    Ok(SettingsPreview {
        homepage,
        startup_behavior,
        notes,
    })
}

fn parse_firefox_settings(raw: &str) -> SettingsPreview {
    let mut prefs = HashMap::new();
    for line in raw.lines() {
        if let Some((key, value)) = parse_firefox_pref(line) {
            prefs.insert(key, value);
        }
    }

    let mut notes = Vec::new();
    let mut homepage = None;
    if let Some(PrefValue::String(value)) = prefs.get("browser.startup.homepage") {
        let pages = value
            .split('|')
            .map(str::trim)
            .filter(|page| !page.is_empty())
            .collect::<Vec<_>>();
        for page in &pages {
            if let Ok(url) = navigation::validate_web_url(page) {
                homepage = Some(url.to_string());
                break;
            }
        }
        if homepage.is_none()
            && !value.trim().is_empty()
            && !value.to_ascii_lowercase().starts_with("about:")
        {
            notes.push("Firefox's homepage could not be imported as an HTTP(S) page.".into());
        } else if pages.len() > 1 && homepage.is_some() {
            notes.push(
                "Firefox opens several homepages; Xuvon imported the first HTTP(S) page.".into(),
            );
        }
    }

    let startup_behavior = match prefs.get("browser.startup.page") {
        Some(PrefValue::Integer(3)) => Some(StartupBehavior::Restore),
        Some(PrefValue::Integer(1)) => homepage.as_ref().map(|_| StartupBehavior::Homepage),
        Some(PrefValue::Integer(2)) | Some(PrefValue::Integer(0)) => Some(StartupBehavior::Newtab),
        _ => None,
    };

    SettingsPreview {
        homepage,
        startup_behavior,
        notes,
    }
}

fn parse_firefox_pref(line: &str) -> Option<(String, PrefValue)> {
    let trimmed = line.trim();
    let rest = trimmed.strip_prefix("user_pref(")?;
    let rest = rest.strip_prefix('"')?;
    let key_end = rest.find('"')?;
    let key = rest[..key_end].to_string();
    let after_key = rest[key_end + 1..].trim_start();
    let value = after_key.strip_prefix(',')?.trim();
    let value = value.strip_suffix(';').unwrap_or(value).trim();
    let value = value.strip_suffix(')').unwrap_or(value).trim();
    let parsed = if value.starts_with('"') {
        serde_json::from_str::<String>(value)
            .ok()
            .map(PrefValue::String)?
    } else if value == "true" || value == "false" {
        PrefValue::Bool
    } else {
        PrefValue::Integer(value.parse::<i64>().ok()?)
    };
    Some((key, parsed))
}

fn parse_safari_settings(path: &Path) -> CoreResult<SettingsPreview> {
    let value = read_plist(path, "Safari preferences")?;
    let mut notes = Vec::new();
    let mut homepage = None;
    if let Some(dictionary) = value.as_dictionary() {
        if let Some(candidate) = dictionary
            .get("HomePage")
            .and_then(PlistValue::as_string)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            match navigation::validate_web_url(candidate) {
                Ok(url) => homepage = Some(url.to_string()),
                Err(_) => {
                    notes.push("Safari's homepage could not be imported as an HTTP(S) page.".into())
                }
            }
        }
    } else {
        notes.push("Safari preferences did not contain a readable homepage.".into());
    }
    if homepage.is_some() {
        notes.push(
            "Safari does not expose a portable startup mode, so Xuvon left startup behavior unchanged."
                .into(),
        );
    }
    Ok(SettingsPreview {
        homepage,
        startup_behavior: None,
        notes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn parses_chromium_bookmarks_and_preferences() {
        let dir = tempdir().unwrap();
        let bookmarks_path = dir.path().join("Bookmarks");
        fs::write(
            &bookmarks_path,
            r#"{
              "roots": {
                "bookmark_bar": {
                  "type": "folder",
                  "name": "Bookmarks bar",
                  "children": [
                    {"type": "url", "name": "Example", "url": "https://example.com/"},
                    {"type": "folder", "name": "Work", "children": [
                      {"type": "url", "name": "Docs", "url": "https://example.com/docs"}
                    ]}
                  ]
                },
                "other": {"type": "folder", "name": "Other bookmarks", "children": [
                  {"type": "url", "name": "Blocked", "url": "javascript:alert(1)"},
                  {"type": "url", "name": "Onion", "url": "http://example.onion/"},
                  {"type": "url", "name": "Duplicate", "url": "https://example.com/"}
                ]}
              }
            }"#,
        )
        .unwrap();
        let parsed = parse_bookmarks(&bookmarks_path).unwrap();
        assert_eq!(parsed.format, "chromium");
        assert_eq!(parsed.bookmarks.len(), 2);
        assert_eq!(parsed.invalid, 2);
        assert_eq!(parsed.duplicates, 1);
        assert_eq!(parsed.bookmarks[1].folder, "Bookmarks bar / Work");

        let settings_path = dir.path().join("Preferences");
        fs::write(
            &settings_path,
            r#"{"homepage":"https://example.com/start","homepage_is_newtabpage":false,"session":{"restore_on_startup":4}}"#,
        )
        .unwrap();
        let settings = parse_settings(&settings_path).unwrap();
        assert_eq!(
            settings.settings.homepage.as_deref(),
            Some("https://example.com/start")
        );
        assert_eq!(
            settings.settings.startup_behavior,
            Some(StartupBehavior::Homepage)
        );
    }

    #[test]
    fn parses_netscape_html_folders_and_entities() {
        let raw = r#"<!DOCTYPE NETSCAPE-Bookmark-file-1>
        <DL><p>
          <DT><H3>Reading &amp; Research</H3>
          <DL><p>
            <DT><A HREF="https://example.com/?a=1&amp;b=2">Example &amp; Co</A>
            <DT><H3>Deep</H3>
            <DL><p>
              <DT><A HREF="https://example.org/deep">Nested &#38; nice</A>
            </DL><p>
          </DL><p>
          <DT><A HREF="javascript:alert(1)">Bad</A>
        </DL><p>"#;
        let parsed = parse_netscape_html(raw).unwrap();
        let (bookmarks, invalid, duplicates) = finalize_bookmarks(parsed);
        assert_eq!(bookmarks.len(), 2);
        assert_eq!(invalid, 1);
        assert_eq!(duplicates, 0);
        assert_eq!(bookmarks[0].url, "https://example.com/?a=1&b=2");
        assert_eq!(bookmarks[0].title, "Example & Co");
        assert_eq!(bookmarks[0].folder, "Reading & Research");
        assert_eq!(bookmarks[1].folder, "Reading & Research / Deep");
    }

    #[test]
    fn parses_firefox_places_database() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("places.sqlite");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT);
                CREATE TABLE moz_bookmarks (
                  id INTEGER PRIMARY KEY,
                  type INTEGER,
                  fk INTEGER,
                  parent INTEGER,
                  title TEXT
                );
                INSERT INTO moz_places (id, url) VALUES
                  (10, 'https://example.com/ff'),
                  (11, 'file:///private.txt');
                INSERT INTO moz_bookmarks (id, type, fk, parent, title) VALUES
                  (1, 2, NULL, 0, ''),
                  (2, 2, NULL, 1, 'Bookmarks Menu'),
                  (3, 2, NULL, 1, 'Bookmarks Toolbar'),
                  (4, 2, NULL, 1, 'Tags'),
                  (5, 2, NULL, 1, 'Other Bookmarks'),
                  (20, 2, NULL, 3, 'Zeta'),
                  (30, 1, 10, 20, 'Firefox Example'),
                  (31, 1, 11, 5, 'Private File');
                "#,
            )
            .unwrap();
        drop(connection);
        let parsed = parse_bookmarks(&path).unwrap();
        assert_eq!(parsed.bookmarks.len(), 1);
        assert_eq!(parsed.bookmarks[0].title, "Firefox Example");
        assert_eq!(parsed.bookmarks[0].folder, "Bookmarks Toolbar / Zeta");
        assert_eq!(parsed.invalid, 1);
    }

    #[test]
    fn parses_safari_binary_plist() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("Bookmarks.plist");
        let mut root = plist::Dictionary::new();
        root.insert(
            "WebBookmarkType".into(),
            PlistValue::String("WebBookmarkTypeList".into()),
        );
        root.insert("Title".into(), PlistValue::String("".into()));
        let mut folder = plist::Dictionary::new();
        folder.insert(
            "WebBookmarkType".into(),
            PlistValue::String("WebBookmarkTypeList".into()),
        );
        folder.insert("Title".into(), PlistValue::String("Favourites".into()));
        let mut leaf = plist::Dictionary::new();
        leaf.insert(
            "WebBookmarkType".into(),
            PlistValue::String("WebBookmarkTypeLeaf".into()),
        );
        leaf.insert(
            "URLString".into(),
            PlistValue::String("https://example.com/safari".into()),
        );
        let mut uri = plist::Dictionary::new();
        uri.insert("title".into(), PlistValue::String("Safari Example".into()));
        leaf.insert("URIDictionary".into(), PlistValue::Dictionary(uri));
        folder.insert(
            "Children".into(),
            PlistValue::Array(vec![PlistValue::Dictionary(leaf)]),
        );
        root.insert(
            "Children".into(),
            PlistValue::Array(vec![PlistValue::Dictionary(folder)]),
        );
        plist::to_file_binary(&path, &PlistValue::Dictionary(root)).unwrap();

        let parsed = parse_bookmarks(&path).unwrap();
        assert_eq!(parsed.format, "safari");
        assert_eq!(parsed.bookmarks.len(), 1);
        assert_eq!(parsed.bookmarks[0].title, "Safari Example");
        assert_eq!(parsed.bookmarks[0].folder, "Favourites");
    }

    #[test]
    fn parses_firefox_preferences() {
        let raw = r#"
// Mozilla User Preferences
user_pref("browser.startup.homepage", "https://example.com/home|https://example.org");
user_pref("browser.startup.page", 3);
user_pref("browser.search.defaultenginename", "DuckDuckGo");
"#;
        let settings = parse_firefox_settings(raw);
        assert_eq!(
            settings.homepage.as_deref(),
            Some("https://example.com/home")
        );
        assert_eq!(settings.startup_behavior, Some(StartupBehavior::Restore));
        assert!(settings.notes.iter().any(|note| note.contains("several")));
    }

    #[test]
    fn preview_and_import_are_transactional_and_deduplicate() {
        let dir = tempdir().unwrap();
        let bookmarks_path = dir.path().join("bookmarks.html");
        fs::write(
            &bookmarks_path,
            r#"<DL><DT><A HREF="https://example.com/a">A</A>
            <DT><A HREF="https://example.com/b">B</A>
            <DT><A HREF="javascript:void(0)">Bad</A></DL>"#,
        )
        .unwrap();
        let preview = preview(Some(bookmarks_path.to_str().unwrap()), None).unwrap();
        assert_eq!(preview.bookmarks.as_ref().unwrap().count, 2);
        assert_eq!(preview.bookmarks.as_ref().unwrap().invalid, 1);

        let mut connection = crate::storage::open(dir.path()).unwrap();
        let first = import_bookmarks(&mut connection, bookmarks_path.to_str().unwrap()).unwrap();
        assert_eq!(first.imported, 2);
        assert_eq!(first.folders, 1);
        let second = import_bookmarks(&mut connection, bookmarks_path.to_str().unwrap()).unwrap();
        assert_eq!(second.imported, 0);
        assert_eq!(second.skipped, 2);
    }

    #[test]
    fn rejects_relative_paths_and_missing_components() {
        assert!(preview(None, None).is_err());
        assert!(preview(Some("Bookmarks"), None).is_err());
        assert!(preview(Some("/does/not/exist"), None).is_err());
    }
}
