//! Serves the built SPA: precompressed brotli/gzip assets, immutable caching
//! for hashed files, and `index.html` for client-side routes.

use std::path::Path;

use axum::Router;
use axum::body::Body;
use axum::extract::Request;
use axum::http::{HeaderValue, header};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Response};
use tower_http::services::{ServeDir, ServeFile};

use crate::state::App;

async fn cache_headers(request: Request, next: Next) -> Response {
    let immutable = request.uri().path().starts_with("/assets/");
    let mut response = next.run(request).await;
    let value = if immutable { "public, max-age=31536000, immutable" } else { "no-cache" };
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static(value));
    response
}

pub fn spa(dir: &Path) -> Router<App> {
    let index = dir.join("index.html");
    if !index.exists() {
        tracing::warn!(dir = %dir.display(), "web build not found; run `npm run build` in web/ (or use the Vite dev server)");
        return Router::new().fallback(|| async {
            Html(
                "<!doctype html><title>Kaizen</title><body style=\"font-family:system-ui;padding:3rem;background:#0b0e14;color:#d6dae3\">\
                 <h1>Kaizen API is running</h1><p>The web app isn't built yet. Run <code>npm install &amp;&amp; npm run build</code> in \
                 <code>web</code>, or start the dev server with <code>npm run dev</code>.</p></body>",
            )
            .into_response()
        });
    }
    // Hashed assets never fall back to index.html: a stale tab asking for an
    // old chunk must get a 404 (the app then reloads itself), not HTML.
    let assets = ServeDir::new(dir.join("assets")).precompressed_br().precompressed_gzip();
    let serve = ServeDir::new(dir)
        .precompressed_br()
        .precompressed_gzip()
        .append_index_html_on_directories(true)
        .fallback(ServeFile::new(index).precompressed_br().precompressed_gzip());
    Router::new().nest_service("/assets", assets).fallback_service(serve).layer(middleware::from_fn(cache_headers))
}

/// Reject cross-site state-changing requests (defense in depth on top of
/// SameSite=Lax cookies): `Sec-Fetch-Site` must be same-origin/none, or the
/// `Origin` must match the public origin or the request's own host.
pub async fn csrf_guard(axum::extract::State(app): axum::extract::State<App>, request: Request<Body>, next: Next) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let guarded_path = path.starts_with("/api/") || path == "/auth/logout";
    let websocket = request.headers().get(header::UPGRADE).is_some();
    let unsafe_method = !matches!(method.as_str(), "GET" | "HEAD" | "OPTIONS");
    if guarded_path && (unsafe_method || websocket) {
        let headers = request.headers();
        let site = headers.get("sec-fetch-site").and_then(|v| v.to_str().ok());
        let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());
        let host = headers.get(header::HOST).and_then(|v| v.to_str().ok());
        let public = app.config.public_origin();
        let origin_ok = |origin: &str| {
            let origin_host = origin.split("://").nth(1).unwrap_or("");
            host.is_some_and(|h| h == origin_host) || public == origin
        };
        let allowed = match (site, origin) {
            (Some("same-origin") | Some("none"), _) => true,
            (Some(_), Some(origin)) => origin_ok(origin),
            (Some(_), None) => false,
            (None, Some(origin)) => origin_ok(origin),
            (None, None) => true, // non-browser client (curl, scripts)
        };
        if !allowed {
            return (axum::http::StatusCode::FORBIDDEN, axum::Json(serde_json::json!({ "error": "Cross-site request blocked." })))
                .into_response();
        }
    }
    next.run(request).await
}
