use serde::Serialize;
use serde_json::Value;
use std::fmt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl CoreError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }

    pub fn invalid_params(message: impl Into<String>) -> Self {
        Self::new("invalid_params", message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("not_found", message)
    }

    pub fn invalid_url(message: impl Into<String>) -> Self {
        Self::new("invalid_url", message)
    }

    pub fn blocked_onion() -> Self {
        Self::new(
            "blocked_onion",
            "Onion addresses are blocked in Xuvon. Xuvon routes eligible clear-web traffic through Tor; it is not an onion browser.",
        )
    }

    pub fn unsupported_scheme(scheme: &str) -> Self {
        Self::new(
            "unsupported_scheme",
            format!("The \"{scheme}\" URL scheme is not permitted in Xuvon."),
        )
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("internal_error", message)
    }
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for CoreError {}

impl From<rusqlite::Error> for CoreError {
    fn from(value: rusqlite::Error) -> Self {
        Self::new("storage_error", value.to_string())
    }
}

impl From<serde_json::Error> for CoreError {
    fn from(value: serde_json::Error) -> Self {
        Self::new("serialization_error", value.to_string())
    }
}

pub type CoreResult<T> = Result<T, CoreError>;
