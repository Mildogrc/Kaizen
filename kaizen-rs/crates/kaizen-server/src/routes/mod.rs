//! JSON API. Each page has one "view" endpoint returning a fully computed
//! view model; mutations are small action endpoints.

mod analytics;
mod anki;
mod books;
mod codeforces;
mod concepts;
mod config;
mod courses;
mod dashboard;
mod grammar;
mod import;
mod kanji;
mod mandarin;
mod math;
mod me;
mod mistakes;
mod nato;
mod reading;
mod review;
pub mod shared;
mod words;
mod youtube;

use axum::Router;
use axum::routing::{delete, get, post, put};

use crate::error::ApiError;
use crate::state::App;

pub fn api() -> Router<App> {
    Router::new()
        // account, settings, AI
        .route("/me", get(me::get_me).put(me::update_me))
        .route("/settings/ai", get(me::ai_settings).put(me::update_ai))
        .route("/settings/ai/key", put(me::save_key))
        .route("/settings/ai/key/{provider}", delete(me::delete_key))
        .route("/settings/ai/chatgpt", delete(me::disconnect_chatgpt))
        .route("/settings/ai/models", get(me::chatgpt_models))
        .route("/ai/chat", post(crate::ai::chat))
        .route("/ai/conversations", get(crate::ai::list_conversations))
        .route("/ai/conversation", get(crate::ai::find_conversation))
        .route("/ai/conversations/{id}", get(crate::ai::get_conversation).delete(crate::ai::delete_conversation))
        .route("/ai/conversations/{id}/stream", get(crate::ai::stream_turn))
        .route("/ai/conversations/{id}/stop", post(crate::ai::stop_turn))
        // overview
        .route("/dashboard", get(dashboard::dashboard))
        .route("/daily", get(dashboard::daily))
        .route("/daily/meditation", post(dashboard::meditation))
        .route("/skills", get(dashboard::skills))
        // courses and goals
        .route("/courses/{slug}", get(courses::course_page))
        .route("/courses/{id}/generate-cards", post(courses::generate_cards))
        .route("/goals/{id}/complete", post(courses::complete_goal))
        .route("/math", get(math::page))
        .route("/roadmap/nodes/{id}/cycle", post(math::cycle_node))
        // concepts
        .route("/concepts", get(concepts::list).post(concepts::create))
        .route("/concepts/starters/{key}", post(concepts::install_starter))
        .route("/concepts/{id}", get(concepts::detail).patch(concepts::update).delete(concepts::remove))
        .route("/concepts/{id}/prerequisites", post(concepts::add_prerequisite))
        .route("/concepts/{id}/prerequisites/{prerequisite_id}", delete(concepts::remove_prerequisite))
        .route("/concepts/{id}/sources", post(concepts::add_source))
        .route("/concept-sources/{id}", axum::routing::patch(concepts::update_source).delete(concepts::remove_source))
        .route("/concept-links", get(concepts::links))
        // books and mistakes
        .route("/books", get(books::list).post(books::create))
        .route("/books/{id}", get(books::detail).patch(books::update).delete(books::remove))
        .route("/books/{id}/notes", post(books::add_note))
        .route("/books/{id}/sessions", post(books::add_session))
        .route("/book-notes/{id}/remember", post(books::toggle_remember))
        .route("/book-notes/{id}", delete(books::delete_note))
        .route("/mistakes", get(mistakes::list).post(mistakes::create))
        .route("/mistakes/{id}/resolve", post(mistakes::toggle))
        .route("/mistakes/{id}/bump", post(mistakes::bump))
        .route("/mistakes/{id}", delete(mistakes::remove))
        // analytics and Anki
        .route("/analytics", get(analytics::page))
        .route("/anki", get(anki::page))
        .route("/anki/decks", get(anki::decks))
        .route("/anki/mappings", post(anki::save_mapping))
        .route("/anki/mappings/{id}", delete(anki::remove_mapping))
        .route("/anki/mappings/{id}/words", post(anki::toggle_words))
        .route("/anki/mappings/{id}/adaptive", post(anki::toggle_adaptive))
        .route("/anki/sync", post(anki::sync))
        .route("/anki/leech-plan/{mapping_id}", get(anki::leech_plan))
        .route("/anki/media", get(anki::media))
        .route("/anki/relay", get(crate::anki::relay::websocket))
        // configurations
        .route("/configurations", get(config::page))
        .route("/settings/{section}", put(config::update_section))
        .route("/settings/adaptive-anki/reset", post(config::reset_adaptive))
        .route("/math/goal", put(config::math_goal))
        .route("/math/long-term-goals", post(config::math_long_term))
        // Japanese
        .route("/japanese/grammar", get(grammar::page))
        .route("/japanese/grammar/lesson", post(grammar::generate_lesson))
        .route("/japanese/grammar/ratings", post(grammar::submit_ratings))
        .route("/japanese/grammar/tutor", put(grammar::tutor_config))
        .route("/japanese/kanji-repair", get(kanji::page))
        .route("/japanese/kanji-repair/complete", post(kanji::complete))
        // Chinese
        .route("/chinese/mandarin-blueprint", get(mandarin::page))
        .route("/chinese/mandarin-blueprint/{level}/complete", post(mandarin::complete_level))
        .route("/chinese/pronunciation", get(mandarin::pronunciation))
        // skills
        .route("/codeforces", get(codeforces::page))
        .route("/codeforces/sync", post(codeforces::sync))
        .route("/nato", get(nato::page))
        .route("/nato/sessions", post(nato::save))
        .route("/speed-reading", get(reading::page))
        .route("/speed-reading/prompt", get(reading::prompt))
        .route("/speed-reading/passages", post(reading::import_passage))
        .route("/speed-reading/sessions", post(reading::complete_session))
        .route("/speed-reading/retention/{id}", post(reading::retention))
        .route("/youtube", get(youtube::list).post(youtube::add))
        .route("/youtube/{id}", get(youtube::detail).delete(youtube::remove))
        .route("/youtube/{id}/refresh", post(youtube::refresh))
        .route("/youtube/{id}/position", post(youtube::set_position))
        .route("/youtube/{id}/progress", post(youtube::progress))
        .route("/youtube/{id}/image-prompt", post(youtube::image_prompt))
        .route("/youtube/{id}/artwork", post(youtube::artwork))
        .route("/blobs/{id}", get(youtube::blob))
        // content
        .route("/import", get(import::options).post(import::run))
        .route("/schemas", get(import::schemas).post(import::create_schema))
        .route("/schemas/{slug}", get(import::schema_detail))
        .route("/schemas/{slug}/prompt", get(import::schema_prompt))
        .route("/review", get(review::page))
        .route("/review/{id}/rate", post(review::rate))
        .route("/review/grammar/{id}/rate", post(review::rate_grammar))
        .route("/words", get(words::page).post(words::add))
        .route("/words/migaku", post(words::migaku))
        .route("/words/anki", post(words::refresh_anki))
        .route("/words/{id}", delete(words::remove))
        .fallback(|| async { ApiError::not_found("Endpoint") })
}
