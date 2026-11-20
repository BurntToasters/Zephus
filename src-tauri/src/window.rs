//! Window lifecycle: startup splash, deferred main-window reveal, the
//! close flow (confirm while busy, flush settings, then destroy), restart, and
//! shutdown cleanup.

use crate::app_state::{MAIN_WINDOW, PREVIEW_WINDOW, SPLASH_WINDOW};
use crate::constants::{SETTINGS_FLUSH_TIMEOUT, SPLASH_FADE_DELAY};
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

pub static MAIN_READY: AtomicBool = AtomicBool::new(false);
/// Port of the preview that was opened. Later navigations may not switch ports.
static PREVIEW_PORT: AtomicU16 = AtomicU16::new(0);
static CLOSE_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
static CLOSE_CONFIRMING: AtomicBool = AtomicBool::new(false);
static CLOSE_ACKNOWLEDGED: AtomicBool = AtomicBool::new(false);
static CLOSE_GENERATION: AtomicU64 = AtomicU64::new(0);
// Native dialogs are asynchronous. Keep one timeout warning visible even if
// the user retries close repeatedly while the previous warning is open.
static CLOSE_TIMEOUT_DIALOG_VISIBLE: AtomicBool = AtomicBool::new(false);
static CLOSE_STATE_LOCK: Mutex<()> = Mutex::new(());
pub static APP_QUITTING: AtomicBool = AtomicBool::new(false);

pub fn create_splash(app: &AppHandle) {
    if app.get_webview_window(SPLASH_WINDOW).is_some() {
        return;
    }
    let builder =
        WebviewWindowBuilder::new(app, SPLASH_WINDOW, WebviewUrl::App("splash.html".into()))
            .title("Zephus")
            .inner_size(360.0, 360.0)
            .resizable(false)
            .decorations(false)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .center();
    match builder.build() {
        Ok(splash) => {
            // A stuck splash must never outlive a failed startup.
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(30));
                let _ = splash.destroy();
            });
        }
        Err(error) => crate::logging::warn(&format!("Could not create splash window: {error}")),
    }
}

fn close_splash(app: &AppHandle) {
    if let Some(splash) = app.get_webview_window(SPLASH_WINDOW) {
        let _ = splash.destroy();
    }
}

/// Only the bundled frontend (and the Vite dev server in debug builds) may
/// load in the main webview.
pub fn is_app_url(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => {
            let host = url.host_str().unwrap_or_default();
            host == "tauri.localhost"
                || (cfg!(debug_assertions)
                    && matches!(host, "localhost" | "127.0.0.1")
                    && url.port() == Some(5173))
        }
        "about" => url.as_str() == "about:blank",
        _ => false,
    }
}

/// The preview webview may load only the local Astro dev server.
/// Userinfo is rejected: `http://127.0.0.1:1@127.0.0.1:9222/` is still a
/// loopback host, but the port that loads is 9222.
pub fn is_loopback_preview_url(url: &tauri::Url) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    matches!(url.scheme(), "http" | "https")
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"))
}

fn open_preview_external(app: &AppHandle, url: &tauri::Url) {
    use tauri_plugin_opener::OpenerExt;
    let scheme = url.scheme().to_string();
    let raw = url.as_str().to_string();
    let app = app.clone();
    std::thread::spawn(move || {
        let open = match scheme.as_str() {
            "mailto" | "tel" => true,
            "http" | "https" => crate::validation::is_safe_external_url(&raw),
            _ => false,
        };
        if open {
            let _ = app.opener().open_url(raw, None::<&str>);
        }
    });
}

fn allow_preview_navigation(url: &tauri::Url) -> bool {
    if url.as_str() == "about:blank" {
        return true;
    }
    let allowed = PREVIEW_PORT.load(Ordering::Relaxed);
    is_loopback_preview_url(url)
        && allowed != 0
        && url.port_or_known_default() == Some(allowed)
}

