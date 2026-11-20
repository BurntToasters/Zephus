//! Platform queries, updater target selection, and OS handoffs.

use crate::ipc::{
    FalliblePayload, IpcResult, JsonObject, INTERNAL_ERROR, INVALID_PATH, INVALID_URL,
};
use crate::types::NotificationInput;
use serde::Serialize;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn get_app_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        _ => "linux",
    }
}

pub fn distribution_channel() -> &'static str {
    match option_env!("ZEPHUS_DISTRIBUTION_CHANNEL") {
        Some("msstore") => "msstore",
        _ => "github",
    }
}

#[tauri::command]
pub fn get_distribution_channel() -> &'static str {
    distribution_channel()
}

#[cfg(target_os = "macos")]
fn is_rosetta_translated() -> bool {
    let mut ret: libc::c_int = 0;
    let mut size: libc::size_t = std::mem::size_of_val(&ret);
    let name = c"sysctl.proc_translated";
    let res = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            &mut ret as *mut _ as *mut libc::c_void,
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    res == 0 && ret == 1
}

#[cfg(not(target_os = "macos"))]
fn is_rosetta_translated() -> bool {
    false
}

#[tauri::command]
pub fn get_beta_updater_target() -> String {
    use tauri::utils::config::BundleType;

    let os = match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "darwin",
        other => other,
    };
    let arch = if is_rosetta_translated() {
        "aarch64"
    } else {
        match std::env::consts::ARCH {
            "x86" => "i686",
            "arm64" => "aarch64",
            other => other,
        }
    };
    let installer = match tauri::utils::platform::bundle_type() {
        Some(BundleType::Deb) => Some("deb"),
        Some(BundleType::Rpm) => Some("rpm"),
        Some(BundleType::AppImage) => Some("appimage"),
        Some(BundleType::Msi) => Some("msi"),
        Some(BundleType::Nsis) => Some("nsis"),
        Some(BundleType::App | BundleType::Dmg) => Some("app"),
        None => None,
    };
    match installer {
        Some(installer) => format!("{os}-beta-{arch}-{installer}"),
        None => format!("{os}-beta-{arch}"),
    }
}

#[tauri::command]
pub fn get_compact_updater_target(beta: bool) -> Option<String> {
    use tauri::utils::config::BundleType;

    if !cfg!(target_os = "macos")
        || !matches!(
            tauri::utils::platform::bundle_type(),
            Some(BundleType::App | BundleType::Dmg)
        )
    {
        return None;
    }
    let arch = if is_rosetta_translated() {
        "aarch64"
    } else {
        match std::env::consts::ARCH {
            arch @ ("aarch64" | "x86_64") => arch,
            _ => return None,
        }
    };
    let channel = if beta { "-beta" } else { "" };
    Some(format!("darwin{channel}-{arch}-app-zst"))
}

#[cfg(target_os = "linux")]
pub fn repair_appimage_gdk_backend() -> bool {
    let set = |name: &str| std::env::var_os(name).is_some_and(|value| !value.is_empty());
    let forced_x11 = std::env::var("GDK_BACKEND").is_ok_and(|value| value == "x11");
    if set("APPIMAGE") && forced_x11 && !set("DISPLAY") && set("WAYLAND_DISPLAY") {
        std::env::set_var("GDK_BACKEND", "wayland");
        return true;
    }
    false
}

pub fn flatpak() -> bool {
    std::env::var_os("FLATPAK_ID").is_some_and(|id| !id.is_empty())
        || std::path::Path::new("/.flatpak-info").exists()
}

#[tauri::command]
pub fn is_flatpak() -> bool {
    flatpak()
}

