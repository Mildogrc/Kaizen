//! The Daily queue: meditation (rendered separately), Anki, Japanese grammar,
//! weekend skills, and reading.

use serde::Serialize;

use crate::nato::WeekendSkill;
use crate::util::thousands;

#[derive(Clone, Debug)]
pub struct ReadingBook {
    pub id: String,
    pub title: String,
}

#[derive(Clone, Debug)]
pub struct DailyQueueInput {
    pub anki_due: i64,
    pub grammar_reviews: i64,
    pub grammar_new: i64,
    pub reading_book: Option<ReadingBook>,
    pub read_today: bool,
    pub weekend_skills: Vec<WeekendSkill>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct DailyBlock {
    pub key: String,
    pub title: String,
    pub detail: String,
    pub href: String,
    pub count: i64,
    pub complete: bool,
}

pub fn build_queue(input: &DailyQueueInput) -> Vec<DailyBlock> {
    let mut queue = vec![DailyBlock {
        key: "anki".into(),
        title: "Anki review".into(),
        detail: format!("{} cards due across all mapped decks", thousands(input.anki_due)),
        href: "/review".into(),
        count: input.anki_due,
        complete: input.anki_due == 0,
    }];
    if input.grammar_reviews > 0 || input.grammar_new > 0 {
        let review_detail =
            format!("{} {} due", input.grammar_reviews, if input.grammar_reviews == 1 { "review" } else { "reviews" });
        let detail = match (input.grammar_reviews > 0, input.grammar_new > 0) {
            (true, true) => format!("{review_detail} + {} new points", input.grammar_new),
            (true, false) => review_detail,
            _ => format!("{} new points ready", input.grammar_new),
        };
        queue.push(DailyBlock {
            key: "grammar".into(),
            title: "Japanese grammar".into(),
            detail,
            href: "/tracks/japanese/grammar?returnTo=%2F".into(),
            count: input.grammar_reviews + input.grammar_new,
            complete: false,
        });
    }
    for skill in &input.weekend_skills {
        queue.push(DailyBlock {
            key: skill.key.into(),
            title: skill.title.into(),
            detail: skill.detail.into(),
            href: skill.href.into(),
            count: 1,
            complete: false,
        });
    }
    queue.push(DailyBlock {
        key: "read".into(),
        title: "Read".into(),
        detail: input.reading_book.as_ref().map(|b| b.title.clone()).unwrap_or_else(|| "Choose a current book".into()),
        href: input
            .reading_book
            .as_ref()
            .map(|b| format!("/library/books/{}?returnTo=%2F#reading-log", b.id))
            .unwrap_or_else(|| "/library/books".into()),
        count: i64::from(input.reading_book.is_some()),
        complete: input.read_today,
    });
    queue
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queue_shape() {
        let queue = build_queue(&DailyQueueInput {
            anki_due: 1234,
            grammar_reviews: 1,
            grammar_new: 5,
            reading_book: Some(ReadingBook { id: "b1".into(), title: "GEB".into() }),
            read_today: true,
            weekend_skills: vec![],
        });
        assert_eq!(queue[0].detail, "1,234 cards due across all mapped decks");
        assert_eq!(queue[1].detail, "1 review due + 5 new points");
        assert_eq!(queue[2].href, "/library/books/b1?returnTo=%2F#reading-log");
        assert!(queue[2].complete);
    }
}
