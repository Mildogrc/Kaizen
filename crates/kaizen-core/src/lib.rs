//! Kaizen domain logic. Everything here is a pure function over plain data so
//! it can be unit-tested without a database; the server crate maps rows in and
//! view models out.

#![allow(clippy::too_many_arguments)]

pub mod adaptive_budget;
pub mod anki_analytics;
pub mod anki_html;
pub mod book_analytics;
pub mod codeforces;
pub mod concepts;
pub mod daily;
pub mod grammar;
pub mod jlpt;
pub mod kanji_repair;
pub mod known_words;
pub mod leech_prompt;
pub mod lemmatize;
pub mod mandarin;
pub mod math_goals;
pub mod meditation;
pub mod nato;
pub mod progression;
pub mod roadmap;
pub mod schema;
pub mod seed;
pub mod settings;
pub mod speed_reading;
pub mod srs;
pub mod time;
pub mod util;
pub mod youtube;