/// Opens the Astro dev server in a window with no Zephus IPC.
#[tauri::command]
pub fn open_preview_window(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(url.trim())
        .map_err(|_| "Refused to open a non-local preview URL.".to_string())?;
    if !is_loopback_preview_url(&parsed) {
        return Err("Refused to open a non-local preview URL.".to_string());
    }
    let port = parsed
        .port_or_known_default()
        .filter(|port| *port != 0)
        .ok_or_else(|| "Refused to open a non-local preview URL.".to_string())?;
    let previous = PREVIEW_PORT.swap(port, Ordering::Relaxed);
    if let Some(window) = app.get_webview_window(PREVIEW_WINDOW) {
        if let Err(error) = window.navigate(parsed) {
            PREVIEW_PORT.store(previous, Ordering::Relaxed);
            return Err(error.to_string());
        }
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    let navigation_app = app.clone();
    let popup_app = app.clone();
    WebviewWindowBuilder::new(&app, PREVIEW_WINDOW, WebviewUrl::External(parsed))
        .title("Zephus Preview")
        .inner_size(1280.0, 860.0)
        .min_inner_size(480.0, 480.0)
        .on_navigation(move |target| {
            if allow_preview_navigation(target) {
                return true;
            }
            open_preview_external(&navigation_app, target);
            false
        })
        .on_new_window(move |target, _features| {
            open_preview_external(&popup_app, &target);
            tauri::webview::NewWindowResponse::Deny
        })
        .build()
        .map_err(|error| {
            PREVIEW_PORT.store(previous, Ordering::Relaxed);
            error.to_string()
        })?;
    Ok(())
}

#[tauri::command]
pub fn close_preview_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PREVIEW_WINDOW) {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn on_preview_destroyed(app: &AppHandle) {
    PREVIEW_PORT.store(0, Ordering::Relaxed);
    use tauri::Emitter;
    let _ = app.emit_to(MAIN_WINDOW, "preview-closed", true);
}

/// Hand a blocked navigation to the system browser when it is a safe
/// external URL; everything else is dropped. Validation resolves DNS, so it
/// runs off the UI thread that delivers navigation callbacks.
fn open_blocked_url(app: &AppHandle, url: &tauri::Url) {
    use tauri_plugin_opener::OpenerExt;
    let app = app.clone();
    let url = url.clone();
    std::thread::spawn(move || {
        if crate::validation::is_safe_external_url(url.as_str()) {
            if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
                crate::logging::warn(&format!("Could not open external URL: {error}"));
            }
        } else {
            crate::logging::warn(&format!(
                "Blocked navigation to {} host {}",
                url.scheme(),
                url.host_str().unwrap_or("-")
            ));
        }
    });
}

/// Injected into every frame of the main window before page scripts run.
/// WebView2 honours F5 / Ctrl+R / Ctrl+P and every engine offers Reload in its
/// default context menu; a reload would drop unsaved editor state. Editable
/// fields and text selections keep their native menu so right-click Paste and
/// Copy still work.
const WEBVIEW_GUARD_SCRIPT: &str = r#"
(function () {
  if (window.__ZEPHUS_WEBVIEW_GUARD__) return;
  window.__ZEPHUS_WEBVIEW_GUARD__ = true;
  function editable(target) {
    var el = target instanceof Element ? target : null;
    if (!el) return false;
    if (el.closest("textarea, [contenteditable=''], [contenteditable='true']")) return true;
    var input = el.closest("input");
    return !!input && !/^(button|checkbox|radio|range|color|file|submit|reset|image)$/i.test(input.type);
  }
  document.addEventListener("contextmenu", function (event) {
    var selection = window.getSelection && window.getSelection();
    var hasSelection = !!selection && !selection.isCollapsed && String(selection).trim() !== "";
    if (!editable(event.target) && !hasSelection) event.preventDefault();
  }, true);
  window.addEventListener("keydown", function (event) {
    var key = String(event.key || "").toLowerCase();
    var mod = event.ctrlKey || event.metaKey;
    // Stop the webview Save, Open, and View Source commands. The editor still
    // receives Ctrl/Cmd+S and saves the project. Ctrl/Cmd+F stays available.
    if (key === "f5" || (mod && !event.altKey && (key === "r" || key === "p" || key === "s" || key === "o" || key === "u"))) {
      event.preventDefault();
    }
  }, true);
})();
"#;

/// Native title bar appearance for a saved theme preference. Dark and purple
/// pin a dark bar so it matches the page even when the system appearance is
/// light; the renderer keeps it in sync on later theme changes.
fn apply_saved_theme(app: &AppHandle, theme: crate::types::Theme) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.set_theme(window_theme(theme));
    }
}

/// Mirrors the editor's theme and update channel into the shell settings.
/// `recheck` runs the updater channel change only when the channel itself
/// changed; opening the app must not start a check.
#[tauri::command]
pub async fn apply_editor_settings(
    app: AppHandle,
    theme: String,
    update_channel: String,
    recheck: bool,
) {
    use crate::types::{Theme, UpdateChannel};

    let mut patch = serde_json::Map::new();
    if Theme::parse(&theme).is_some() {
        patch.insert("theme".into(), serde_json::json!(theme));
    }
    let channel = UpdateChannel::parse(&update_channel);
    if channel.is_some() {
        patch.insert("updateChannel".into(), serde_json::json!(update_channel));
    }
    if patch.is_empty() {
        return;
    }
    if let Ok(saved) = crate::settings::save_patch(&patch) {
        apply_saved_theme(&app, saved.theme);
    }
    if recheck {
        if let Some(channel) = channel {
            crate::updater::set_update_channel(crate::ipc::FalliblePayload::Typed(channel)).await;
        }
    }
}

