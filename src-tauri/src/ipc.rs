//! `{ ok, data } | { ok: false, error }` envelopes shared with the frontend.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub enum FalliblePayload<T> {
    Typed(T),
    Invalid(Value),
}

impl<T> FalliblePayload<T> {
    pub fn into_typed(self, code: &'static str, message: &str) -> Result<T, IpcError> {
        match self {
            Self::Typed(value) => Ok(value),
            Self::Invalid(_) => Err(IpcError::new(code, message)),
        }
    }

    pub fn into_result(self) -> Result<T, Value> {
        match self {
            Self::Typed(value) => Ok(value),
            Self::Invalid(raw) => Err(raw),
        }
    }
}

#[derive(Clone, Debug)]
pub struct JsonObject<T>(pub T);

impl<'de, T: Deserialize<'de>> Deserialize<'de> for JsonObject<T> {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ObjectVisitor<T>(std::marker::PhantomData<T>);

        impl<'de, T: Deserialize<'de>> serde::de::Visitor<'de> for ObjectVisitor<T> {
            type Value = JsonObject<T>;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("a JSON object")
            }

            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                map: A,
            ) -> Result<Self::Value, A::Error> {
                T::deserialize(serde::de::value::MapAccessDeserializer::new(map)).map(JsonObject)
            }
        }

        deserializer.deserialize_map(ObjectVisitor(std::marker::PhantomData))
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct IpcError {
    pub code: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

pub const VALIDATION_ERROR: &str = "VALIDATION_ERROR";
pub const INVALID_URL: &str = "INVALID_URL";
pub const INVALID_PATH: &str = "INVALID_PATH";
pub const INTERNAL_ERROR: &str = "INTERNAL_ERROR";

impl IpcError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct IpcResult<T: Serialize> {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<IpcError>,
}

pub fn ok<T: Serialize>(data: T) -> IpcResult<T> {
    IpcResult {
        ok: true,
        data: Some(data),
        error: None,
    }
}

pub fn err<T: Serialize>(code: &'static str, message: impl Into<String>) -> IpcResult<T> {
    from_error(IpcError::new(code, message))
}

pub fn from_error<T: Serialize>(error: IpcError) -> IpcResult<T> {
    IpcResult {
        ok: false,
        data: None,
        error: Some(error),
    }
}

impl<T: Serialize> From<Result<T, IpcError>> for IpcResult<T> {
    fn from(value: Result<T, IpcError>) -> IpcResult<T> {
        match value {
            Ok(data) => ok(data),
            Err(error) => from_error(error),
        }
    }
}