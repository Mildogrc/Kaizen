//! Mandarin: Mandarin Blueprint catalog parsing, Chisho dictionary parsing,
//! Anki note construction, and tone-pair pronunciation practice.

use std::collections::BTreeMap;
use std::sync::LazyLock;

use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use chrono_tz::Tz;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::anki_html::{escape_html, strip_anki_html};
use crate::settings::MandarinBlueprintConfiguration;
use crate::time::local_date;

pub const LEVELS: i64 = 88;
pub const TRAVERSE_PROGRESS_ENDPOINT: &str = "https://us-central1-alley-d0944.cloudfunctions.net/getLevelProgress";
pub const CHISHO_BASE_URL: &str = "https://chisho.org/";

// ------------------------------------------------------- Blueprint catalog

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintCsvRow {
    pub phase: Option<i64>,
    pub level: i64,
    pub new_characters: i64,
    pub total_characters: i64,
    pub new_words: i64,
    pub total_words: i64,
    pub weeks: Option<i64>,
    pub characters: Vec<String>,
}

fn int(value: &str) -> i64 {
    let digits: String = value.trim().chars().take_while(|c| c.is_ascii_digit() || *c == '-').collect();
    digits.parse().unwrap_or(0)
}

pub fn parse_blueprint_csv(csv: &str) -> Vec<BlueprintCsvRow> {
    let mut phase: Option<i64> = None;
    csv.trim()
        .lines()
        .skip(1)
        .filter_map(|line| {
            let columns: Vec<&str> = line.split(',').collect();
            if columns.len() < 10 {
                return None;
            }
            if !columns[0].trim().is_empty() {
                phase = Some(int(columns[0]));
            }
            let level = int(columns[1]);
            if !(1..=LEVELS).contains(&level) {
                return None;
            }
            Some(BlueprintCsvRow {
                phase,
                level,
                new_characters: int(columns[2]),
                total_characters: int(columns[3]),
                new_words: int(columns[4]),
                total_words: int(columns[5]),
                weeks: (!columns[8].trim().is_empty()).then(|| int(columns[8])),
                characters: columns[9].trim().chars().map(|c| c.to_string()).collect(),
            })
        })
        .collect()
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraverseLevel {
    pub words: Vec<String>,
    pub characters: Vec<String>,
    pub total_words: i64,
    pub total_characters: i64,
}

/// Parse a Traverse `getLevelProgress` response (`{result: {"All Words": {old, new}, …}}`).
pub fn parse_traverse_level(body: &Value) -> Result<TraverseLevel, String> {
    let result = body.get("result").and_then(Value::as_object).ok_or("Traverse returned no result.")?;
    let group = |name: &str| -> (Vec<String>, Vec<String>) {
        let strings = |v: Option<&Value>| -> Vec<String> {
            v.and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default()
        };
        let g = result.get(name);
        (strings(g.and_then(|g| g.get("old"))), strings(g.and_then(|g| g.get("new"))))
    };
    let (words_old, words_new) = group("All Words");
    let (chars_old, chars_new) = group("All Characters");
    Ok(TraverseLevel {
        total_words: (words_old.len() + words_new.len()) as i64,
        total_characters: (chars_old.len() + chars_new.len()) as i64,
        words: words_new,
        characters: chars_new,
    })
}

// ------------------------------------------------------------------ Chisho

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryEntry {
    pub surface: String,
    pub traditional: Option<String>,
    pub pinyin: Vec<String>,
    pub definitions: Vec<String>,
    pub audio_urls: Vec<String>,
    pub source_url: String,
}

static FIRST_LI: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<li>(.*?)</li>").unwrap());
static ANNOTATION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?s)class="annotation[^"]*"[^>]*>(.*?)</span>"#).unwrap());
static CHARACTER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?s)class="character[^"]*"[^>]*>(.*?)</span>"#).unwrap());
static AUDIO: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"<audio[^>]+src="([^"]+)""#).unwrap());
static DEFINITION_COLUMN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?s)class="basis-3/4[^"]*"[^>]*>(.*)"#).unwrap());
static DIV: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<div>(.*?)</div>").unwrap());
static TAGS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]+>").unwrap());
static HEX_ENTITY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)&#x([0-9a-f]+);").unwrap());
static DEC_ENTITY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"&#(\d+);").unwrap());
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static ENUMERATION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d+\.\s*").unwrap());