fn window_theme(preference: crate::types::Theme) -> Option<tauri::Theme> {
    use crate::types::Theme;
    match preference {
        Theme::Light => Some(tauri::Theme::Light),
        Theme::Dark | Theme::Purple => Some(tauri::Theme::Dark),
        Theme::System => None,
    }
}

fn build_main(app: &AppHandle) -> Result<WebviewWindow, String> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW)
        .cloned()
        .ok_or_else(|| "tauri.conf.json has no main window".to_string())?;
    let navigation_app = app.clone();
    let popup_app = app.clone();
    let builder =
        WebviewWindowBuilder::from_config(app, &config).map_err(|error| error.to_string())?;
    // E2E specs keep sampling the page while the window sits behind other apps.
    // Windows ignores `focused` for a window created hidden; `e2e_windows`
    // keeps the reveal from activating it there.
    #[cfg(feature = "e2e")]
    let builder = builder
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .focused(!e2e_background());
    let smoke = std::env::var("ZEPHUS_SMOKE").ok().as_deref() == Some("1");
    let boot_check = std::env::var("ZEPHUS_BOOT_CHECK").ok().as_deref() == Some("1");
    let mut builder = builder
        .theme(window_theme(crate::settings::load().theme))
        .initialization_script_for_all_frames(WEBVIEW_GUARD_SCRIPT);
    if smoke {
        builder = builder.initialization_script("window.__ZEPHUS_SMOKE__ = true;");
    }
    if boot_check {
        builder = builder.initialization_script("window.__ZEPHUS_BOOT_CHECK__ = true;");
    }
    if let Some(saved) = read_saved_window() {
        *PENDING_WINDOW
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(saved.clone());
        builder = builder.inner_size(saved.width, saved.height);
        if let (Some(x), Some(y)) = (saved.x, saved.y) {
            if saved_position_visible(app, x, y, saved.width, saved.height) {
                builder = builder.position(x, y);
            }
        }
        if saved.maximized {
            builder = builder.maximized(true);
        }
    }
    builder
        .on_navigation(move |url| {
            if is_app_url(url) {
                return true;
            }
            open_blocked_url(&navigation_app, url);
            false
        })
        .on_new_window(move |url, _features| {
            open_blocked_url(&popup_app, &url);
            tauri::webview::NewWindowResponse::Deny
        })
        .build()
        .map_err(|error| error.to_string())
        .inspect(|window| {
            #[cfg(all(feature = "e2e", target_os = "macos"))]
            if e2e_background() {
                e2e_occlusion::keep_rendering(window);
            }
            if window.is_maximized().unwrap_or(false) {
                return;
            }
            let saved = PENDING_WINDOW
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clone();
            fit_to_work_area(window);
            restore_saved_position(window, saved.as_ref());
        })
}

#[derive(Clone)]
struct SavedWindow {
    width: f64,
    height: f64,
    x: Option<f64>,
    y: Option<f64>,
    maximized: bool,
}

static PENDING_WINDOW: Mutex<Option<SavedWindow>> = Mutex::new(None);
static WINDOW_PERSIST_GEN: AtomicU64 = AtomicU64::new(0);

fn session_controls_window() -> bool {
    std::env::var("ZEPHUS_SMOKE").ok().as_deref() == Some("1")
        || std::env::var("ZEPHUS_BOOT_CHECK").ok().as_deref() == Some("1")
}

fn window_state_path() -> Option<std::path::PathBuf> {
    Some(
        crate::editor_user_data_dir()
            .ok()?
            .join("window-state.json"),
    )
}

fn read_saved_window() -> Option<SavedWindow> {
    if session_controls_window() {
        return None;
    }
    let text = std::fs::read_to_string(window_state_path()?).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let width = value.get("width")?.as_f64()?;
    let height = value.get("height")?.as_f64()?;
    if !(width.is_finite()
        && height.is_finite()
        && (960.0..=16_000.0).contains(&width)
        && (640.0..=16_000.0).contains(&height))
    {
        return None;
    }
    let coordinate = |name: &str| {
        value
            .get(name)
            .and_then(serde_json::Value::as_f64)
            .filter(|number| number.is_finite() && (-32_000.0..=32_000.0).contains(number))
    };
    Some(SavedWindow {
        width,
        height,
        x: coordinate("x"),
        y: coordinate("y"),
        maximized: value
            .get("maximized")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
    })
}

fn saved_position_visible(app: &AppHandle, x: f64, y: f64, width: f64, height: f64) -> bool {
    let Ok(monitors) = app.available_monitors() else {
        return false;
    };
    monitors.iter().any(|monitor| {
        let scale = monitor.scale_factor();
        if scale <= 0.0 {
            return false;
        }
        let origin = monitor.position();
        let size = monitor.size();
        let left = origin.x as f64 / scale;
        let top = origin.y as f64 / scale;
        let right = left + size.width as f64 / scale;
        let bottom = top + size.height as f64 / scale;
        x < right && x + width > left && y < bottom && y + height > top
    })
}

