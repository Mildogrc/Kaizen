//! API errors: every failure becomes `{ "error": "<message>" }` with a status.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{0}")]
    BadRequest(String),
    #[error("Sign in to continue.")]
    Unauthorized,
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Unavailable(String),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

pub type ApiResult<T> = Result<T, ApiError>;

impl ApiError {
    pub fn bad(message: impl Into<String>) -> ApiError {
        ApiError::BadRequest(message.into())
    }
    pub fn not_found(what: &str) -> ApiError {
        ApiError::NotFound(format!("{what} not found."))
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match &self {
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::Unauthorized => StatusCode::UNAUTHORIZED,
            ApiError::Forbidden(_) => StatusCode::FORBIDDEN,
            ApiError::NotFound(_) => StatusCode::NOT_FOUND,
            ApiError::Conflict(_) => StatusCode::CONFLICT,
            ApiError::Unavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            ApiError::Database(sqlx::Error::RowNotFound) => StatusCode::NOT_FOUND,
            ApiError::Database(_) | ApiError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let message = match &self {
            ApiError::Database(sqlx::Error::RowNotFound) => "Not found.".to_string(),
            ApiError::Database(e) => {
                tracing::error!(error = %e, "database error");
                "The database request failed. Please try again.".to_string()
            }
            ApiError::Internal(e) => {
                tracing::error!(error = %format!("{e:#}"), "internal error");
                "Something went wrong. Please try again.".to_string()
            }
            other => other.to_string(),
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}