fn decode_html(value: &str) -> String {
    let s = TAGS.replace_all(value, " ");
    let s = HEX_ENTITY.replace_all(&s, |c: &regex::Captures| {
        u32::from_str_radix(&c[1], 16).ok().and_then(char::from_u32).map(String::from).unwrap_or_default()
    });
    let s = DEC_ENTITY.replace_all(&s, |c: &regex::Captures| {
        c[1].parse::<u32>().ok().and_then(char::from_u32).map(String::from).unwrap_or_default()
    });
    let s = s.replace("&nbsp;", " ").replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'").replace("&apos;", "'");
    SPACES.replace_all(&s, " ").trim().to_string()
}

pub fn chisho_url(surface: &str) -> String {
    format!("{CHISHO_BASE_URL}?q={}", url::form_urlencoded::byte_serialize(surface.as_bytes()).collect::<String>().replace('+', "%20"))
}

pub fn parse_chisho_html(surface: &str, html: &str) -> DictionaryEntry {
    let first = FIRST_LI.captures(html).map(|c| c[1].to_string()).unwrap_or_default();
    let pinyin_text = ANNOTATION.captures(&first).map(|c| c[1].to_string()).unwrap_or_default();
    let character_text = decode_html(&CHARACTER.captures(&first).map(|c| c[1].to_string()).unwrap_or_default());
    let traditional = character_text.split('〔').next().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let base = url::Url::parse(CHISHO_BASE_URL).expect("valid base");
    let audio_urls = AUDIO
        .captures_iter(&first)
        .filter_map(|c| base.join(&c[1]).ok().map(|u| u.to_string()))
        .collect();
    let column = DEFINITION_COLUMN.captures(&first).map(|c| c[1].to_string()).unwrap_or_default();
    let definitions = DIV
        .captures_iter(&column)
        .map(|c| ENUMERATION.replace(&decode_html(&c[1]), "").to_string())
        .filter(|d| !d.is_empty())
        .collect();
    let pinyin = decode_html(&pinyin_text).split('/').map(str::trim).filter(|s| !s.is_empty()).map(str::to_string).collect();
    DictionaryEntry { surface: surface.into(), traditional, pinyin, definitions, audio_urls, source_url: chisho_url(surface) }
}

// ------------------------------------------------------------- Anki notes

pub const CHARACTER_MODEL: &str = "Kaizen Mandarin Character";
pub const REVERSED_CHARACTER_MODEL: &str = "Kaizen Mandarin Character Reversed";
pub const WORD_MODEL: &str = "Kaizen Mandarin Word";

const CARD_CSS: &str = ".card { font-family: Arial, sans-serif; font-size: 22px; text-align: center; color: #111; background: #fff; } .hanzi { font-size: 64px; margin: 12px; } .pinyin { color: #555; margin: 8px; } .definitions { text-align: left; font-size: 18px; line-height: 1.45; }";

/// `createModel` payloads for the three note types.
pub fn anki_models() -> Vec<Value> {
    vec![
        json!({
            "modelName": CHARACTER_MODEL,
            "inOrderFields": ["Cue", "Character", "Traditional", "Pinyin", "Definitions", "Audio", "Level", "Source"],
            "css": CARD_CSS,
            "cardTemplates": [{ "Name": "Word → Character", "Front": "<div class=\"definitions\">{{Cue}}</div>", "Back": "{{FrontSide}}<hr><div class=\"hanzi\">{{Character}}</div><div class=\"pinyin\">{{Pinyin}}</div>{{Audio}}<div class=\"definitions\">{{Definitions}}</div><div>{{Traditional}}</div>" }],
        }),
        json!({
            "modelName": REVERSED_CHARACTER_MODEL,
            "inOrderFields": ["Character", "Cue", "Traditional", "Pinyin", "Definitions", "Audio", "Level", "Source"],
            "css": CARD_CSS,
            "cardTemplates": [{ "Name": "Character → Word", "Front": "<div class=\"hanzi\">{{Character}}</div>", "Back": "{{FrontSide}}<hr><div class=\"pinyin\">{{Pinyin}}</div>{{Audio}}<div class=\"definitions\">{{Definitions}}</div><div>{{Traditional}}</div>" }],
        }),
        json!({
            "modelName": WORD_MODEL,
            "inOrderFields": ["Word", "Traditional", "Pinyin", "Definitions", "Audio", "Level", "Source"],
            "css": CARD_CSS,
            "cardTemplates": [{ "Name": "Word → Details", "Front": "<div class=\"hanzi\">{{Word}}</div>", "Back": "{{FrontSide}}<hr><div class=\"pinyin\">{{Pinyin}}</div>{{Audio}}<div class=\"definitions\">{{Definitions}}</div><div>{{Traditional}}</div>" }],
        }),
    ]
}