fn capture_main_bounds(window: &WebviewWindow) {
    let Ok(scale) = window.scale_factor() else {
        return;
    };
    if scale <= 0.0 {
        return;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    let mut slot = PENDING_WINDOW
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if maximized {
        match slot.as_mut() {
            Some(existing) => existing.maximized = true,
            None => {
                *slot = Some(SavedWindow {
                    width: 1280.0,
                    height: 820.0,
                    x: None,
                    y: None,
                    maximized: true,
                });
            }
        }
        return;
    }
    let Ok(inner) = window.inner_size() else {
        return;
    };
    let width = inner.width as f64 / scale;
    let height = inner.height as f64 / scale;
    if !(960.0..=16_000.0).contains(&width) || !(640.0..=16_000.0).contains(&height) {
        return;
    }
    let pos = window.outer_position().ok();
    *slot = Some(SavedWindow {
        width,
        height,
        x: pos.map(|point| point.x as f64 / scale),
        y: pos.map(|point| point.y as f64 / scale),
        maximized: false,
    });
}

fn write_saved_window() {
    let snapshot = PENDING_WINDOW
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    let Some(state) = snapshot else {
        return;
    };
    let Some(path) = window_state_path() else {
        return;
    };
    let mut body = serde_json::json!({
        "width": state.width.round(),
        "height": state.height.round(),
        "maximized": state.maximized,
    });
    if let Some(x) = state.x {
        body["x"] = serde_json::json!(x.round());
    }
    if let Some(y) = state.y {
        body["y"] = serde_json::json!(y.round());
    }
    if let Err(error) = crate::fs_util::write_json(&path, &body) {
        crate::logging::warn(&format!("Could not save window placement: {error}"));
    }
}

/// Remembers the main window after a move or resize. Smoke and boot-check
/// must not overwrite the user's saved placement.
pub fn note_main_window_bounds(app: &AppHandle) {
    if session_controls_window() {
        return;
    }
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    capture_main_bounds(&window);
    let generation = WINDOW_PERSIST_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        if WINDOW_PERSIST_GEN.load(Ordering::SeqCst) != generation {
            return;
        }
        write_saved_window();
    });
}

fn flush_main_window_bounds(app: &AppHandle) {
    if session_controls_window() {
        return;
    }
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        capture_main_bounds(&window);
    }
    write_saved_window();
}

/// The configured 1200x900 (logical) window is taller than the work area of
/// common 1366x768 laptops at 125% scaling, which leaves the bottom of the UI
/// under the taskbar. Shrink it to fit the monitor the window opens on; the
/// page itself scrolls, and the OS still enforces the configured minimum.
fn fit_to_work_area(window: &WebviewWindow) {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let (Some(monitor), Ok(outer), Ok(inner)) = (monitor, window.outer_size(), window.inner_size())
    else {
        return;
    };
    let area = monitor.work_area().size;
    let max_width = area.width.saturating_mul(95) / 100;
    let max_height = area.height.saturating_mul(95) / 100;
    if outer.width <= max_width && outer.height <= max_height {
        return;
    }
    let frame_width = outer.width.saturating_sub(inner.width);
    let frame_height = outer.height.saturating_sub(inner.height);
    let size = tauri::PhysicalSize::new(
        outer.width.min(max_width).saturating_sub(frame_width),
        outer.height.min(max_height).saturating_sub(frame_height),
    );
    let _ = window.set_size(size);
    let _ = window.center();
}

/// The config centers every new window. Put a saved placement back after that
/// when the window still has the saved size. A window that had to shrink stays
/// centered on the visible work area.
fn restore_saved_position(window: &WebviewWindow, saved: Option<&SavedWindow>) {
    let Some(saved) = saved else {
        return;
    };
    let (Some(x), Some(y)) = (saved.x, saved.y) else {
        return;
    };
    let Ok(scale) = window.scale_factor() else {
        return;
    };
    if scale <= 0.0 {
        return;
    }
    let Ok(inner) = window.inner_size() else {
        return;
    };
    let width = inner.width as f64 / scale;
    let height = inner.height as f64 / scale;
    if (width - saved.width).abs() > 2.0 || (height - saved.height).abs() > 2.0 {
        return;
    }
    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
}

/// Background E2E runs on macOS and Windows: the app never takes focus and its
/// window stays below other apps. scripts/test-e2e.js sets
/// `ROSI_E2E_BACKGROUND=1` unless CI or `ROSI_E2E_FOREGROUND=1` is set.
#[cfg(feature = "e2e")]
pub fn e2e_background() -> bool {
    (cfg!(target_os = "macos") || cfg!(target_os = "windows"))
        && std::env::var("ROSI_E2E_BACKGROUND").as_deref() == Ok("1")
}

