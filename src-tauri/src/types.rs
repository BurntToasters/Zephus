//! Shared data model for the Tauri shell.

use crate::ipc::FalliblePayload;
use serde::{Deserialize, Serialize};

macro_rules! string_enum {
    ($(#[$meta:meta])* $name:ident { $($variant:ident => $text:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
        pub enum $name {
            $(#[serde(rename = $text)] $variant),+
        }

        impl $name {
            pub const NAMES: &'static [&'static str] = &[$($text),+];

            // Not every enum is converted back to its name outside serde.
            #[allow(dead_code)]
            pub fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $text),+
                }
            }

            pub fn parse(value: &str) -> Option<Self> {
                match value {
                    $($text => Some(Self::$variant),)+
                    _ => None,
                }
            }
        }
    };
}

string_enum!(Theme {
    System => "system",
    Light => "light",
    Dark => "dark",
    Purple => "purple",
});

string_enum!(UpdateChannel {
    Auto => "auto",
    Stable => "stable",
    Beta => "beta",
});

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub settings_version: u32,
    pub theme: Theme,
    pub update_channel: UpdateChannel,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct NotificationRequest {
    pub title: Option<String>,
    pub body: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationInput {
    pub title: Option<FalliblePayload<String>>,
    pub body: Option<FalliblePayload<String>>,
    pub file_path: Option<FalliblePayload<String>>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum UpdaterStatusEvent {
    Checking,
    #[serde(rename_all = "camelCase")]
    Available {
        candidate_id: u64,
        version: String,
        release_notes: Option<String>,
        is_beta: bool,
        manual_install: bool,
    },
    #[serde(rename_all = "camelCase")]
    NotAvailable {
        version: String,
        is_beta: bool,
    },
    Error {
        message: String,
        kind: UpdaterErrorKind,
    },
    Cancelled,
    #[serde(rename_all = "camelCase")]
    Downloaded {
        candidate_id: u64,
        version: String,
    },
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UpdaterErrorKind {
    Feed,
    Download,
    Install,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterProgressEvent {
    pub percent: f64,
    pub bytes_per_second: f64,
    pub transferred: u64,
    pub total: u64,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CheckRefusalReason {
    DevMode,
    Message,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CheckRefusal {
    pub reason: CheckRefusalReason,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOutcome {
    pub success: bool,
    pub cancelled: bool,
    pub error: Option<String>,
}

impl DownloadOutcome {
    pub fn success() -> Self {
        Self {
            success: true,
            cancelled: false,
            error: None,
        }
    }

    pub fn cancelled() -> Self {
        Self {
            success: false,
            cancelled: true,
            error: None,
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self {
            success: false,
            cancelled: false,
            error: Some(message.into()),
        }
    }
}
