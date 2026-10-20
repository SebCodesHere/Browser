pub mod app;
pub mod bookmarks;
pub mod downloads;
pub mod error;
pub mod extensions;
pub mod history;
pub mod importers;
pub mod navigation;
pub mod paths;
pub mod rpc;
pub mod settings;
pub mod storage;
pub mod tor;
pub mod workspace;

pub const PROTOCOL_VERSION: u32 = 1;
pub const CORE_VERSION: &str = env!("CARGO_PKG_VERSION");
