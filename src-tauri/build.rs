const COMMANDS: &[&str] = &[
    "open_external",
    "open_file_location",
    "show_notification",
    "is_packaged",
    "is_flatpak",
    "get_app_platform",
    "get_distribution_channel",
    "get_beta_updater_target",
    "get_compact_updater_target",
    "check_for_updates",
    "download_update",
    "install_update",
    "cancel_update_download",
    "set_update_channel",
    "restart_app",
    "log_error",
    "notify_settings_flushed",
    "mark_main_window_ready",
    "backend_url",
    "smoke_complete",
    "open_preview_window",
    "close_preview_window",
];

fn main() {
    println!("cargo:rerun-if-env-changed=ZEPHUS_DISTRIBUTION_CHANNEL");
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to build Tauri application metadata");
}