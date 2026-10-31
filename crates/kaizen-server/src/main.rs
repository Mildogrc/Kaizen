//! Kaizen server binary.
//!
//! ```text
//! kaizen                      serve the API and web app (default)
//! kaizen migrate              apply database migrations and exit
//! kaizen import-legacy --from <old DATABASE_URL> [--email E] [--name N] [--timezone TZ] [--public-dir DIR] [--replace]
//! kaizen import-mandarin --csv <MandarinBluePrint.csv>
//! ```

// sqlx row tuples are clearer inline than as one-off type aliases.
#![allow(clippy::type_complexity)]

mod ai;
mod anki;
mod auth;
mod config;
mod crypto;
mod db;
mod error;
mod integrations;
mod known_words;
mod legacy;
mod routes;
mod secrets;
mod state;
mod web;
mod workspace;

use std::time::Duration;

use anyhow::{Context, Result, bail};
use axum::Router;
use axum::http::{HeaderValue, header};
use axum::middleware;
use axum::routing::get;
use tower_http::compression::CompressionLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use crate::config::Config;
use crate::state::{App, AppState};

fn init_tracing(json: bool) {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn,tower_http=info"));
    let builder = tracing_subscriber::fmt().with_env_filter(filter);
    if json {
        builder.json().init();
    } else {
        builder.compact().init();
    }
}

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let config = Config::from_env()?;
    init_tracing(config.log_json);
    match args.first().map(String::as_str) {
        None | Some("serve") => serve(config).await,
        Some("migrate") => {
            let pool = db::connect(&config.database_url).await?;
            db::migrate(&pool).await?;
            println!("Migrations applied.");
            Ok(())
        }
        Some("import-legacy") => {
            let options = legacy::Options {
                from: arg(&args, "--from").context("--from <legacy DATABASE_URL> is required")?,
                email: arg(&args, "--email"),
                name: arg(&args, "--name"),
                timezone: arg(&args, "--timezone"),
                public_dir: arg(&args, "--public-dir").map(std::path::PathBuf::from),
                replace: args.iter().any(|a| a == "--replace"),
            };
            let pool = db::connect(&config.database_url).await?;
            db::migrate(&pool).await?;
            let app = AppState::new(pool, config)?;
            let report = legacy::import(&app, options).await?;
            println!("{report}");
            Ok(())
        }
        Some("import-mandarin") => {
            let csv = arg(&args, "--csv").context("--csv <MandarinBluePrint.csv> is required")?;
            let pool = db::connect(&config.database_url).await?;
            db::migrate(&pool).await?;
            let app = AppState::new(pool, config)?;
            let text = std::fs::read_to_string(&csv).with_context(|| format!("reading {csv}"))?;
            let summary = integrations::mandarin::import_catalog(&app, &text).await?;
            println!("{summary}");
            Ok(())
        }
        Some("-h") | Some("--help") | Some("help") => {
            println!("{}", include_str!("main.rs").lines().skip(3).take(6).map(|l| l.trim_start_matches("//! ")).collect::<Vec<_>>().join("\n"));
            Ok(())
        }
        Some(other) => bail!("unknown command `{other}` (try --help)"),
    }
}

async fn serve(config: Config) -> Result<()> {
    let pool = db::connect(&config.database_url).await?;
    db::migrate(&pool).await?;
    let bind = config.bind;
    let web_dir = config.web_dir.clone();
    let app = AppState::new(pool, config)?;
    // Load the Japanese dictionary in the background so the first word
    // import doesn't pay for it.
    tokio::task::spawn_blocking(kaizen_core::lemmatize::warm_up);

    let router = build_router(app.clone(), &web_dir);
    let listener = tokio::net::TcpListener::bind(bind).await.with_context(|| format!("binding {bind}"))?;
    tracing::info!(address = %format!("http://{bind}"), public = %app.config.public_url, "Kaizen is listening");
    axum::serve(listener, router).with_graceful_shutdown(shutdown_signal()).await?;
    app.db.close().await;
    Ok(())
}

fn build_router(app: App, web_dir: &std::path::Path) -> Router {
    Router::new()
        .nest("/api", routes::api())
        .nest("/auth", auth::oauth::routes())
        .route("/healthz", get(|| async { "ok" }))
        .route("/readyz", get(readyz))
        .merge(web::spa(web_dir))
        .layer(middleware::from_fn_with_state(app.clone(), web::csrf_guard))
        .layer(RequestBodyLimitLayer::new(32 * 1024 * 1024))
        .layer(CompressionLayer::new())
        .layer(SetResponseHeaderLayer::if_not_present(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")))
        .layer(SetResponseHeaderLayer::if_not_present(header::REFERRER_POLICY, HeaderValue::from_static("strict-origin-when-cross-origin")))
        .layer(SetResponseHeaderLayer::if_not_present(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY")))
        .layer(TraceLayer::new_for_http())
        .with_state(app)
}

async fn readyz(axum::extract::State(app): axum::extract::State<App>) -> Result<&'static str, axum::http::StatusCode> {
    match tokio::time::timeout(Duration::from_secs(2), sqlx::query("SELECT 1").execute(&app.db)).await {
        Ok(Ok(_)) => Ok("ready"),
        _ => Err(axum::http::StatusCode::SERVICE_UNAVAILABLE),
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutting down");
}