/// Win32 reveal for Windows background runs. tao cannot show a window that was
/// created hidden without activating it: it removes its no-activate marker when
/// creation ends, so its `show` calls `ShowWindow(SW_SHOW)`, and `unminimize`
/// restores with activation. This path therefore uses Win32 directly.
///
/// tao's VISIBLE flag stays clear on purpose. With it set, every later tao flag
/// change runs `ShowWindow(SW_SHOW)` and activates the window. With it clear,
/// every later tao flag change runs `ShowWindow(SW_HIDE)` and hides it. So the
/// background path makes no tao flag setter calls after the reveal, and it does
/// not call tao's `set_always_on_bottom`, which goes through the same path.
/// `is_visible` reads `IsWindowVisible`, so it still reports the real state.
#[cfg(all(feature = "e2e", target_os = "windows"))]
mod e2e_windows {
    use tauri::WebviewWindow;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, ShowWindow, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        SW_SHOWNOACTIVATE,
    };

    pub fn reveal_without_activation(window: &WebviewWindow) {
        let hwnd = match window.hwnd() {
            Ok(hwnd) => hwnd.0,
            Err(error) => {
                crate::logging::warn(&format!(
                    "E2E background: could not reach the main window ({error}); it stays hidden."
                ));
                return;
            }
        };
        let flags = SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE;
        // SAFETY: `hwnd` is the live main-window handle from tauri. These calls
        // only change z-order and show state; none of them activates a window.
        unsafe {
            // Move to the bottom while hidden, so the first visible frame is
            // already below other windows.
            let _ = SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, flags);
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            // A newly shown window may land on top, so move it down again.
            let _ = SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, flags);
        }
    }
}

/// E2E background runs keep the main page rendering while the window sits
/// behind other apps. WebKit treats a covered window as occluded and marks the
/// page hidden, which stops animation frames and CSS transitions. Turning
/// WebKit's occlusion detection off for the main webview leaves the window's
/// level, focus and visibility alone. The selector is private, so every call
/// goes through `respondsToSelector:` first and a missing selector is only
/// logged.
#[cfg(all(feature = "e2e", target_os = "macos"))]
mod e2e_occlusion {
    use std::ffi::{c_char, c_void};
    use tauri::WebviewWindow;

    type Id = *mut c_void;
    type Sel = *mut c_void;

    #[link(name = "objc", kind = "dylib")]
    extern "C" {
        fn sel_registerName(name: *const c_char) -> Sel;
        // Never called through this declaration. Each call casts its address to
        // the exact signature it uses, which arm64 requires.
        fn objc_msgSend();
    }

    /// Stops WebKit from reporting the main webview as occluded. `with_webview`
    /// runs the closure on the main thread (WKWebView access requires it) and
    /// does nothing if the webview is already gone.
    pub fn keep_rendering(window: &WebviewWindow) {
        let result = window.with_webview(|webview| {
            // SAFETY: called on the main thread by `with_webview`; the pointer
            // is the live WKWebView that wry owns for this webview.
            let outcome = unsafe { disable_occlusion_detection(webview.inner()) };
            match outcome {
                Ok(previous) => crate::logging::info(&format!(
                    "E2E background: WebKit occlusion detection off for the main webview (was {}).",
                    if previous { "on" } else { "off" }
                )),
                Err(reason) => crate::logging::warn(&format!(
                    "E2E background: occlusion detection not changed ({reason}); the page may pause while hidden."
                )),
            }
        });
        if let Err(error) = result {
            crate::logging::warn(&format!(
                "E2E background: could not reach the main webview ({error})."
            ));
        }
    }

    /// Returns the previous setting when the private accessors exist.
    ///
    /// # Safety
    /// `view` must be null or a valid WKWebView pointer, and the caller must be
    /// on the main thread.
    unsafe fn disable_occlusion_detection(view: *mut c_void) -> Result<bool, &'static str> {
        if view.is_null() {
            return Err("no WKWebView");
        }
        let send_responds: unsafe extern "C" fn(Id, Sel, Sel) -> i8 =
            std::mem::transmute(objc_msgSend as *const c_void);
        let send_get: unsafe extern "C" fn(Id, Sel) -> i8 =
            std::mem::transmute(objc_msgSend as *const c_void);
        let send_set: unsafe extern "C" fn(Id, Sel, i8) =
            std::mem::transmute(objc_msgSend as *const c_void);

