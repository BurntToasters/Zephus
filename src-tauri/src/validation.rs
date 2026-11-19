//! Security boundary for everything the webview sends: URL safety (no private
//! or loopback targets), download/file path allow-lists, and strict payload
//! validation for download requests, settings patches, and queue operations.

use crate::ip_policy::{is_public_ip, is_public_ipv4, is_public_ipv6};
use crate::ipc::{
    FalliblePayload, IpcError, JsonObject, INVALID_PATH, INVALID_URL, VALIDATION_ERROR,
};
use crate::types::{NotificationInput, NotificationRequest};
use serde_json::Value;
use std::net::{Ipv4Addr, ToSocketAddrs};
use std::path::{Component, Path, PathBuf};

// ---------------------------------------------------------------------------
// URLs

/// inet_aton-style IPv4 parsing (hex/octal/shorthand), matching how resolvers
/// may interpret a hostname that the URL parser left as a domain.
fn canonical_ipv4(host: &str) -> Option<Ipv4Addr> {
    if host.is_empty()
        || !host
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '.' || c == 'x' || c == 'X')
    {
        return None;
    }
    let parts: Vec<&str> = host.split('.').collect();
    if parts.len() > 4 {
        return None;
    }
    let mut numbers = Vec::with_capacity(parts.len());
    for part in &parts {
        let lower = part.to_ascii_lowercase();
        let value = if let Some(hex) = lower.strip_prefix("0x") {
            u64::from_str_radix(hex, 16).ok()?
        } else if lower.len() > 1 && lower.starts_with('0') {
            u64::from_str_radix(&lower[1..], 8).ok()?
        } else if !lower.is_empty() && lower.bytes().all(|b| b.is_ascii_digit()) {
            lower.parse::<u64>().ok()?
        } else {
            return None;
        };
        numbers.push(value);
    }
    let (last, head) = numbers.split_last()?;
    if head.iter().any(|value| *value > 0xff) {
        return None;
    }
    let max_last = match numbers.len() {
        1 => 0xffff_ffff,
        2 => 0xff_ffff,
        3 => 0xffff,
        _ => 0xff,
    };
    if *last > max_last {
        return None;
    }
    let mut value: u64 = 0;
    for (index, part) in head.iter().enumerate() {
        value |= part << (24 - 8 * index);
    }
    value += last;
    Some(Ipv4Addr::from(value as u32))
}

fn is_rebinding_hostname(host: &str) -> bool {
    [
        ".nip.io",
        ".sslip.io",
        ".localtest.me",
        ".lvh.me",
        ".xip.io",
    ]
    .iter()
    .any(|suffix| host.ends_with(suffix) || host == &suffix[1..])
}

pub fn is_private_or_local_host(host: &url::Host<&str>) -> bool {
    match host {
        url::Host::Ipv4(ip) => !is_public_ipv4(*ip),
        url::Host::Ipv6(ip) => !is_public_ipv6(*ip),
        url::Host::Domain(domain) => {
            let host = domain.trim().trim_end_matches('.').to_ascii_lowercase();
            host.is_empty()
                || host == "localhost"
                || host.ends_with(".localhost")
                || is_rebinding_hostname(&host)
                || canonical_ipv4(&host).is_some_and(|ip| !is_public_ipv4(ip))
        }
    }
}

#[cfg(feature = "e2e")]
fn e2e_allows_loopback(host: &url::Host<&str>) -> bool {
    std::env::var("ROSI_E2E_ALLOW_LOOPBACK").as_deref() == Ok("1")
        && matches!(host, url::Host::Ipv4(ip) if ip.is_loopback())
}

#[cfg(not(feature = "e2e"))]
fn e2e_allows_loopback(_host: &url::Host<&str>) -> bool {
    false
}

fn parse_web_url(value: &str) -> Option<url::Url> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let url = url::Url::parse(trimmed).ok()?;
    matches!(url.scheme(), "http" | "https").then_some(url)
}