fn definition_html(definitions: &[String]) -> String {
    if definitions.is_empty() {
        "<span>No dictionary definition found.</span>".into()
    } else {
        format!("<ol>{}</ol>", definitions.iter().map(|d| format!("<li>{}</li>", escape_html(d))).collect::<String>())
    }
}

fn audio_filename(url: &str, surface: &str, index: usize) -> String {
    let hash = crate::util::fnv1a_utf16(&format!("{surface}\u{0}{url}"));
    let extension = url::Url::parse(url)
        .ok()
        .and_then(|u| u.path().rsplit('.').next().map(|e| e.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>()))
        .filter(|e| !e.is_empty())
        .unwrap_or_else(|| "mp3".into());
    format!("kaizen_mb_{hash:x}_{index}.{extension}")
}

fn common_note(entry: &DictionaryEntry, level: i64, tags: &[&str]) -> serde_json::Map<String, Value> {
    let mut all_tags = vec!["mandarin-blueprint".to_string(), format!("mandarin-blueprint-level-{level}")];
    all_tags.extend(tags.iter().map(|t| t.to_string()));
    let mut note = serde_json::Map::new();
    note.insert("tags".into(), json!(all_tags));
    note.insert("options".into(), json!({ "allowDuplicate": false, "duplicateScope": "deck" }));
    note.insert(
        "audio".into(),
        Value::Array(
            entry
                .audio_urls
                .iter()
                .enumerate()
                .map(|(i, url)| json!({ "url": url, "filename": audio_filename(url, &entry.surface, i), "fields": ["Audio"] }))
                .collect(),
        ),
    );
    note
}

pub fn character_notes(entry: &DictionaryEntry, config: &MandarinBlueprintConfiguration, level: i64) -> [Value; 2] {
    let fields = json!({
        "Cue": escape_html(entry.definitions.first().unwrap_or(&entry.surface)),
        "Character": escape_html(&entry.surface),
        "Traditional": escape_html(entry.traditional.as_deref().unwrap_or("")),
        "Pinyin": escape_html(&entry.pinyin.join(" / ")),
        "Definitions": definition_html(&entry.definitions),
        "Audio": "",
        "Level": level.to_string(),
        "Source": escape_html(&entry.source_url),
    });
    let make = |deck: &str, model: &str, tag: &str| {
        let mut note = common_note(entry, level, &["character", tag]);
        note.insert("deckName".into(), json!(deck));
        note.insert("modelName".into(), json!(model));
        note.insert("fields".into(), fields.clone());
        Value::Object(note)
    };
    [
        make(&config.character_deck_name, CHARACTER_MODEL, "character-standard"),
        make(&config.reversed_character_deck_name, REVERSED_CHARACTER_MODEL, "character-reversed"),
    ]
}

pub fn word_note(entry: &DictionaryEntry, config: &MandarinBlueprintConfiguration, level: i64) -> Value {
    let mut note = common_note(entry, level, &["word"]);
    note.insert("deckName".into(), json!(config.word_deck_name));
    note.insert("modelName".into(), json!(WORD_MODEL));
    note.insert(
        "fields".into(),
        json!({
            "Word": escape_html(&entry.surface),
            "Traditional": escape_html(entry.traditional.as_deref().unwrap_or("")),
            "Pinyin": escape_html(&entry.pinyin.join(" / ")),
            "Definitions": definition_html(&entry.definitions),
            "Audio": "",
            "Level": level.to_string(),
            "Source": escape_html(&entry.source_url),
        }),
    );
    Value::Object(note)
}