        let responds = sel_registerName(c"respondsToSelector:".as_ptr());
        let getter = sel_registerName(c"_windowOcclusionDetectionEnabled".as_ptr());
        let setter = sel_registerName(c"_setWindowOcclusionDetectionEnabled:".as_ptr());
        if send_responds(view, responds, getter) == 0 || send_responds(view, responds, setter) == 0
        {
            return Err("private selector missing on this WebKit");
        }
        let previous = send_get(view, getter) != 0;
        send_set(view, setter, 0);
        Ok(previous)
    }
}

fn reveal(window: &WebviewWindow) {
    #[cfg(feature = "e2e")]
    if e2e_background() {
        reveal_e2e_background(window);
        return;
    }
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// macOS keeps its tao-based reveal. Windows never calls tao's `unminimize`,
/// `show`, or `set_focus` here; see `e2e_windows`.
#[cfg(feature = "e2e")]
fn reveal_e2e_background(window: &WebviewWindow) {
    #[cfg(target_os = "windows")]
    e2e_windows::reveal_without_activation(window);
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window.unminimize();
        let _ = window.set_always_on_bottom(true);
        let _ = window.show();
    }
}

/// Create the (hidden) main window if needed, or focus the existing one.
pub fn show_main_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        if MAIN_READY.load(Ordering::SeqCst) {
            reveal(&window);
        } else if let Some(splash) = app.get_webview_window(SPLASH_WINDOW) {
            // Relaunched while still starting: bring the splash forward so the
            // second launch visibly lands on the running instance.
            let _ = splash.set_focus();
        }
        return Ok(());
    }
    MAIN_READY.store(false, Ordering::SeqCst);
    let window = build_main(app)?;
    let generation = CLOSE_GENERATION.load(Ordering::SeqCst);
    let handle = app.clone();
    // Fallback: reveal even if the renderer never reports readiness.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(15));
        if CLOSE_GENERATION.load(Ordering::SeqCst) != generation
            || MAIN_READY.load(Ordering::SeqCst)
        {
            return;
        }
        crate::logging::warn("Main window did not report ready in time; showing it anyway.");
        let main_thread = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            close_splash(&main_thread);
            reveal(&window);
        });
    });
    Ok(())
}

fn exit_boot_check() -> ! {
    #[cfg(windows)]
    unsafe {
        windows_sys::Win32::System::Threading::TerminateProcess(
            windows_sys::Win32::System::Threading::GetCurrentProcess(),
            0,
        );
        std::process::abort();
    }
    #[cfg(not(windows))]
    unsafe {
        libc::_exit(0);
    }
}

#[tauri::command]
pub fn mark_main_window_ready(app: AppHandle, window: WebviewWindow) {
    if window.label() != MAIN_WINDOW || MAIN_READY.swap(true, Ordering::SeqCst) {
        return;
    }
    crate::logging::info("Main window reported ready.");
    if std::env::var("ZEPHUS_BOOT_CHECK").ok().as_deref() == Some("1") {
        crate::logging::info("[boot-check] packaged renderer loaded successfully");
        crate::logging::info("[boot-check] stopping process");
        APP_QUITTING.store(true, Ordering::SeqCst);
        crate::shutdown_node_backend_now();
        let _ = std::io::Write::flush(&mut std::io::stdout());
        // std::process::exit runs atexit handlers that wait on this event loop.
        exit_boot_check();
    }
    let delay = if app.get_webview_window(SPLASH_WINDOW).is_some() {
        SPLASH_FADE_DELAY
    } else {
        std::time::Duration::ZERO
    };
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            close_splash(&handle);
            reveal(&window);
        });
    });
}

fn destroy_main(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        cancel_close();
        return Err("The main window was unavailable after state flush.".into());
    };
    if let Err(error) = window.destroy() {
        cancel_close();
        return Err(format!("Could not close the main window: {error}"));
    }
    Ok(())
}

fn cancel_close() {
    let _state = CLOSE_STATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    cancel_close_locked();
    crate::logging::warn("Close cancelled because durable state could not be confirmed.");
}

fn cancel_close_locked() {
    CLOSE_IN_PROGRESS.store(false, Ordering::SeqCst);
    CLOSE_CONFIRMING.store(false, Ordering::SeqCst);
    CLOSE_ACKNOWLEDGED.store(false, Ordering::SeqCst);
    CLOSE_GENERATION.fetch_add(1, Ordering::SeqCst);
    APP_QUITTING.store(false, Ordering::SeqCst);
}

/// The editor kept the window open (unsaved work was cancelled).
#[tauri::command]
pub fn cancel_editor_close(generation: u64) -> Result<(), String> {
    if cancel_close_generation(generation) {
        crate::logging::info("Editor cancelled close.");
        return Ok(());
    }
    Err("The close request is no longer current.".into())
}

fn cancel_close_generation(generation: u64) -> bool {
    let _state = CLOSE_STATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if CLOSE_GENERATION.load(Ordering::SeqCst) != generation
        || !CLOSE_IN_PROGRESS.load(Ordering::SeqCst)
    {
        return false;
    }
    cancel_close_locked();
    true
}