/// Checks stable URL syntax and literal-host policy without consulting DNS.
/// Persistence and metadata parsing use this so temporary resolver failures
/// cannot erase user data or unparse otherwise valid extractor output.
pub fn is_syntactically_safe_http_url(value: &str) -> bool {
    let Some(url) = parse_web_url(value) else {
        return false;
    };
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let Some(host) = url.host() else {
        return false;
    };
    e2e_allows_loopback(&host) || !is_private_or_local_host(&host)
}

/// Accepts a syntactically safe internal HTTP(S) URL. DNS is deliberately
/// deferred until a cancellable operation is reserved and the pinned proxy is
/// ready to connect to the exact vetted address set.
pub fn is_safe_http_url(value: &str) -> bool {
    is_syntactically_safe_http_url(value)
}

/// Validates DNS answers immediately before handing a URL to the system
/// browser/opener. ROSI cannot control DNS resolution or redirects performed
/// after the external application receives the URL; internal preview, formats,
/// and downloads use the pinned `network_security` proxy instead.
pub fn is_safe_external_url(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return false;
    }
    let Ok(url) = url::Url::parse(trimmed) else {
        return false;
    };
    match url.scheme() {
        "mailto" | "ms-windows-store" => true,
        "http" | "https" => {
            url.host()
                .is_some_and(|host| !is_private_or_local_host(&host))
                && is_public_http_destination(trimmed)
        }
        _ => false,
    }
}

fn host_string(host: &url::Host<&str>) -> String {
    match host {
        url::Host::Domain(name) => (*name).to_string(),
        url::Host::Ipv4(ip) => ip.to_string(),
        url::Host::Ipv6(ip) => ip.to_string(),
    }
}

fn is_public_http_destination(value: &str) -> bool {
    let Ok(url) = url::Url::parse(value.trim()) else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return false;
    }
    let Some(url_host) = url.host() else {
        return false;
    };
    let host = host_string(&url_host);
    let Some(port) = url.port_or_known_default() else {
        return false;
    };
    let Ok(addresses) = (host.as_str(), port).to_socket_addrs() else {
        return false;
    };
    let addresses: Vec<_> = addresses.collect();
    !addresses.is_empty() && addresses.iter().all(|addr| is_public_ip(addr.ip()))
}

/// Canonical queue URL: a safe http(s) URL without its fragment.
pub fn normalize_queue_url(value: &str) -> Option<String> {
    if !is_syntactically_safe_http_url(value) {
        return None;
    }
    let mut url = url::Url::parse(value.trim()).ok()?;
    url.set_fragment(None);
    Some(url.to_string())
}

// ---------------------------------------------------------------------------
// Paths

fn has_drive_prefix(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

pub fn is_absolute_path(value: &str) -> bool {
    Path::new(value).is_absolute() || has_drive_prefix(value)
}

/// Lexical `path.resolve`: absolute, with `.` and `..` segments removed.
pub fn resolve_path(value: impl AsRef<Path>) -> PathBuf {
    let value = value.as_ref();
    let absolute = if value.is_absolute() {
        value.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("/"))
            .join(value)
    };
    let mut normalized = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
                normalized.push(component.as_os_str())
            }
            Component::CurDir => {}
            Component::ParentDir => {
                let at_root = normalized.parent().is_none();
                if !at_root {
                    normalized.pop();
                }
            }
        }
    }
    normalized
}

fn comparable(path: &Path) -> PathBuf {
    if cfg!(any(windows, target_os = "macos")) {
        PathBuf::from(path.to_string_lossy().to_lowercase())
    } else {
        path.to_path_buf()
    }
}

pub fn is_path_within(candidate: &Path, base: &Path) -> bool {
    comparable(&resolve_path(candidate)).starts_with(comparable(&resolve_path(base)))
}