// ---------------------------------------------------------- Pronunciation

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ToneSyllable {
    pub pinyin: String,
    pub tone: u8,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PronunciationCandidate {
    pub anki_card_id: String,
    pub word: String,
    pub definition: String,
    pub syllables: [ToneSyllable; 2],
    pub tone_pair: String,
    pub audio_filename: String,
}

const TONE_MARKS: [(char, char, u8); 28] = [
    ('ā', 'a', 1), ('á', 'a', 2), ('ǎ', 'a', 3), ('à', 'a', 4),
    ('ē', 'e', 1), ('é', 'e', 2), ('ě', 'e', 3), ('è', 'e', 4),
    ('ī', 'i', 1), ('í', 'i', 2), ('ǐ', 'i', 3), ('ì', 'i', 4),
    ('ō', 'o', 1), ('ó', 'o', 2), ('ǒ', 'o', 3), ('ò', 'o', 4),
    ('ū', 'u', 1), ('ú', 'u', 2), ('ǔ', 'u', 3), ('ù', 'u', 4),
    ('ǖ', 'ü', 1), ('ǘ', 'ü', 2), ('ǚ', 'ü', 3), ('ǜ', 'ü', 4),
    ('ń', 'n', 2), ('ň', 'n', 3), ('ǹ', 'n', 4), ('ḿ', 'm', 2),
];

fn marked(vowel: char) -> Option<[char; 4]> {
    Some(match vowel {
        'a' => ['ā', 'á', 'ǎ', 'à'],
        'e' => ['ē', 'é', 'ě', 'è'],
        'i' => ['ī', 'í', 'ǐ', 'ì'],
        'o' => ['ō', 'ó', 'ǒ', 'ò'],
        'u' => ['ū', 'ú', 'ǔ', 'ù'],
        'ü' => ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
        _ => return None,
    })
}

fn nfc_lower(s: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    s.trim().to_lowercase().nfc().collect()
}

fn tone_of(syllable: &str) -> u8 {
    let normalized = nfc_lower(syllable);
    if let Some(d) = normalized.chars().last().and_then(|c| c.to_digit(10)).filter(|d| (1..=5).contains(d)) {
        return d as u8;
    }
    normalized.chars().find_map(|c| TONE_MARKS.iter().find(|(m, _, _)| *m == c).map(|(_, _, t)| *t)).unwrap_or(5)
}

fn unmarked(syllable: &str) -> String {
    let base: String = nfc_lower(syllable)
        .chars()
        .map(|c| TONE_MARKS.iter().find(|(m, _, _)| *m == c).map(|(_, b, _)| *b).unwrap_or(if c == 'v' { 'ü' } else { c }))
        .collect();
    base.trim_end_matches(|c: char| ('1'..='5').contains(&c)).to_string()
}

fn with_tone(syllable: &str, tone: u8) -> String {
    let base = unmarked(syllable);
    if tone == 5 {
        return base;
    }
    let mut chars: Vec<char> = base.chars().collect();
    let position = chars
        .iter()
        .position(|c| *c == 'a')
        .or_else(|| chars.iter().position(|c| *c == 'e'))
        .or_else(|| base.contains("ou").then(|| chars.iter().position(|c| *c == 'o')).flatten())
        .or_else(|| chars.iter().rposition(|c| marked(*c).is_some()));
    match position {
        Some(i) => {
            if let Some(marks) = marked(chars[i]) {
                chars[i] = marks[(tone - 1) as usize];
            }
            chars.into_iter().collect()
        }
        None => base,
    }
}

static RT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<rt[^>]*>(.*?)</rt>").unwrap());
static SOUND_FILE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\[sound:([^\]]+)\]").unwrap());

fn field_value<'a>(fields: &'a Value, name: &str) -> &'a str {
    fields
        .as_object()
        .and_then(|map| map.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)))
        .and_then(|(_, v)| v.get("value").and_then(Value::as_str))
        .unwrap_or("")
}

