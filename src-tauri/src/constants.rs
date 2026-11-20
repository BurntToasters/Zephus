//! Limits shared by validation and window lifecycle.

use crate::types::{Theme, UpdateChannel};
use std::time::Duration;

pub const SPLASH_FADE_DELAY: Duration = Duration::from_millis(800);
/// The editor may be showing the unsaved-work dialog, so this is not a disk
/// timeout. A renderer that never answers still falls through to the
/// forced-close prompt.
pub const SETTINGS_FLUSH_TIMEOUT: Duration = Duration::from_secs(300);
pub const ALLOWED_UPDATE_CHANNELS: &[&str] = UpdateChannel::NAMES;
pub const ALLOWED_THEMES: &[&str] = Theme::NAMES;
pub const CURRENT_SETTINGS_VERSION: u32 = 1;

pub fn allowed(list: &[&str], value: &str) -> bool {
    list.contains(&value)
}
