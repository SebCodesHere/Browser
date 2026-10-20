use crate::error::{CoreError, CoreResult};
use crate::navigation;
use crate::settings::is_internal_url;
use crate::storage::timestamp_now;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const MAX_TABS: usize = 40;
const MAX_TITLE: usize = 300;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTab {
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub tabs: Vec<WorkspaceTab>,
    #[serde(default)]
    pub active_index: usize,
}

impl Default for Workspace {
    fn default() -> Self {
        Self {
            tabs: vec![WorkspaceTab {
                url: "xuvon://newtab".into(),
                title: "New Tab".into(),
                pinned: false,
            }],
            active_index: 0,
        }
    }
}

impl Workspace {
    pub fn validate(&self) -> CoreResult<()> {
        if self.tabs.is_empty() {
            return Err(CoreError::invalid_params(
                "A workspace needs at least one tab",
            ));
        }
        if self.tabs.len() > MAX_TABS {
            return Err(CoreError::invalid_params(
                "A workspace cannot persist more than 40 tabs",
            ));
        }
        if self.active_index >= self.tabs.len() {
            return Err(CoreError::invalid_params(
                "Active tab index is out of range",
            ));
        }
        for tab in &self.tabs {
            if tab.title.chars().count() > MAX_TITLE {
                return Err(CoreError::invalid_params("Tab title is too long"));
            }
            if is_internal_url(&tab.url) {
                continue;
            }
            if navigation::validate_web_url(&tab.url).is_err() {
                return Err(CoreError::invalid_params(format!(
                    "Tab URL is not persistable: {}",
                    tab.url
                )));
            }
        }
        Ok(())
    }
}

pub fn save(connection: &Connection, workspace: &Workspace) -> CoreResult<()> {
    workspace.validate()?;
    let json = serde_json::to_string(workspace)?;
    connection.execute(
        "INSERT INTO workspace (id, json, updated_at) VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
        params![json, timestamp_now()],
    )?;
    Ok(())
}

pub fn load(connection: &Connection) -> CoreResult<Workspace> {
    let raw: Option<String> = connection
        .query_row("SELECT json FROM workspace WHERE id = 1", [], |row| {
            row.get(0)
        })
        .optional()?;
    let Some(raw) = raw else {
        return Ok(Workspace::default());
    };
    match serde_json::from_str::<Workspace>(&raw) {
        Ok(workspace) if workspace.validate().is_ok() => Ok(workspace),
        _ => Ok(Workspace::default()),
    }
}

pub fn clear(connection: &Connection) -> CoreResult<()> {
    connection.execute("DELETE FROM workspace", [])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::open;
    use tempfile::tempdir;

    #[test]
    fn save_and_load_roundtrip() {
        let dir = tempdir().unwrap();
        let connection = open(dir.path()).unwrap();
        let workspace = Workspace {
            tabs: vec![
                WorkspaceTab {
                    url: "https://example.com/".into(),
                    title: "Example".into(),
                    pinned: true,
                },
                WorkspaceTab {
                    url: "xuvon://newtab".into(),
                    title: "New Tab".into(),
                    pinned: false,
                },
            ],
            active_index: 1,
        };
        save(&connection, &workspace).unwrap();
        let loaded = load(&connection).unwrap();
        assert_eq!(loaded.tabs.len(), 2);
        assert!(loaded.tabs[0].pinned);
    }

    #[test]
    fn corrupt_workspace_falls_back_to_default() {
        let dir = tempdir().unwrap();
        let connection = open(dir.path()).unwrap();
        connection
            .execute(
                "INSERT INTO workspace (id, json, updated_at) VALUES (1, '{', 'now')",
                [],
            )
            .unwrap();
        let loaded = load(&connection).unwrap();
        assert_eq!(loaded.tabs[0].url, "xuvon://newtab");
    }

    #[test]
    fn rejects_onion_tabs() {
        let workspace = Workspace {
            tabs: vec![WorkspaceTab {
                url: "https://x.onion".into(),
                title: String::new(),
                pinned: false,
            }],
            active_index: 0,
        };
        assert!(workspace.validate().is_err());
    }
}