/// Lexical rules plus, on Unix, the same rules for the real (symlink-resolved)
/// location of the deepest existing ancestor. This stops aliases such as
/// `/Volumes/Macintosh HD/...` or a link in the home folder from reaching
/// system folders.
fn is_allowed_download_base(resolved: &Path) -> bool {
    if !is_allowed_download_base_lexical(resolved) {
        return false;
    }
    #[cfg(unix)]
    {
        let mut existing = resolved;
        while !existing.exists() {
            match existing.parent() {
                Some(parent) => existing = parent,
                None => return true,
            }
        }
        if let Ok(real) = existing.canonicalize() {
            return is_allowed_download_base_lexical(&real)
                || canonical_bases()
                    .iter()
                    .any(|base| is_path_within(&real, base));
        }
    }
    true
}

/// Allowed roots with their own symlinks resolved, for comparing against a
/// resolved candidate (for example a home folder that is itself a link).
#[cfg(unix)]
fn canonical_bases() -> Vec<PathBuf> {
    let mut bases: Vec<PathBuf> = crate::app_state::home_dir().into_iter().collect();
    if cfg!(target_os = "macos") {
        bases.push(PathBuf::from("/Volumes"));
    }
    if cfg!(target_os = "linux") {
        bases.extend(["/mnt", "/media", "/run/media"].map(PathBuf::from));
        bases.extend(
            crate::app_state::media_dirs()
                .iter()
                .filter(|dir| resolve_path(dir).parent().is_some())
                .cloned(),
        );
        if crate::platform::flatpak() {
            if let Some(runtime) = std::env::var_os("XDG_RUNTIME_DIR") {
                bases.push(Path::new(&runtime).join("doc"));
            }
        }
    }
    bases
        .into_iter()
        .filter_map(|base| base.canonicalize().ok())
        // A base that resolves to the filesystem root would allow everything.
        .filter(|base| base.parent().is_some())
        .collect()
}

fn is_allowed_download_base_lexical(resolved: &Path) -> bool {
    if let Some(home) = crate::app_state::home_dir() {
        if is_path_within(resolved, &home) {
            return true;
        }
    }
    if cfg!(target_os = "macos") && is_path_within(resolved, Path::new("/Volumes")) {
        return true;
    }
    if cfg!(target_os = "linux")
        && ["/mnt", "/media", "/run/media"]
            .iter()
            .any(|root| is_path_within(resolved, Path::new(root)))
    {
        return true;
    }
    // The user's own XDG Downloads/Videos/Music folders, wherever
    // user-dirs.dirs points them. A misconfigured "/" never widens the list.
    if cfg!(target_os = "linux")
        && crate::app_state::media_dirs().iter().any(|dir| {
            let dir = resolve_path(dir);
            dir.parent().is_some() && is_path_within(resolved, &dir)
        })
    {
        return true;
    }
    // In Flatpak, folders picked outside the granted xdg dirs come back from
    // the file-chooser portal as document-portal exports the user approved.
    if cfg!(target_os = "linux") && crate::platform::flatpak() {
        if let Some(runtime) = std::env::var_os("XDG_RUNTIME_DIR") {
            let doc_root = Path::new(&runtime).join("doc");
            if resolved != doc_root && is_path_within(resolved, &doc_root) {
                return true;
            }
        }
    }
    if cfg!(windows) && resolved.is_absolute() {
        let normalized = format!(
            "{}\\",
            resolved.to_string_lossy().replace('/', "\\").to_lowercase()
        );
        let blocked = [
            "\\windows\\",
            "\\program files\\",
            "\\program files (x86)\\",
            "\\programdata\\",
        ];
        return !blocked.iter().any(|segment| normalized.contains(segment));
    }
    false
}

fn path_error(message: impl Into<String>) -> IpcError {
    IpcError::new(INVALID_PATH, message)
}

fn validation_error(message: impl Into<String>) -> IpcError {
    IpcError::new(VALIDATION_ERROR, message)
}

/// Empty input is allowed and means "use the default download folder".
pub fn validate_download_path(value: &str) -> Result<String, IpcError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if !is_absolute_path(trimmed) {
        return Err(path_error("Download path must be an absolute path."));
    }
    let resolved = resolve_path(trimmed);
    if !is_allowed_download_base(&resolved) {
        return Err(path_error(
            "Download path must be within your home directory or an allowed external volume.",
        ));
    }
    Ok(resolved.to_string_lossy().into_owned())
}

