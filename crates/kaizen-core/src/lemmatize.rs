//! Linguistic normalization for known-word counting.
//! Japanese: Lindera (MeCab-compatible, embedded IPADIC) lemmatizes conjugated
//! forms to dictionary form. Chinese: traditional → simplified; no inflection.

use std::borrow::Cow;
use std::sync::LazyLock;

use lindera::dictionary::load_dictionary;
use lindera::mode::Mode;
use lindera::segmenter::Segmenter;
use serde::Serialize;

use crate::known_words::{is_kana_only, to_katakana};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedWord {
    pub surface: String,
    pub lemma: String,
    /// katakana reading of the lemma (ja only)
    pub reading: Option<String>,
    pub strict_key: String,
    pub loose_key: String,
}

static SEGMENTER: LazyLock<Option<Segmenter>> = LazyLock::new(|| {
    load_dictionary("embedded://ipadic").ok().map(|dictionary| Segmenter::new(Mode::Normal, dictionary, None))
});

/// Load the dictionary eagerly (call once at startup so the first request is fast).
pub fn warm_up() -> bool {
    SEGMENTER.is_some()
}

/// IPADIC morpheme: surface + the feature columns we use.
#[derive(Clone, Debug)]
pub struct Morpheme {
    pub surface: String,
    pub pos: String,
    pub basic_form: Option<String>,
    pub reading: Option<String>,
}

fn field(details: &[&str], index: usize) -> Option<String> {
    details.get(index).filter(|v| !v.is_empty() && **v != "*" && **v != "UNK").map(|v| (*v).to_string())
}

/// Segment Japanese text into IPADIC morphemes.
pub fn tokenize_ja(text: &str) -> Vec<Morpheme> {
    let Some(segmenter) = SEGMENTER.as_ref() else { return vec![] };
    let Ok(mut tokens) = segmenter.segment(Cow::Borrowed(text)) else { return vec![] };
    tokens
        .iter_mut()
        .map(|token| {
            let surface = token.surface.to_string();
            let details = token.details();
            Morpheme {
                pos: details.first().map(|v| (*v).to_string()).unwrap_or_default(),
                basic_form: field(&details, 6),
                reading: field(&details, 7),
                surface,
            }
        })
        .collect()
}

/// Particles, auxiliaries, and symbols never carry word identity.
const NON_CONTENT_POS: [&str; 5] = ["助詞", "助動詞", "記号", "フィラー", "その他"];

/// Normalize one Japanese word/expression to its dictionary form. Returns None
/// for entries that don't look like a single word (sentences, blanks).
pub fn normalize_ja(raw_surface: &str) -> Option<NormalizedWord> {
    let surface = raw_surface.trim();
    if surface.is_empty() {
        return None;
    }
    let tokens = tokenize_ja(surface);
    let content: Vec<&Morpheme> = tokens.iter().filter(|t| !NON_CONTENT_POS.contains(&t.pos.as_str())).collect();
    if content.is_empty() || content.len() > 2 {
        return None;
    }
    // Compound entries (e.g. する-verbs like 勉強する) keep the first content
    // token as the identity-bearing lemma.
    let head = content[0];
    let lemma = head.basic_form.clone().unwrap_or_else(|| head.surface.clone());

    // Reading of the LEMMA (the token reading is of the conjugated surface).
    let mut reading = if head.reading.is_some() && lemma == head.surface {
        head.reading.clone()
    } else {
        tokenize_ja(&lemma).first().and_then(|t| t.reading.clone())
    };
    if reading.is_none() && is_kana_only(&lemma) {
        reading = Some(to_katakana(&lemma));
    }
    Some(NormalizedWord {
        surface: surface.to_string(),
        strict_key: format!("{lemma}|{}", reading.as_deref().unwrap_or("")),
        loose_key: lemma.clone(),
        lemma,
        reading,
    })
}

/// Chinese: canonical form = simplified string; exact keys, no bounds gap.
pub fn normalize_zh(raw_surface: &str) -> Option<NormalizedWord> {
    let surface = raw_surface.trim();
    if surface.is_empty() {
        return None;
    }
    let simplified = zhconv::zhconv(surface, zhconv::Variant::ZhHans);
    Some(NormalizedWord {
        surface: surface.to_string(),
        lemma: simplified.clone(),
        reading: None,
        strict_key: simplified.clone(),
        loose_key: simplified,
    })
}

pub fn normalize_word(language: &str, surface: &str) -> Option<NormalizedWord> {
    if language == "zh" { normalize_zh(surface) } else { normalize_ja(surface) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lemmatizes_conjugated_verbs() {
        let past = normalize_ja("食べた").unwrap();
        let plain = normalize_ja("食べる").unwrap();
        assert_eq!(past.lemma, "食べる");
        assert_eq!(past.strict_key, plain.strict_key);
        assert_eq!(normalize_ja("食べていた").unwrap().lemma, "食べる");
    }

    #[test]
    fn lemma_readings_relate_kana_and_kanji() {
        let kanji = normalize_ja("分かる").unwrap();
        assert_eq!(kanji.reading.as_deref(), Some("ワカル"));
        let kana = normalize_ja("わかる").unwrap();
        assert_eq!(kana.reading.as_deref(), Some("ワカル"));
        assert_ne!(kana.loose_key, kanji.loose_key);
    }

    #[test]
    fn suru_compounds_and_rejections() {
        assert_eq!(normalize_ja("勉強する").unwrap().lemma, "勉強");
        assert!(normalize_ja("私は毎日日本語を勉強します").is_none());
        assert!(normalize_ja("  ").is_none());
    }

    #[test]
    fn chinese_traditional_to_simplified() {
        assert_eq!(normalize_zh("學習").unwrap().strict_key, "学习");
        assert_eq!(normalize_zh("学习").unwrap().strict_key, "学习");
        assert_eq!(normalize_zh(" 电视 ").unwrap().lemma, "电视");
    }
}
