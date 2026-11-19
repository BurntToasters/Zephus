#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_state;
mod constants;
mod fs_util;
mod ipc;
mod ip_policy;
mod logging;
mod platform;
mod settings;
mod types;
mod updater;
mod validation;
mod window;

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

static BACKEND_URL: Mutex<Option<String>> = Mutex::new(None);
static BACKEND_CHILD: Mutex<Option<Child>> = Mutex::new(None);

fn repo_root() -> PathBuf {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    root.canonicalize().unwrap_or(root)
}

fn ensure_node_backend() {
    let mut child_slot = BACKEND_CHILD
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if child_slot.is_some() {
        return;
    }

    let root = repo_root();
    let main_js = root.join("dist").join("main").join("main.js");
    if !main_js.is_file() {
        logging::error(&format!(
            "Node backend entry missing at {}",
            main_js.display()
        ));
        return;
    }

    let hook = root
        .join("src")
        .join("main")
        .join("runtime")
        .join("registerHook.cjs");
    let node = if std::path::Path::new("/app/bin/node").is_file() {
        std::ffi::OsString::from("/app/bin/node")
    } else {
        std::ffi::OsString::from("node")
    };
    let mut command = Command::new(node);
    command
        .arg("--require")
        .arg(&hook)
        .arg(&main_js)
        .current_dir(&root)
        .env("ZEPHUS_HOST", "tauri")
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    if let Ok(smoke) = std::env::var("ZEPHUS_SMOKE") {
        command.env("ZEPHUS_SMOKE", smoke);
    }
    let mut child = match command.spawn()
    {
        Ok(child) => child,
        Err(error) => {
            logging::error(&format!("Failed to spawn Node backend: {error}"));
            return;
        }
    };

    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            *child_slot = Some(child);
            logging::error("Node backend stdout was not captured");
            return;
        }
    };
    let mut reader = BufReader::new(stdout);
    let mut found_url = None::<String>;
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = line.trim_end();
                if let Some(url) = trimmed.strip_prefix("ZEPHUS_BACKEND_URL=") {
                    found_url = Some(url.to_string());
                    break;
                }
            }
            Err(_) => break,
        }
    }
    if let Some(url) = found_url {
        let mut url_slot = BACKEND_URL
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *url_slot = Some(url);
    }
    std::thread::spawn(move || {
        let mut scratch = String::new();
        loop {
            scratch.clear();
            match reader.read_line(&mut scratch) {
                Ok(0) => break,
                Ok(_) => {}
                Err(_) => break,
            }
        }
    });
    *child_slot = Some(child);
}

pub(crate) fn shutdown_node_backend() {
    if let Some(mut child) = BACKEND_CHILD
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take()
    {
        let _ = child.kill();
    }
}

/// Boot-check exit must not wait on the backend mutex.
pub(crate) fn shutdown_node_backend_now() {
    let Ok(mut slot) = BACKEND_CHILD.try_lock() else {
        return;
    };
    if let Some(mut child) = slot.take() {
        let _ = child.kill();
    }
}

#[tauri::command]
fn smoke_complete(app: tauri::AppHandle, failures: Vec<String>) {
    let exit_code = if failures.is_empty() { 0 } else { 1 };
    for failure in &failures {
        logging::error(&format!("[smoke] {failure}"));
    }
    if exit_code == 0 {
        println!("Smoke run: renderer checks passed, shutting down.");
    }
    println!("ZEPHUS_SMOKE_COMPLETE exit={exit_code}");
    let _ = std::io::Write::flush(&mut std::io::stdout());
    window::APP_QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
    app.exit(exit_code);
}

#[tauri::command]
fn backend_url() -> Option<String> {
    BACKEND_URL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

#[cfg(target_os = "macos")]
use tauri::Manager;

fn main() {
    logging::install_panic_hook();

    #[cfg(target_os = "linux")]
    let repaired_gdk_backend = platform::repair_appimage_gdk_backend();
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let handle = app.clone();
            std::thread::spawn(move || {
                let main_thread = handle.clone();
                let _ = handle.run_on_main_thread(move || {
                    if let Err(error) = window::show_main_window(&main_thread) {
                        logging::warn(&format!("Failed to focus main window: {error}"));
                    }
                });
            });
        }));
        if platform::distribution_channel() != "msstore" {
            builder = builder.plugin(
                tauri_plugin_updater::Builder::new()
                    .on_before_exit(|| {
                        logging::info("Flushing application state before installing the update.");
                        window::shutdown()
                    })
                    .build(),
            );
        }
    }

    let app = builder
        .setup(move |app| {
            app_state::init(app.handle())
                .map_err(|error| -> Box<dyn std::error::Error> { error.into() })?;
            logging::info(&format!(
                "Zephus {} starting ({} {})",
                env!("CARGO_PKG_VERSION"),
                std::env::consts::OS,
                std::env::consts::ARCH
            ));
            #[cfg(target_os = "linux")]
            if repaired_gdk_backend {
                logging::info("No X display for the AppImage's forced X11 backend; using Wayland.");
            }
            ensure_node_backend();
            if platform::is_packaged() {
                window::create_splash(app.handle());
            }
            window::show_main_window(app.handle())
                .map_err(|error| -> Box<dyn std::error::Error> { error.into() })?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform::open_external,
            platform::open_file_location,
            platform::show_notification,
            platform::is_packaged,
            platform::is_flatpak,
            platform::get_app_platform,
            platform::get_distribution_channel,
            platform::get_beta_updater_target,
            platform::get_compact_updater_target,
            updater::check_for_updates,
            updater::download_update,
            updater::install_update,
            updater::cancel_update_download,
            updater::set_update_channel,
            window::restart_app,
            logging::log_error,
            window::notify_settings_flushed,
            window::mark_main_window_ready,
            backend_url,
            smoke_complete,
            window::open_preview_window,
            window::close_preview_window,
        ])
        .build(tauri::generate_context!())
        .expect("failed to initialize Tauri application");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } if label == app_state::MAIN_WINDOW => window::on_main_close_requested(app_handle, &api),
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } if label == app_state::MAIN_WINDOW => window::on_main_destroyed(app_handle),
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } if label == app_state::PREVIEW_WINDOW => window::on_preview_destroyed(app_handle),
        tauri::RunEvent::ExitRequested { code, api, .. } => {
            if cfg!(target_os = "macos")
                && code.is_none()
                && !window::APP_QUITTING.load(std::sync::atomic::Ordering::SeqCst)
            {
                api.prevent_exit();
            }
        }
        tauri::RunEvent::Exit => {
            shutdown_node_backend();
            if let Err(error) = window::shutdown() {
                logging::error(&format!(
                    "Could not confirm durable state during final shutdown: {error}"
                ));
            }
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } if app_handle
            .get_webview_window(app_state::MAIN_WINDOW)
            .is_none() =>
        {
            if let Err(error) = window::show_main_window(app_handle) {
                logging::warn(&format!("Failed to reopen main window: {error}"));
            }
        }
        _ => {}
    });
}