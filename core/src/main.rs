use std::process::ExitCode;

fn print_help() {
    println!(
        "xuvon-core {} — Xuvon Browser application core\n\n\
         Usage: xuvon-core [--data-dir <path>]\n\n\
         The core speaks newline-delimited JSON-RPC 2.0 on stdin/stdout and is\n\
         normally launched by the Xuvon Browser host application.",
        env!("CARGO_PKG_VERSION")
    );
}

fn main() -> ExitCode {
    let mut data_dir: Option<std::path::PathBuf> = None;
    let mut arguments = std::env::args().skip(1);
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--data-dir" => match arguments.next() {
                Some(value) => data_dir = Some(std::path::PathBuf::from(value)),
                None => {
                    eprintln!("xuvon-core: --data-dir requires a path");
                    return ExitCode::from(2);
                }
            },
            "--version" => {
                println!("{}", env!("CARGO_PKG_VERSION"));
                return ExitCode::SUCCESS;
            }
            "--help" | "-h" => {
                print_help();
                return ExitCode::SUCCESS;
            }
            other => {
                eprintln!("xuvon-core: unknown argument {other:?}");
                return ExitCode::from(2);
            }
        }
    }

    let resolved = data_dir.unwrap_or_else(xuvon_core::paths::default_data_dir);
    let app = match xuvon_core::app::App::open(resolved.clone()) {
        Ok(app) => app,
        Err(error) => {
            xuvon_core::rpc::log_event(
                "error",
                "failed to start core",
                Some(serde_json::json!({
                    "code": error.code,
                    "message": error.message,
                    "dataDir": resolved.to_string_lossy(),
                })),
            );
            return ExitCode::FAILURE;
        }
    };

    xuvon_core::rpc::log_event(
        "info",
        "core ready",
        Some(serde_json::json!({
            "version": env!("CARGO_PKG_VERSION"),
            "protocol": xuvon_core::PROTOCOL_VERSION,
            "dataDir": resolved.to_string_lossy(),
        })),
    );

    match xuvon_core::rpc::serve(&app) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            xuvon_core::rpc::log_event(
                "error",
                "core transport failed",
                Some(serde_json::json!({ "message": error.to_string() })),
            );
            ExitCode::FAILURE
        }
    }
}
