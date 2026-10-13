mod command_error;
mod commands;
mod raw_chunk;
mod session_registry;
mod vault_state;

use std::path::Path;

use specta_typescript::Typescript;
use tauri_specta::{Builder, collect_commands};

use tauri::Manager;
use termirust_core::vault::OsKeychain;

use crate::commands::{benchmark, host_session, hosts, keys, session, vault};
use crate::vault_state::{KEYCHAIN_SERVICE, VaultState};

/// Committed TypeScript bindings consumed by the frontend.
pub const BINDINGS_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/bindings.ts");

#[tauri::command]
#[specta::specta]
fn app_version() -> String {
    termirust_core::version().to_string()
}

pub fn command_registry() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
        app_version,
        session::session_open_with_password,
        host_session::session_open_host,
        session::session_write,
        session::session_acknowledge_output,
        session::session_resize,
        session::session_close,
        benchmark::benchmark_output_raw,
        benchmark::benchmark_output_json,
        benchmark::benchmark_acknowledge_output,
        benchmark::benchmark_report,
        vault::vault_overview,
        hosts::hosts_list,
        hosts::hosts_create,
        hosts::hosts_update,
        hosts::hosts_delete,
        hosts::groups_list,
        hosts::groups_create,
        hosts::groups_delete,
        keys::keys_list,
        keys::keys_import,
        keys::keys_import_file,
        keys::keys_generate,
        keys::keys_delete,
    ])
}

pub fn export_bindings(
    registry: &Builder<tauri::Wry>,
    path: impl AsRef<Path>,
) -> Result<(), String> {
    registry
        .export(Typescript::default(), path)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let registry = command_registry();

    #[cfg(debug_assertions)]
    export_bindings(&registry, BINDINGS_PATH).expect("failed to export TypeScript bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(session::Sessions::default())
        .manage(benchmark::ActiveBenchmark::default())
        .invoke_handler(registry.invoke_handler())
        .setup(move |app| {
            registry.mount_events(app);
            let data_dir = app.path().app_data_dir()?;
            let vault = tauri::async_runtime::block_on(VaultState::open(
                &data_dir,
                &OsKeychain::new(KEYCHAIN_SERVICE),
            ));
            app.manage(vault);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Termirust");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_version_comes_from_core() {
        assert_eq!(app_version(), termirust_core::version());
    }

    // Guards against a Rust signature change shipping without regenerated TS types.
    // Regenerate with: UPDATE_BINDINGS=1 cargo test -p termirust-desktop
    #[test]
    fn committed_bindings_match_rust_commands() {
        let registry = command_registry();
        if std::env::var_os("UPDATE_BINDINGS").is_some() {
            export_bindings(&registry, BINDINGS_PATH).unwrap();
        }

        let fresh_path =
            std::env::temp_dir().join(format!("termirust-bindings-{}.ts", std::process::id()));
        export_bindings(&registry, &fresh_path).unwrap();
        let fresh = std::fs::read_to_string(&fresh_path).unwrap();
        let _ = std::fs::remove_file(&fresh_path);
        let committed = std::fs::read_to_string(BINDINGS_PATH).unwrap_or_default();

        assert!(
            fresh.contains("appVersion"),
            "bindings must expose appVersion"
        );
        assert_eq!(
            fresh, committed,
            "src/bindings.ts is stale; run `UPDATE_BINDINGS=1 cargo test -p termirust-desktop`"
        );
    }
}
