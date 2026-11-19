//! Limits shared by validation and window lifecycle.

use crate::types::{Theme, UpdateChannel};
use std::time::Duration;

pub const SPLASH_FADE_DELAY: Duration = Duration::from_millis(800);
pub const SETTINGS_FLUSH_TIMEOUT: Duration = Duration::from_millis(1500);
pub const ALLOWED_UPDATE_CHANNELS: &[&str] = UpdateChannel::NAMES;
pub const ALLOWED_THEMES: &[&str] = Theme::NAMES;
pub const CURRENT_SETTINGS_VERSION: u32 = 1;

pub fn allowed(list: &[&str], value: &str) -> bool {
    list.contains(&value)
}