fn validate_output_path(value: &str) -> Result<String, IpcError> {
    if !is_absolute_path(value.trim()) {
        return Err(path_error("Download outputPath must be an absolute path."));
    }
    validate_download_path(value)
}

pub fn validate_ffmpeg_path_value(value: Option<&str>) -> Result<Option<String>, IpcError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed == "ffmpeg" {
        return Ok(Some("ffmpeg".to_string()));
    }
    if !is_absolute_path(trimmed) {
        return Err(validation_error(
            "ffmpegPath must be an absolute path, empty string, or \"ffmpeg\".",
        ));
    }
    let resolved = resolve_path(trimmed);
    let base = resolved
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if base != "ffmpeg" && base != "ffmpeg.exe" {
        return Err(validation_error(
            "ffmpegPath must point to ffmpeg or ffmpeg.exe.",
        ));
    }
    if !resolved.exists() {
        return Err(validation_error("ffmpegPath does not exist."));
    }
    Ok(Some(resolved.to_string_lossy().into_owned()))
}

/// The checks of `validate_ffmpeg_path_value` except existence, for values
/// loaded from disk.
pub fn validate_ffmpeg_path_shape(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed == "ffmpeg" {
        return Some(trimmed.to_string());
    }
    if !is_absolute_path(trimmed) {
        return None;
    }
    let resolved = resolve_path(trimmed);
    let base = resolved
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    (base == "ffmpeg" || base == "ffmpeg.exe").then(|| resolved.to_string_lossy().into_owned())
}

/// Stored activity and queue data pass a `Value`; the commands pass a string.
pub fn validate_file_location(value: &Value) -> Result<String, IpcError> {
    validate_file_path(value.as_str().unwrap_or(""))
}

pub fn validate_file_path(raw: &str) -> Result<String, IpcError> {
    if raw.trim().is_empty() {
        return Err(path_error("File path must be a non-empty string."));
    }
    let trimmed = raw.trim();
    if trimmed.len() > 4096 {
        return Err(path_error("File path exceeds maximum length."));
    }
    if !is_absolute_path(trimmed) {
        return Err(path_error("File path must be absolute."));
    }
    let resolved = resolve_path(trimmed);
    if !is_allowed_download_base(&resolved) {
        return Err(path_error("File path is outside allowed locations."));
    }
    Ok(resolved.to_string_lossy().into_owned())
}

pub fn validate_external_url(url: &str) -> Result<String, IpcError> {
    if is_safe_external_url(url) {
        Ok(url.trim().to_string())
    } else {
        Err(IpcError::new(INVALID_URL, "Invalid external URL payload."))
    }
}

pub fn validate_notification(
    payload: FalliblePayload<JsonObject<NotificationInput>>,
) -> Result<NotificationRequest, IpcError> {
    const FIELD_TYPES: &str =
        "Notification title, body, and filePath must be strings when provided.";
    let input = payload
        .into_typed(VALIDATION_ERROR, "Notification payload must be an object.")?
        .0;
    let text = |field: Option<FalliblePayload<String>>| {
        field
            .map(|field| field.into_typed(VALIDATION_ERROR, FIELD_TYPES))
            .transpose()
    };
    let title = text(input.title)?;
    let body = text(input.body)?;
    let file_path = text(input.file_path)?;
    if title
        .as_ref()
        .is_some_and(|value| value.chars().count() > 256)
        || body
            .as_ref()
            .is_some_and(|value| value.chars().count() > 1024)
        || file_path.as_ref().is_some_and(|value| value.len() > 4096)
    {
        return Err(validation_error(
            "Notification field exceeds maximum length.",
        ));
    }
    if let Some(path) = file_path.filter(|path| !path.trim().is_empty()) {
        validate_file_path(&path)?;
    }
    Ok(NotificationRequest {
        title: title.map(|value| value.trim().to_string()),
        body: body.map(|value| value.trim().to_string()),
    })
}
