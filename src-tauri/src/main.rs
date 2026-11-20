#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_state;
mod constants;
mod fs_util;
mod ip_policy;
mod ipc;
mod logging;
mod platform;
mod settings;
mod types;
mod updater;
mod validation;
mod window;

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

static BACKEND_URL: Mutex<Option<String>> = Mutex::new(None);
static BACKEND_CHILD: Mutex<Option<Child>> = Mutex::new(None);
static BACKEND_NODE: Mutex<Option<PathBuf>> = Mutex::new(None);
static BACKEND_START_FAILED: AtomicBool = AtomicBool::new(false);
static BACKEND_RESTARTING: AtomicBool = AtomicBool::new(false);
static BACKEND_WATCH_STARTED: AtomicBool = AtomicBool::new(false);

fn repo_root() -> PathBuf {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    root.canonicalize().unwrap_or(root)
}

/// Dev and `target/release` binaries use the checkout. An installed app uses
/// the resources copied beside the executable, with the same relative layout
/// the Node process already expects (`dist/main`, `src/main/runtime`).
fn backend_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if !platform::is_packaged() {
        return Ok(repo_root());
    }
    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Could not resolve packaged resources: {error}"))?;
    let main_js = resources.join("dist").join("main").join("main.js");
    if !main_js.is_file() {
        return Err(format!(
            "Packaged Node backend missing at {}",
            main_js.display()
        ));
    }
    Ok(resources)
}

/// Editor settings stay in the Electron userData folder. Moving them would
/// drop saved recents and the custom Node.js path.
pub(crate) fn editor_user_data_dir() -> Result<PathBuf, String> {
    if cfg!(windows) {
        if let Some(dir) = std::env::var_os("APPDATA") {
            if !dir.is_empty() {
                return Ok(PathBuf::from(dir).join("Zephus"));
            }
        }
        if let Some(dir) = std::env::var_os("USERPROFILE") {
            return Ok(PathBuf::from(dir)
                .join("AppData")
                .join("Roaming")
                .join("Zephus"));
        }
    } else if cfg!(target_os = "macos") {
        if let Some(dir) = std::env::var_os("HOME") {
            return Ok(PathBuf::from(dir)
                .join("Library")
                .join("Application Support")
                .join("Zephus"));
        }
    } else if let Some(dir) = std::env::var_os("XDG_CONFIG_HOME") {
        if !dir.is_empty() {
            return Ok(PathBuf::from(dir).join("Zephus"));
        }
    } else if let Some(dir) = std::env::var_os("HOME") {
        return Ok(PathBuf::from(dir).join(".config").join("Zephus"));
    }
    Err("Could not resolve the Zephus settings directory.".into())
}

fn validate_node_executable(value: &str) -> Result<PathBuf, String> {
    let candidate = value.trim();
    if candidate.is_empty() {
        return Err("Node.js path must be a non-empty string.".into());
    }
    let path = PathBuf::from(candidate);
    if !path.is_absolute() {
        return Err("Node.js path must be absolute.".into());
    }
    let base = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if base != "node" && base != "node.exe" {
        return Err("Node.js path must point at a file named \"node\" or \"node.exe\".".into());
    }
    let meta =
        std::fs::symlink_metadata(&path).map_err(|_| "Node.js path does not exist.".to_string())?;
    if meta.file_type().is_symlink() {
        return Err("Node.js path must not be a symbolic link.".into());
    }
    if !meta.is_file() {
        return Err("Node.js path is not a regular file.".into());
    }
    Ok(path)
}

fn saved_node_executable() -> Option<PathBuf> {
    let file = editor_user_data_dir().ok()?.join("settings.json");
    let text = std::fs::read_to_string(file).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let path = value.get("customNodePath")?.as_str()?;
    validate_node_executable(path).ok()
}

fn persist_custom_node_path(executable: &Path) -> Result<(), String> {
    let file = editor_user_data_dir()?.join("settings.json");
    let mut value = if file.is_file() {
        let text = std::fs::read_to_string(&file)
            .map_err(|error| format!("Could not read settings.json: {error}"))?;
        serde_json::from_str::<serde_json::Value>(&text)
            .map_err(|_| "settings.json could not be read.".to_string())?
    } else {
        serde_json::json!({})
    };
    let object = value
        .as_object_mut()
        .ok_or_else(|| "settings.json could not be read.".to_string())?;
    object.insert(
        "customNodePath".to_string(),
        serde_json::Value::String(executable.display().to_string()),
    );
    crate::fs_util::write_json(&file, &value)
}

fn node_program() -> std::ffi::OsString {
    let override_path = BACKEND_NODE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    if let Some(path) = override_path {
        return path.into_os_string();
    }
    if let Some(path) = saved_node_executable() {
        return path.into_os_string();
    }
    if Path::new("/app/bin/node").is_file() {
        return std::ffi::OsString::from("/app/bin/node");
    }
    std::ffi::OsString::from("node")
}