fn expire_unacknowledged_close_generation(generation: u64) -> bool {
    let _state = CLOSE_STATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if CLOSE_GENERATION.load(Ordering::SeqCst) != generation
        || !CLOSE_IN_PROGRESS.load(Ordering::SeqCst)
        || CLOSE_ACKNOWLEDGED.load(Ordering::SeqCst)
    {
        return false;
    }
    cancel_close_locked();
    true
}

fn acknowledge_close_generation(generation: u64) -> bool {
    let _state = CLOSE_STATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if CLOSE_GENERATION.load(Ordering::SeqCst) != generation
        || !CLOSE_IN_PROGRESS.load(Ordering::SeqCst)
    {
        return false;
    }
    CLOSE_ACKNOWLEDGED.store(true, Ordering::SeqCst);
    true
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub fn e2e_cancel_close_request(window: WebviewWindow, generation: u64) -> Result<(), String> {
    if window.label() != MAIN_WINDOW {
        return Err("Only the main window may cancel an E2E close request.".into());
    }
    let _state = CLOSE_STATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if CLOSE_GENERATION.load(Ordering::SeqCst) != generation
        || !CLOSE_IN_PROGRESS.load(Ordering::SeqCst)
    {
        return Err("The E2E close request is no longer current.".into());
    }
    CLOSE_IN_PROGRESS.store(false, Ordering::SeqCst);
    CLOSE_CONFIRMING.store(false, Ordering::SeqCst);
    CLOSE_ACKNOWLEDGED.store(false, Ordering::SeqCst);
    CLOSE_GENERATION.fetch_add(1, Ordering::SeqCst);
    APP_QUITTING.store(false, Ordering::SeqCst);
    crate::logging::info("E2E close request retired after renderer flush acknowledgement.");
    Ok(())
}

fn close_generation_is_current(generation: u64) -> bool {
    let _state = CLOSE_STATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    CLOSE_IN_PROGRESS.load(Ordering::SeqCst)
        && CLOSE_GENERATION.load(Ordering::SeqCst) == generation
}

fn consume_close_generation(generation: u64) -> bool {
    let _state = CLOSE_STATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !CLOSE_IN_PROGRESS.load(Ordering::SeqCst)
        || !CLOSE_ACKNOWLEDGED.load(Ordering::SeqCst)
        || CLOSE_GENERATION.load(Ordering::SeqCst) != generation
    {
        return false;
    }
    // Retire the token before releasing the lock so a late timeout cannot
    // cancel this close after durability has been confirmed.
    CLOSE_GENERATION.fetch_add(1, Ordering::SeqCst);
    CLOSE_ACKNOWLEDGED.store(false, Ordering::SeqCst);
    true
}

fn begin_flush_and_close(app: AppHandle) {
    let generation = {
        let _state = CLOSE_STATE_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        CLOSE_IN_PROGRESS.store(true, Ordering::SeqCst);
        CLOSE_ACKNOWLEDGED.store(false, Ordering::SeqCst);
        CLOSE_GENERATION.fetch_add(1, Ordering::SeqCst) + 1
    };
    crate::app_state::emit("prepare-for-close", generation);
    std::thread::spawn(move || {
        std::thread::sleep(SETTINGS_FLUSH_TIMEOUT);
        if expire_unacknowledged_close_generation(generation) {
            crate::logging::warn(
                "Timed out waiting for renderer settings flush; leaving the app open.",
            );
            if CLOSE_TIMEOUT_DIALOG_VISIBLE
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
            {
                offer_forced_close(
                    &app,
                    "Save Still Pending",
                    "Zephus could not confirm that settings were saved.\n\nKeep Zephus open and try closing again after the save finishes, or close without saving the latest changes.",
                    || CLOSE_TIMEOUT_DIALOG_VISIBLE.store(false, Ordering::SeqCst),
                );
            }
        }
    });
}

/// Main window close: confirm while a download or queue is active, ask the
/// renderer to flush pending settings, then destroy the window.
pub fn on_main_close_requested(app: &AppHandle, api: &tauri::CloseRequestApi) {
    if std::env::var("ZEPHUS_BOOT_CHECK").ok().as_deref() == Some("1")
        || std::env::var("ZEPHUS_SMOKE").ok().as_deref() == Some("1")
    {
        return;
    }
    flush_main_window_bounds(app);
    api.prevent_close();
    if CLOSE_IN_PROGRESS.load(Ordering::SeqCst) || CLOSE_CONFIRMING.swap(true, Ordering::SeqCst) {
        return;
    }
    let handle = app.clone();
    CLOSE_CONFIRMING.store(false, Ordering::SeqCst);
    begin_flush_and_close(handle);
}

#[tauri::command]
pub async fn notify_settings_flushed(
    app: AppHandle,
    window: WebviewWindow,
    generation: u64,
) -> Result<(), String> {
    if window.label() != MAIN_WINDOW {
        return Err("Only the main window can complete a close request.".into());
    }
    if !acknowledge_close_generation(generation) {
        return Err("The close request expired before its state flush completed.".into());
    }
    let shutdown = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(feature = "e2e")]
        if let Some(delay) = std::env::var("ROSI_E2E_CLOSE_SHUTDOWN_DELAY_MS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .map(|milliseconds| milliseconds.min(10_000))
        {
            std::thread::sleep(std::time::Duration::from_millis(delay));
        }
        shutdown_for_close(generation)
    })
    .await;
    let shutdown = match shutdown {
        Ok(result) => result,
        Err(error) => Err(format!("Could not finish application shutdown: {error}")),
    };
    if let Err(error) = shutdown {
        cancel_close_generation(generation);
        offer_forced_close(
            &app,
            "Could Not Save Before Closing",
            &format!("Zephus could not durably save its state before closing.\n\n{error}\n\nKeep Zephus open to retry, or close without saving the latest changes."),
            || {},
        );
        return Err(format!(
            "Could not durably save application state before closing: {error}"
        ));
    }
    if !consume_close_generation(generation) {
        return Err("The close request expired before its state flush completed.".into());
    }
    destroy_main(&app)?;
    crate::logging::info("Settings flushed; closing main window.");
    Ok(())
}