#[tauri::command]
pub fn is_packaged() -> bool {
    let exe = match std::env::current_exe() {
        Ok(path) => path.to_string_lossy().to_string(),
        Err(_) => return false,
    };

    #[cfg(windows)]
    {
        let lower = exe.to_lowercase();
        !(lower.contains("\\target\\debug\\") || lower.contains("\\target\\release\\"))
    }

    #[cfg(target_os = "macos")]
    {
        exe.contains(".app/Contents/MacOS/")
    }

    #[cfg(target_os = "linux")]
    {
        !(exe.contains("/target/debug/") || exe.contains("/target/release/"))
    }
}

#[derive(Serialize)]
pub struct Opened {
    opened: bool,
}

#[derive(Serialize)]
pub struct Shown {
    shown: bool,
}

#[tauri::command]
pub async fn open_external(
    app: tauri::AppHandle,
    url: FalliblePayload<String>,
) -> IpcResult<Opened> {
    tauri::async_runtime::spawn_blocking(move || open_external_blocking(&app, url))
        .await
        .unwrap_or_else(|error| crate::ipc::err(INTERNAL_ERROR, error.to_string()))
}

fn open_external_blocking(
    app: &tauri::AppHandle,
    url: FalliblePayload<String>,
) -> IpcResult<Opened> {
    let url = match url
        .into_typed(INVALID_URL, "Invalid external URL payload.")
        .and_then(|url| crate::validation::validate_external_url(&url))
    {
        Ok(url) => url,
        Err(error) => return crate::ipc::from_error(error),
    };
    match app.opener().open_url(url, None::<&str>) {
        Ok(()) => crate::ipc::ok(Opened { opened: true }),
        Err(error) => {
            crate::logging::error(&format!("Error in open-external handler: {error}"));
            crate::ipc::err(INTERNAL_ERROR, "Failed to open external URL.")
        }
    }
}

#[tauri::command(async)]
pub fn open_file_location(
    app: tauri::AppHandle,
    file_path: FalliblePayload<String>,
) -> IpcResult<Opened> {
    let path = match file_path
        .into_typed(INVALID_PATH, "File path must be a non-empty string.")
        .and_then(|path| crate::validation::validate_file_path(&path))
    {
        Ok(path) => std::path::PathBuf::from(path),
        Err(error) => return crate::ipc::from_error(error),
    };
    let open_parent = |dir: &std::path::Path| {
        app.opener()
            .open_path(dir.to_string_lossy().into_owned(), None::<&str>)
    };
    let result = if path.exists() {
        app.opener().reveal_item_in_dir(&path).or_else(|error| {
            match path.parent().filter(|dir| dir.exists()) {
                Some(dir) => {
                    crate::logging::warn(&format!(
                        "Reveal in file manager failed ({error}); opening the folder instead."
                    ));
                    open_parent(dir)
                }
                None => Err(error),
            }
        })
    } else if let Some(dir) = path.parent().filter(|dir| dir.exists()) {
        open_parent(dir)
    } else {
        return crate::ipc::err(INVALID_PATH, "Path and containing directory do not exist.");
    };
    match result {
        Ok(()) => crate::ipc::ok(Opened { opened: true }),
        Err(error) => {
            crate::logging::error(&format!("Error in open-file-location handler: {error}"));
            crate::ipc::err(INTERNAL_ERROR, "Failed to open file location.")
        }
    }
}

#[tauri::command(async)]
pub fn show_notification(
    app: tauri::AppHandle,
    options: FalliblePayload<JsonObject<NotificationInput>>,
) -> IpcResult<Shown> {
    let request = match crate::validation::validate_notification(options) {
        Ok(request) => request,
        Err(error) => return crate::ipc::from_error(error),
    };
    let title = request
        .title
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| "Zephus".to_string());
    let body = request.body.unwrap_or_default();
    match app.notification().builder().title(title).body(body).show() {
        Ok(()) => crate::ipc::ok(Shown { shown: true }),
        Err(error) => {
            crate::logging::error(&format!("Error showing notification: {error}"));
            crate::ipc::err(INTERNAL_ERROR, "Failed to show notification.")
        }
    }
}