fn ensure_node_backend(app: &tauri::AppHandle) {
    let mut child_slot = BACKEND_CHILD
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if child_slot.is_some() {
        return;
    }

    let root = match backend_root(app) {
        Ok(root) => root,
        Err(error) => {
            BACKEND_START_FAILED.store(true, Ordering::SeqCst);
            logging::error(&error);
            return;
        }
    };
    let main_js = root.join("dist").join("main").join("main.js");
    if !main_js.is_file() {
        BACKEND_START_FAILED.store(true, Ordering::SeqCst);
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
    let node = node_program();
    let mut command = Command::new(node);
    command
        .arg("--require")
        .arg(&hook)
        .arg(&main_js)
        .current_dir(&root)
        .env("ZEPHUS_HOST", "tauri")
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    if platform::is_packaged() {
        command.env("ZEPHUS_PACKAGED", "1");
    }
    if let Ok(smoke) = std::env::var("ZEPHUS_SMOKE") {
        command.env("ZEPHUS_SMOKE", smoke);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            BACKEND_START_FAILED.store(true, Ordering::SeqCst);
            logging::error(&format!("Failed to spawn Node backend: {error}"));
            return;
        }
    };

    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = child.kill();
            BACKEND_START_FAILED.store(true, Ordering::SeqCst);
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
    let Some(url) = found_url else {
        let _ = child.kill();
        BACKEND_START_FAILED.store(true, Ordering::SeqCst);
        logging::error("Node backend exited before advertising its URL");
        return;
    };
    // The URL path is the backend secret. Log the origin only.
    let origin = match url.find("://").and_then(|scheme_end| {
        url[scheme_end + 3..]
            .find('/')
            .map(|path_at| scheme_end + 3 + path_at)
    }) {
        Some(end) => &url[..end],
        None => url.as_str(),
    };
    logging::info(&format!(
        "Node backend ready at {origin} from {}",
        root.display()
    ));
    {
        let mut url_slot = BACKEND_URL
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *url_slot = Some(url);
    }
    BACKEND_START_FAILED.store(false, Ordering::SeqCst);
    BACKEND_RESTARTING.store(false, Ordering::SeqCst);
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
    watch_backend_child();
}

fn watch_backend_child() {
    if BACKEND_WATCH_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| loop {
        std::thread::sleep(std::time::Duration::from_millis(400));
        let status = {
            let mut slot = BACKEND_CHILD
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let Some(child) = slot.as_mut() else {
                continue;
            };
            match child.try_wait() {
                Ok(Some(status)) => {
                    *slot = None;
                    Some(status)
                }
                Ok(None) => None,
                Err(error) => {
                    logging::warn(&format!("Could not check the editor service: {error}"));
                    None
                }
            }
        };
        let Some(status) = status else {
            continue;
        };
        {
            let mut url_slot = BACKEND_URL
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *url_slot = None;
        }
        BACKEND_START_FAILED.store(true, Ordering::SeqCst);
        if BACKEND_RESTARTING.load(Ordering::SeqCst)
            || window::APP_QUITTING.load(Ordering::SeqCst)
            || std::env::var("ZEPHUS_SMOKE").ok().as_deref() == Some("1")
            || std::env::var("ZEPHUS_BOOT_CHECK").ok().as_deref() == Some("1")
        {
            continue;
        }
        let message = format!(
                "The editor service stopped unexpectedly ({status}). Zephus will close.\n\nReopen Zephus to continue. Autosaved drafts remain on disk."
            );
        logging::error(&message);
        let Some(app) = crate::app_state::app().cloned() else {
            return;
        };
        let _ = app
            .dialog()
            .message(&message)
            .title("Zephus")
            .kind(MessageDialogKind::Error)
            .blocking_show();
        window::APP_QUITTING.store(true, Ordering::SeqCst);
        app.exit(1);
        return;
    });
}

fn restart_node_backend(app: &tauri::AppHandle) -> Result<(), String> {
    shutdown_node_backend();
    {
        let mut url_slot = BACKEND_URL
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *url_slot = None;
    }
    BACKEND_START_FAILED.store(false, Ordering::SeqCst);
    ensure_node_backend(app);
    if backend_url().is_none() {
        return Err("That Node.js executable did not start the editor.".into());
    }
    Ok(())
}

/// Remembers a Node.js executable and starts the editor service with it.
/// The page cannot ask the service to save the path when the service is down.
#[tauri::command]
async fn set_backend_node(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let executable = validate_node_executable(&path)?;
    persist_custom_node_path(&executable)?;
    {
        let mut slot = BACKEND_NODE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *slot = Some(executable);
    }
    tauri::async_runtime::spawn_blocking(move || restart_node_backend(&app))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn backend_start_failed() -> bool {
    BACKEND_START_FAILED.load(Ordering::SeqCst)
}

pub(crate) fn shutdown_node_backend() {
    BACKEND_RESTARTING.store(true, Ordering::SeqCst);
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
            ensure_node_backend(app.handle());
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
            window::apply_editor_settings,
            window::restart_app,
            logging::log_error,
            window::notify_settings_flushed,
            window::cancel_editor_close,
            window::mark_main_window_ready,
            backend_url,
            backend_start_failed,
            set_backend_node,
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
        tauri::RunEvent::WindowEvent { label, event, .. }
            if label == app_state::MAIN_WINDOW
                && matches!(
                    event,
                    tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_)
                ) =>
        {
            window::note_main_window_bounds(app_handle);
        }
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