/// A two-syllable reviewed word with its spoken tone pair (applies 不/一 sandhi).
pub fn pronunciation_candidate(anki_card_id: &str, fields: &Value) -> Option<PronunciationCandidate> {
    let word = strip_anki_html(field_value(fields, "Word"));
    let readings: Vec<String> = RT
        .captures_iter(field_value(fields, "WordRuby"))
        .map(|c| strip_anki_html(&c[1]))
        .filter(|r| !r.is_empty())
        .collect();
    let audio = SOUND_FILE.captures(field_value(fields, "WordAudio")).map(|c| c[1].trim().to_string()).filter(|s| !s.is_empty())?;
    if word.is_empty() || readings.len() != 2 {
        return None;
    }
    let mut syllables = [
        ToneSyllable { pinyin: readings[0].clone(), tone: tone_of(&readings[0]) },
        ToneSyllable { pinyin: readings[1].clone(), tone: tone_of(&readings[1]) },
    ];
    let second = syllables[1].tone;
    let sandhi = if (word.starts_with('不') || word.starts_with('一')) && second == 4 {
        Some(2)
    } else if word.starts_with('一') && (1..=3).contains(&second) {
        Some(4)
    } else {
        None
    };
    if let Some(tone) = sandhi {
        syllables[0] = ToneSyllable { pinyin: with_tone(&syllables[0].pinyin, tone), tone };
    }
    if syllables[0].tone == 5 {
        return None;
    }
    Some(PronunciationCandidate {
        anki_card_id: anki_card_id.into(),
        word,
        definition: strip_anki_html(field_value(fields, "Definition")),
        tone_pair: format!("{}-{}", syllables[0].tone, syllables[1].tone),
        syllables,
        audio_filename: audio,
    })
}

fn day_number(date: NaiveDate) -> i64 {
    date.num_days_from_ce() as i64
}

/// Three-day rotation period (selection changes every three days).
pub fn rotation_period(now: DateTime<Utc>, tz: Tz) -> i64 {
    // Anchor on the Unix epoch day so periods line up with the original.
    (day_number(local_date(now, tz)) - day_number(NaiveDate::from_ymd_opt(1970, 1, 1).expect("epoch"))).div_euclid(3)
}

pub fn next_rotation_at(now: DateTime<Utc>, tz: Tz) -> NaiveDate {
    let epoch = NaiveDate::from_ymd_opt(1970, 1, 1).expect("epoch");
    epoch + Duration::days((rotation_period(now, tz) + 1) * 3)
}

pub fn tone_pair_keys() -> Vec<String> {
    (1..=4).flat_map(|a| (1..=5).map(move |b| format!("{a}-{b}"))).collect()
}

