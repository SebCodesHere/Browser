use crate::app::App;
use crate::error::CoreError;
use crate::PROTOCOL_VERSION;
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::time::Instant;

const MAX_MESSAGE_BYTES: usize = 4 * 1024 * 1024;

enum Outcome {
    Continue,
    Quit,
}

pub fn log_event(level: &str, message: &str, extra: Option<Value>) {
    let mut payload = json!({
        "ts": crate::storage::timestamp_now(),
        "level": level,
        "target": "xuvon-core",
        "msg": message,
    });
    if let (Some(Value::Object(extra)), Some(map)) = (extra, payload.as_object_mut()) {
        for (key, value) in extra {
            map.insert(key, value);
        }
    }
    eprintln!("{payload}");
}

pub fn serve(app: &App) -> std::io::Result<()> {
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    write_message(
        &mut out,
        &json!({
            "jsonrpc": "2.0",
            "method": "core.ready",
            "params": {
                "protocol": PROTOCOL_VERSION,
                "version": crate::CORE_VERSION,
                "pid": std::process::id(),
            }
        }),
    )?;

    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        if line.len() > MAX_MESSAGE_BYTES {
            write_message(
                &mut out,
                &error_response(
                    &Value::Null,
                    &CoreError::invalid_params("Message too large"),
                ),
            )?;
            continue;
        }
        match handle_line(app, &line) {
            (response, Outcome::Quit) => {
                write_message(&mut out, &response)?;
                out.flush()?;
                return Ok(());
            }
            (response, Outcome::Continue) => {
                write_message(&mut out, &response)?;
            }
        }
        out.flush()?;
    }
    Ok(())
}

fn handle_line(app: &App, line: &str) -> (Value, Outcome) {
    let parsed: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(error) => {
            log_event(
                "warn",
                "invalid JSON request",
                Some(json!({ "error": error.to_string() })),
            );
            return (
                error_response(
                    &Value::Null,
                    &CoreError::new("parse_error", "Invalid JSON request"),
                ),
                Outcome::Continue,
            );
        }
    };

    let id = parsed.get("id").cloned().unwrap_or(Value::Null);
    let Some(method) = parsed.get("method").and_then(Value::as_str) else {
        return (
            error_response(
                &id,
                &CoreError::new("invalid_request", "Request is missing a method"),
            ),
            Outcome::Continue,
        );
    };

    if method == "app.shutdown" {
        log_event("info", "shutdown requested", None);
        return (response(&id, json!({ "ok": true })), Outcome::Quit);
    }

    let params = parsed.get("params").cloned().unwrap_or(Value::Null);
    let started = Instant::now();
    let result = app.handle(method, params);
    let duration_ms = started.elapsed().as_millis() as u64;

    match result {
        Ok(value) => {
            log_event(
                "info",
                "request",
                Some(json!({ "method": method, "durationMs": duration_ms, "ok": true })),
            );
            (response(&id, value), Outcome::Continue)
        }
        Err(error) => {
            log_event(
                "warn",
                "request failed",
                Some(json!({
                    "method": method,
                    "durationMs": duration_ms,
                    "ok": false,
                    "code": error.code,
                })),
            );
            (error_response(&id, &error), Outcome::Continue)
        }
    }
}

fn response(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn error_response(id: &Value, error: &CoreError) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": error.code,
            "message": error.message,
            "details": error.details,
        }
    })
}

fn write_message(out: &mut impl Write, value: &Value) -> std::io::Result<()> {
    let encoded = serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string());
    out.write_all(encoded.as_bytes())?;
    out.write_all(b"\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::App;
    use tempfile::tempdir;

    #[test]
    fn handles_valid_and_invalid_lines() {
        let dir = tempdir().unwrap();
        let app = App::open(dir.path().to_path_buf()).unwrap();

        let (response, _) = handle_line(&app, r#"{"jsonrpc":"2.0","id":1,"method":"app.ping"}"#);
        assert_eq!(response["result"]["ok"], true);

        let (response, _) = handle_line(&app, "not json");
        assert_eq!(response["error"]["code"], "parse_error");

        let (response, _) = handle_line(&app, r#"{"jsonrpc":"2.0","id":2}"#);
        assert_eq!(response["error"]["code"], "invalid_request");

        let (response, _) = handle_line(
            &app,
            r#"{"jsonrpc":"2.0","id":3,"method":"navigation.resolve","params":{"input":"https://x.onion"}}"#,
        );
        assert_eq!(response["error"]["code"], "blocked_onion");
    }
}
