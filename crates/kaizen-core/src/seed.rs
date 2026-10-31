//! Embedded seed data: the starting workspace every new account receives.

use serde::Deserialize;
use serde_json::{Value, json};

use crate::schema::SchemaDef;

pub const SCHEMAS_JSON: &str = include_str!("../seed/schemas.json");
pub const MATH_ROADMAP_JSON: &str = include_str!("../seed/math-roadmap.json");
pub const KANJI_EXTRACT_JSON: &str = include_str!("../seed/kanji-extract.json");
pub const JLPT_GOLDEN_JSON: &str = include_str!("../seed/jlpt-grammar.golden.json");
pub const STARTER_CONCEPT_MAPS: [&str; 2] =
    [include_str!("../seed/concepts/linear-algebra.json"), include_str!("../seed/concepts/calculus-1.json")];

pub fn jlpt_csv(level: &str) -> &'static str {
    match level {
        "N5" => include_str!("../seed/jlpt-N5.csv"),
        "N4" => include_str!("../seed/jlpt-N4.csv"),
        "N3" => include_str!("../seed/jlpt-N3.csv"),
        "N2" => include_str!("../seed/jlpt-N2.csv"),
        _ => include_str!("../seed/jlpt-N1.csv"),
    }
}

pub fn schemas() -> Vec<SchemaDef> {
    serde_json::from_str(SCHEMAS_JSON).expect("bundled schemas.json is valid")
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeedNode {
    pub slug: String,
    pub title: String,
    pub branch: String,
    pub level: String,
    #[serde(default)]
    pub is_target: bool,
    pub description: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SeedEdge {
    pub from: String,
    pub to: String,
    #[serde(default = "prerequisite")]
    pub kind: String,
}

fn prerequisite() -> String {
    "PREREQUISITE".into()
}

#[derive(Clone, Debug, Deserialize)]
pub struct SeedRoadmap {
    pub nodes: Vec<SeedNode>,
    pub edges: Vec<SeedEdge>,
}

pub fn math_roadmap() -> SeedRoadmap {
    serde_json::from_str(MATH_ROADMAP_JSON).expect("bundled math-roadmap.json is valid")
}

pub struct SeedCourse {
    pub slug: &'static str,
    pub name: &'static str,
    pub category: &'static str,
    pub tab: &'static str,
    pub color: &'static str,
    pub description: &'static str,
}

pub const COURSES: [SeedCourse; 6] = [
    SeedCourse { slug: "japanese", name: "Japanese", category: "LANGUAGE", tab: "JAPANESE", color: "#e11d48", description: "Japanese from beginner to advanced: JLPT N5–N1, BJT, Kanji Kentei." },
    SeedCourse { slug: "chinese", name: "Chinese", category: "LANGUAGE", tab: "CHINESE", color: "#dc2626", description: "Mandarin Chinese: HSK 1 through HSK 9, simplified and traditional." },
    SeedCourse { slug: "math", name: "Mathematics", category: "MATH", tab: "MATH", color: "#2563eb", description: "School math through advanced pure and applied mathematics." },
    SeedCourse { slug: "typing", name: "Typing", category: "SKILL", tab: "SKILLS", color: "#16a34a", description: "Typing speed and accuracy: WPM, weak keys, custom drills." },
    SeedCourse { slug: "geoguessr", name: "GeoGuessr", category: "SKILL", tab: "SKILLS", color: "#ca8a04", description: "Country identification: flags, signs, plates, bollards, scripts." },
    SeedCourse { slug: "books", name: "Books", category: "BOOK", tab: "BOOKS", color: "#9333ea", description: "Reading tracker and knowledge retention from books." },
];

pub struct SeedExamLevel {
    pub name: String,
    pub rank: i64,
    pub targets: Value,
    pub description: Option<&'static str>,
    /// (title, category, target count)
    pub objectives: Vec<(String, &'static str, Option<i64>)>,
}

pub struct SeedExam {
    pub course: &'static str,
    pub slug: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub levels: Vec<SeedExamLevel>,
}

pub fn exams() -> Vec<SeedExam> {
    let jlpt = [("N5", 800, 100, 40), ("N4", 1500, 300, 50), ("N3", 3750, 650, 63), ("N2", 6000, 1000, 63), ("N1", 10000, 2000, 70)];
    let bjt = ["J5", "J4", "J3", "J2", "J1", "J1+"];
    let bjt_scores = [0, 200, 320, 420, 530, 600];
    let kanken = [("10", 80), ("9", 240), ("8", 440), ("7", 640), ("6", 835), ("5", 1026), ("4", 1339), ("3", 1623), ("Pre-2", 1951), ("2", 2136), ("Pre-1", 3000), ("1", 6000)];
    let hsk_vocab = [500, 1272, 2245, 3245, 4316, 5456, 7000, 9000, 11092];
    let hsk_chars = [300, 600, 900, 1200, 1500, 1800, 2200, 2600, 3000];
    vec![
        SeedExam {
            course: "japanese",
            slug: "jlpt",
            name: "JLPT",
            description: "Japanese-Language Proficiency Test, levels N5 (easiest) to N1.",
            levels: jlpt
                .iter()
                .enumerate()
                .map(|(i, (name, vocab, kanji, grammar))| SeedExamLevel {
                    name: (*name).into(),
                    rank: i as i64 + 1,
                    targets: json!({ "targetVocab": vocab, "targetKanji": kanji, "targetGrammar": grammar }),
                    description: None,
                    objectives: vec![
                        (format!("Vocabulary for {name}"), "vocabulary", Some(*vocab)),
                        (format!("Kanji for {name}"), "kanji", Some(*kanji)),
                        (format!("Grammar points for {name}"), "grammar", Some(*grammar)),
                        (format!("Reading practice for {name}"), "reading", None),
                        (format!("Listening practice for {name}"), "listening", None),
                    ],
                })
                .collect(),
        },
        SeedExam {
            course: "japanese",
            slug: "bjt",
            name: "BJT Business Japanese Test",
            description: "Business Japanese Proficiency Test, scored 0–800, grades J5–J1+.",
            levels: bjt
                .iter()
                .enumerate()
                .map(|(i, name)| SeedExamLevel {
                    name: (*name).into(),
                    rank: i as i64 + 1,
                    targets: json!({ "targetScore": bjt_scores[i] }),
                    description: Some("Business vocabulary, keigo, documents, listening comprehension."),
                    objectives: vec![],
                })
                .collect(),
        },
        SeedExam {
            course: "japanese",
            slug: "kanji-kentei",
            name: "Kanji Kentei",
            description: "Japan Kanji Aptitude Test, level 10 (easiest) to level 1 (~6,000 kanji).",
            levels: kanken
                .iter()
                .enumerate()
                .map(|(i, (name, kanji))| SeedExamLevel {
                    name: (*name).into(),
                    rank: i as i64 + 1,
                    targets: json!({ "targetKanji": kanji }),
                    description: None,
                    objectives: vec![],
                })
                .collect(),
        },
        SeedExam {
            course: "chinese",
            slug: "hsk",
            name: "HSK",
            description: "Hanyu Shuiping Kaoshi, levels 1–9 (HSK 3.0).",
            levels: (0..9)
                .map(|i| {
                    let name = format!("HSK {}", i + 1);
                    SeedExamLevel {
                        objectives: vec![
                            (format!("Vocabulary for {name}"), "vocabulary", Some(hsk_vocab[i])),
                            (format!("Characters for {name}"), "characters", Some(hsk_chars[i])),
                            (format!("Grammar for {name}"), "grammar", None),
                            (format!("Reading practice for {name}"), "reading", None),
                            (format!("Listening practice for {name}"), "listening", None),
                        ],
                        name,
                        rank: i as i64 + 1,
                        targets: json!({ "targetVocab": hsk_vocab[i], "targetChars": hsk_chars[i] }),
                        description: None,
                    }
                })
                .collect(),
        },
    ]
}

pub struct SeedGoal {
    pub course: &'static str,
    pub title: &'static str,
    pub goal_type: &'static str,
    pub target_value: Option<i64>,
    pub unit: Option<&'static str>,
    pub status: &'static str,
    pub description: &'static str,
}

pub const GOALS: [SeedGoal; 4] = [
    SeedGoal { course: "japanese", title: "Reach 500 words", goal_type: "vocab_count", target_value: Some(500), unit: Some("words"), status: "ACTIVE", description: "Build the core vocabulary base before starting the JLPT N5 path." },
    SeedGoal { course: "japanese", title: "Prepare for JLPT N5", goal_type: "exam_prep", target_value: None, unit: None, status: "PLANNED", description: "Starts once the 500-word base is reached." },
    SeedGoal { course: "chinese", title: "Reach 500 Chinese words", goal_type: "vocab_count", target_value: Some(500), unit: Some("words"), status: "ACTIVE", description: "HSK 1 vocabulary base: pinyin, tones, core characters." },
    SeedGoal { course: "math", title: "Path to Iwasawa Theory", goal_type: "roadmap_target", target_value: None, unit: None, status: "ACTIVE", description: "Work through the algebra/number-theory chain toward Iwasawa Theory." },
];

/// (course, title, metric, target)
pub const MILESTONES: [(&str, &str, Option<&str>, Option<i64>); 16] = [
    ("japanese", "Learn kana + core words", Some("words"), Some(100)),
    ("japanese", "Reach 500 words", Some("words"), Some(500)),
    ("japanese", "Start JLPT N5 path", Some("words"), Some(800)),
    ("japanese", "Reach 1,500 words", Some("words"), Some(1500)),
    ("japanese", "Start JLPT N4/N3 path", Some("words"), Some(3750)),
    ("japanese", "Reach 4,000–6,000 words", Some("words"), Some(6000)),
    ("japanese", "Start JLPT N2/N1 path", Some("words"), Some(10000)),
    ("japanese", "Add BJT track", None, None),
    ("japanese", "Add Kanji Kentei track", Some("kanji"), Some(2136)),
    ("chinese", "Pinyin + tones solid", None, None),
    ("chinese", "Reach 500 words (HSK 1)", Some("words"), Some(500)),
    ("chinese", "Reach 1,272 words (HSK 2)", Some("words"), Some(1272)),
    ("chinese", "Reach 2,245 words (HSK 3)", Some("words"), Some(2245)),
    ("chinese", "Reach 3,245 words (HSK 4)", Some("words"), Some(3245)),
    ("chinese", "Reach 5,456 words (HSK 6)", Some("words"), Some(5456)),
    ("chinese", "HSK 7–9 band", Some("words"), Some(11092)),
];

pub const STARTER_PASSAGE_TITLE: &str = "Why Spacing Strengthens Memory";

pub fn starter_passage() -> Value {
    json!({
        "title": STARTER_PASSAGE_TITLE,
        "topic": "The spacing effect and retrieval practice",
        "category": "learning science",
        "difficulty": "intermediate",
        "sourceUrl": "https://en.wikipedia.org/wiki/Spacing_effect",
        "text": "Students often assume that repeating the same material many times in one sitting is the fastest way to learn it. That method can create a strong feeling of familiarity, but familiarity is not the same as durable memory. When practice is concentrated into one block, the next repetition arrives while the previous one is still easy to recall.\n\nThe spacing effect describes the advantage of distributing study over time. A learner might review a fact today, return to it tomorrow, and revisit it several days later. Each successful retrieval requires more effort than the last immediate repetition. That effort helps strengthen access to the memory and provides evidence about what is actually becoming difficult.\n\nSpacing works especially well when it is combined with retrieval practice. Instead of rereading an answer, the learner first tries to produce it from memory and then checks the result. A scheduler can lengthen the interval after a confident answer and shorten it after an error. The intervals should grow gradually rather than according to a rigid calendar that ignores performance.\n\nThe method is not a reason to delay every kind of practice. Closely grouped attempts can be useful while a skill is brand new, and difficult material may need shorter intervals. The central idea is to avoid treating a temporary sense of ease as proof of mastery. Durable learning is better measured by successful recall after some forgetting has had time to occur.",
        "questions": [
            { "id": "q1", "prompt": "Why can blocked repetition create a misleading sense of learning?", "choices": ["It removes all feedback", "The material remains temporarily familiar", "It always uses difficult questions", "The intervals become too long"] },
            { "id": "q2", "prompt": "What does the passage recommend combining with spacing?", "choices": ["Passive rereading", "Highlighting every sentence", "Retrieval practice", "A rigid calendar"] },
            { "id": "q3", "prompt": "How should a scheduler react to an error?", "choices": ["Shorten the next interval", "End the topic permanently", "Double the interval", "Ignore performance"] },
            { "id": "q4", "prompt": "What is the passage’s main standard for durable learning?", "choices": ["Feeling fluent during one session", "Completing many repetitions", "Reading without pauses", "Successful recall after some forgetting"] }
        ],
        "answerKey": [
            { "questionId": "q1", "correctIndex": 1, "explanation": "Immediate repetition stays easy because the previous exposure is still familiar." },
            { "questionId": "q2", "correctIndex": 2, "explanation": "The passage explicitly pairs spacing with attempting retrieval before checking." },
            { "questionId": "q3", "correctIndex": 0, "explanation": "Errors indicate that the next interval should be shorter." },
            { "questionId": "q4", "correctIndex": 3, "explanation": "The conclusion contrasts temporary ease with recall after time has passed." }
        ]
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn bundled_data_parses() {
        assert_eq!(super::schemas().len(), 21);
        let roadmap = super::math_roadmap();
        assert_eq!(roadmap.nodes.len(), 55);
        assert_eq!(roadmap.edges.len(), 129);
        assert_eq!(super::exams().iter().map(|e| e.levels.len()).sum::<usize>(), 32);
    }
}