pub fn select_tone_grid(candidates: &[PronunciationCandidate], now: DateTime<Utc>, tz: Tz) -> BTreeMap<String, Option<PronunciationCandidate>> {
    let period = rotation_period(now, tz);
    tone_pair_keys()
        .into_iter()
        .map(|pair| {
            let mut unique: BTreeMap<&str, &PronunciationCandidate> = BTreeMap::new();
            for c in candidates.iter().filter(|c| c.tone_pair == pair) {
                unique.insert(c.word.as_str(), c);
            }
            let mut options: Vec<&PronunciationCandidate> = unique.into_values().collect();
            options.sort_by(|a, b| a.word.cmp(&b.word).then_with(|| a.anki_card_id.cmp(&b.anki_card_id)));
            let selected = (!options.is_empty()).then(|| {
                let index = (crate::util::fnv1a_codepoints(&pair) as i64 + period).rem_euclid(options.len() as i64) as usize;
                options[index].clone()
            });
            (pair, selected)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn fields(word: &str, a: &str, b: &str) -> Value {
        let chars: Vec<char> = word.chars().collect();
        json!({
            "Word": { "value": word },
            "WordRuby": { "value": format!("<ruby>{}<rt>{a}</rt></ruby><ruby>{}<rt>{b}</rt></ruby>", chars[0], chars[1]) },
            "Definition": { "value": "<b>test definition</b>" },
            "WordAudio": { "value": "[sound:word.mp3]" },
            "SentenceAudio": { "value": "[sound:sentence.mp3]" },
        })
    }

    #[test]
    fn tone_pairs_and_sandhi() {
        let c = pronunciation_candidate("1", &fields("中国", "zhōng", "guó")).unwrap();
        assert_eq!((c.tone_pair.as_str(), c.audio_filename.as_str(), c.definition.as_str()), ("1-2", "word.mp3", "test definition"));
        assert_eq!(pronunciation_candidate("1", &fields("你好", "nǐ", "hǎo")).unwrap().tone_pair, "3-3");
        let bu = pronunciation_candidate("1", &fields("不是", "bù", "shì")).unwrap();
        assert_eq!((bu.tone_pair.as_str(), bu.syllables[0].pinyin.as_str()), ("2-4", "bú"));
        let yi = pronunciation_candidate("1", &fields("一定", "yī", "dìng")).unwrap();
        assert_eq!((yi.tone_pair.as_str(), yi.syllables[0].pinyin.as_str()), ("2-4", "yí"));
        let yi3 = pronunciation_candidate("2", &fields("一起", "yī", "qǐ")).unwrap();
        assert_eq!((yi3.tone_pair.as_str(), yi3.syllables[0].pinyin.as_str()), ("4-3", "yì"));
    }

    #[test]
    fn rotation_is_stable_for_three_days() {
        let tz = Tz::UTC;
        let c = |id: &str, word: &str| PronunciationCandidate {
            anki_card_id: id.into(),
            word: word.into(),
            definition: word.into(),
            syllables: [ToneSyllable { pinyin: "mā".into(), tone: 1 }, ToneSyllable { pinyin: "má".into(), tone: 2 }],
            tone_pair: "1-2".into(),
            audio_filename: format!("{id}.mp3"),
        };
        let candidates = vec![c("1", "妈妈"), c("2", "今天")];
        let day = |d: u32| Utc.with_ymd_and_hms(2026, 1, d, 12, 0, 0).unwrap();
        assert_eq!(rotation_period(day(1), tz), rotation_period(day(3), tz));
        let pick = |d| select_tone_grid(&candidates, day(d), tz)["1-2"].clone().unwrap().anki_card_id;
        assert_eq!(pick(1), pick(3));
        assert_ne!(pick(4), pick(3));
    }

    #[test]
    fn blueprint_and_chisho() {
        let rows = parse_blueprint_csv("Phase,Level,# of new Characters,# of total Characters,# of new Words,# of Words,% of Words,# new for Phase,Weeks,Characters\n1,1,2,2,3,3,1%,2,1,一二\n,2,1,3,2,5,2%,,,三");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1].phase, Some(1));
        assert_eq!(rows[1].weeks, None);
        assert_eq!(rows[0].characters, vec!["一", "二"]);
        let html = r#"<li><span class="annotation text-sm">qī jiān / qí jiān</span><span class="character text-3xl">期間 〔-间〕</span><audio src="media/female/qi1jian1.mp3"></audio><div class="basis-3/4 pl-1"><div>1. period of time</div><div>2. time period</div></div></li>"#;
        let e = parse_chisho_html("期间", html);
        assert_eq!(e.pinyin, vec!["qī jiān", "qí jiān"]);
        assert_eq!(e.definitions, vec!["period of time", "time period"]);
        assert_eq!(e.audio_urls[0], "https://chisho.org/media/female/qi1jian1.mp3");
        assert_eq!(e.traditional.as_deref(), Some("期間"));
    }

    #[test]
    fn character_notes_split_decks() {
        let config = MandarinBlueprintConfiguration {
            character_deck_name: "Characters Standard".into(),
            reversed_character_deck_name: "Characters Reversed".into(),
            word_deck_name: "Words".into(),
        };
        let entry = DictionaryEntry { surface: "期".into(), traditional: Some("期".into()), pinyin: vec!["qī".into()], definitions: vec!["period".into()], audio_urls: vec![], source_url: chisho_url("期") };
        let notes = character_notes(&entry, &config, 5);
        assert_eq!(notes[0]["deckName"], "Characters Standard");
        assert_eq!(notes[1]["modelName"], REVERSED_CHARACTER_MODEL);
        assert_eq!(notes[0]["fields"]["Cue"], "period");
    }
}
