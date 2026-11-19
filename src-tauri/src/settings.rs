//! Minimal persisted settings for shell concerns (theme, update channel).

use crate::constants::{allowed, ALLOWED_THEMES, ALLOWED_UPDATE_CHANNELS, CURRENT_SETTINGS_VERSION};
use crate::types::{Settings, Theme, UpdateChannel};
use serde_json::{Map, Value};
use std::sync::Mutex;

static SETTINGS_LOCK: Mutex<()> = Mutex::new(());

pub fn default_settings() -> Settings {
    Settings {
        settings_version: CURRENT_SETTINGS_VERSION,
        theme: Theme::System,
        update_channel: UpdateChannel::Auto,
    }
}

fn settings_path() -> std::path::PathBuf {
    crate::app_state::data_dir().join("settings.json")
}

fn load_unlocked() -> Settings {
    let path = settings_path();
    let Ok(bytes) = std::fs::read(&path) else {
        return default_settings();
    };
    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
        return default_settings();
    };
    let Some(object) = value.as_object() else {
        return default_settings();
    };
    let theme = object
        .get("theme")
        .and_then(Value::as_str)
        .filter(|value| allowed(ALLOWED_THEMES, value))
        .and_then(Theme::parse)
        .unwrap_or(Theme::System);
    let update_channel = object
        .get("updateChannel")
        .and_then(Value::as_str)
        .filter(|value| allowed(ALLOWED_UPDATE_CHANNELS, value))
        .and_then(UpdateChannel::parse)
        .unwrap_or(UpdateChannel::Auto);
    Settings {
        settings_version: object
            .get("settingsVersion")
            .and_then(Value::as_u64)
            .map(|version| version as u32)
            .unwrap_or(CURRENT_SETTINGS_VERSION),
        theme,
        update_channel,
    }
}

pub fn load() -> Settings {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    load_unlocked()
}

pub fn save_patch(patch: &Map<String, Value>) -> Result<Settings, String> {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut settings = load_unlocked();
    if let Some(Value::String(theme)) = patch.get("theme") {
        if let Some(parsed) = Theme::parse(theme) {
            settings.theme = parsed;
        }
    }
    if let Some(Value::String(channel)) = patch.get("updateChannel") {
        if let Some(parsed) = UpdateChannel::parse(channel) {
            settings.update_channel = parsed;
        }
    }
    settings.settings_version = CURRENT_SETTINGS_VERSION;
    crate::fs_util::write_json(&settings_path(), &settings)?;
    Ok(settings)
}