pub fn on_main_destroyed(app: &AppHandle) {
    flush_main_window_bounds(app);
    crate::logging::info("Main window closed.");
    MAIN_READY.store(false, Ordering::SeqCst);
    {
        let _state = CLOSE_STATE_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        CLOSE_IN_PROGRESS.store(false, Ordering::SeqCst);
        CLOSE_ACKNOWLEDGED.store(false, Ordering::SeqCst);
        CLOSE_GENERATION.fetch_add(1, Ordering::SeqCst);
    }
    close_splash(app);
    if cfg!(target_os = "macos") && !APP_QUITTING.load(Ordering::SeqCst) {
        // macOS keeps the app in the Dock; a closed window still stops work.
        stop_active_work();
        return;
    }
    if APP_QUITTING.load(Ordering::SeqCst) {
        app.exit(0);
    }
}

/// Last resort when durable state cannot be confirmed (for example a stuck
/// renderer or an unwritable profile): the user may close anyway. Active work
/// still stops and the queue gets one best-effort write first.
fn offer_forced_close(
    app: &AppHandle,
    title: &str,
    message: &str,
    on_dismiss: impl FnOnce() + Send + 'static,
) {
    let handle = app.clone();
    let mut dialog = app
        .dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Close Without Saving".to_string(),
            "Keep Zephus Open".to_string(),
        ));
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        dialog = dialog.parent(&window);
    }
    dialog.show(move |close| {
        on_dismiss();
        if !close {
            APP_QUITTING.store(false, Ordering::SeqCst);
            return;
        }
        std::thread::spawn(move || force_close(handle));
    });
}

fn force_close(app: AppHandle) {
    crate::logging::warn("Closing without confirmed durable state at the user's request.");
    stop_active_work();
    {
        let _state = CLOSE_STATE_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        CLOSE_IN_PROGRESS.store(true, Ordering::SeqCst);
        CLOSE_GENERATION.fetch_add(1, Ordering::SeqCst);
    }
    let main_thread = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = main_thread.get_webview_window(MAIN_WINDOW) {
            if let Err(error) = window.destroy() {
                crate::logging::error(&format!("Could not close the main window: {error}"));
                cancel_close();
            }
        }
    });
}

pub fn stop_active_work() {}

fn shutdown_with_close_generation(generation: Option<u64>) -> Result<(), String> {
    if let Some(generation) = generation {
        if !close_generation_is_current(generation) {
            return Err("The close request expired before shutdown completed.".into());
        }
    }
    stop_active_work();
    Ok(())
}

fn shutdown_for_close(generation: u64) -> Result<(), String> {
    shutdown_with_close_generation(Some(generation))
}

pub fn shutdown() -> Result<(), String> {
    shutdown_with_close_generation(None)
}

pub fn restart_with(
    app: &AppHandle,
    before_restart: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    APP_QUITTING.store(true, Ordering::SeqCst);
    if let Err(error) = shutdown().and_then(|()| before_restart()) {
        APP_QUITTING.store(false, Ordering::SeqCst);
        return Err(error);
    }
    app.restart()
}

pub fn restart(app: &AppHandle) -> Result<(), String> {
    restart_with(app, || Ok(()))
}

#[tauri::command]
pub async fn restart_app(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || restart(&app))
        .await
        .map_err(|error| error.to_string())?
}
