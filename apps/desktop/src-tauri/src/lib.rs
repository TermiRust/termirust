mod command_error;
mod commands;
mod logging;
mod raw_chunk;
mod session_registry;
mod transfer_queue;
mod vault_state;

use std::path::Path;
use std::sync::Arc;

use specta_typescript::Typescript;
use tauri_specta::{Builder, collect_commands};

use tauri::Manager;
use termirust_core::vault::OsKeychain;

use crate::commands::{
    ai, benchmark, forwards, host_session, hosts, keys, local_files, local_session, logs, monitor,
    session, settings, sftp, snippets, ssh_config, vault,
};
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
        local_session::session_open_local,
        session::session_write,
        session::session_acknowledge_output,
        session::session_resize,
        session::session_close,
        benchmark::benchmark_output_raw,
        benchmark::benchmark_output_json,
        benchmark::benchmark_acknowledge_output,
        benchmark::benchmark_report,
        vault::vault_overview,
        vault::vault_retry_open,
        vault::onboarding_needed,
        vault::onboarding_finish,
        hosts::hosts_list,
        hosts::hosts_create,
        hosts::hosts_update,
        hosts::hosts_delete,
        hosts::hosts_move,
        hosts::groups_list,
        hosts::groups_create,
        hosts::groups_update,
        hosts::groups_delete,
        keys::keys_list,
        keys::keys_import,
        keys::keys_import_file,
        keys::keys_generate,
        keys::keys_delete,
        ssh_config::ssh_config_preview,
        ssh_config::ssh_config_import,
        settings::settings_terminal_get,
        settings::settings_terminal_set,
        logs::logs_open_folder,
        sftp::sftp_open,
        sftp::sftp_list,
        sftp::sftp_create_dir,
        sftp::sftp_rename,
        sftp::sftp_remove,
        sftp::sftp_close,
        sftp::sftp_transfer_start,
        sftp::sftp_transfer_cancel,
        local_files::local_home,
        local_files::local_list,
        local_files::local_create_dir,
        local_files::local_rename,
        local_files::local_remove,
        forwards::forwards_list,
        forwards::forwards_create,
        forwards::forwards_update,
        forwards::forwards_delete,
        forwards::forwards_start,
        forwards::forwards_stop,
        forwards::forwards_status,
        forwards::forwards_auto_start,
        ai::ai_settings_get,
        ai::ai_settings_set,
        ai::ai_test_connection,
        ai::ai_preview,
        ai::ai_ask,
        ai::ai_cancel,
        ai::ai_chats_list,
        ai::ai_chat_get,
        ai::ai_chat_save,
        ai::ai_chat_delete,
        monitor::monitor_probe,
        monitor::monitor_forget,
        snippets::snippets_list,
        snippets::snippets_create,
        snippets::snippets_update,
        snippets::snippets_delete,
        snippets::command_danger,
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
        .manage(sftp::SftpSessions::default())
        .manage(transfer_queue::TransferQueue::default())
        .manage(forwards::RunningForwards::default())
        .manage(ai::AiRequests::default())
        .manage(monitor::MonitorConnections::default())
        .invoke_handler(registry.invoke_handler())
        .setup(move |app| {
            registry.mount_events(app);
            match logging::init(&app.path().app_log_dir()?) {
                Ok(guard) => {
                    app.manage(guard);
                }
                Err(e) => eprintln!("logging disabled: {e}"),
            }
            tracing::info!(version = env!("CARGO_PKG_VERSION"), "Termirust starting");
            let data_dir = app.path().app_data_dir()?;
            app.manage(VaultState::new(
                data_dir,
                Arc::new(OsKeychain::new(KEYCHAIN_SERVICE)),
            ));
            // Opening may wait on an OS keychain prompt; the window must not wait with it.
            // On first launch the onboarding opens it once the prompt has been explained.
            if !vault_state::is_first_launch(&app.path().app_data_dir()?) {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(
                    async move { handle.state::<VaultState>().open().await },
                );
            }
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
