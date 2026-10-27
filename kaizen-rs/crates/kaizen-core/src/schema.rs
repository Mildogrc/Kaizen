//! The schema system: every importable content type is a versioned schema of
//! typed fields. This module validates items against fields (replacing the
//! original's runtime-built Zod validators), renders flashcard templates, and
//! builds the portable export document and LLM generation prompt.

use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::util::js_len;

pub const FIELD_TYPES: [&str; 15] = [
    "TEXT", "LONG_TEXT", "NUMBER", "BOOLEAN", "ENUM", "LIST", "OBJECT", "AUDIO", "IMAGE", "MARKDOWN", "CODE", "LATEX", "JSON",
    "DATE", "URL",
];

pub const CATEGORIES: [&str; 6] = ["LANGUAGE", "MATH", "CERTIFICATION", "BOOK", "SKILL", "CUSTOM"];

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationRules {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_length: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_length: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
    /// element type for LIST fields: "text" | "number"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_items: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_items: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldDef {
    pub name: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub field_type: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub validation_rules: ValidationRules,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enum_options: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub example_value: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_value: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub import_instructions: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm_instructions: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashcardRule {
    pub name: String,
    /// template with {{fieldName}} placeholders
    pub front: String,
    pub back: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeRule {
    #[serde(rename = "type")]
    pub kind: String,
    pub prompt_field: String,
    pub answer_field: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaConfig {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub flashcard_rules: Vec<FlashcardRule>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub practice_rules: Vec<PracticeRule>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm_prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completion_criteria: Option<String>,
    /// Everything else (srsRules, practiceModes, instructions) passes through.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaDef {
    pub slug: String,
    pub name: String,
    pub item_type: String,
    pub category: String,
    #[serde(default)]
    pub course_slug: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub fields: Vec<FieldDef>,
    #[serde(default)]
    pub config: SchemaConfig,
}

// --------------------------------------------------------------- Validation

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ItemError {
    pub index: usize,
    pub errors: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ValidItem {
    pub index: usize,
    pub data: Value,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct ValidationResult {
    pub valid: Vec<ValidItem>,
    pub invalid: Vec<ItemError>,
}

fn type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn expected(kind: &str, value: &Value) -> String {
    format!("Invalid input: expected {kind}, received {}", type_name(value))
}

fn check_string(value: &Value, rules: &ValidationRules, errors: &mut Vec<String>, path: &str) {
    let Some(s) = value.as_str() else {
        errors.push(format!("{path}: {}", expected("string", value)));
        return;
    };
    let len = js_len(s) as f64;
    if let Some(min) = rules.min_length
        && len < min
    {
        errors.push(format!("{path}: Too small: expected string to have >={min} characters"));
    }
    if let Some(max) = rules.max_length
        && len > max
    {
        errors.push(format!("{path}: Too big: expected string to have <={max} characters"));
    }
    if let Some(pattern) = rules.pattern.as_deref().filter(|p| !p.is_empty()) {
        match Regex::new(pattern) {
            Ok(re) if !re.is_match(s) => errors.push(format!("{path}: Invalid string: must match pattern /{pattern}/")),
            Err(_) => errors.push(format!("{path}: Schema pattern /{pattern}/ is not supported")),
            _ => {}
        }
    }
}

static ISO_DATE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$").unwrap());

fn parse_date_like(s: &str) -> bool {
    let t = s.trim();
    if ISO_DATE.is_match(t) {
        let date = &t[..10];
        return chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok();
    }
    chrono::DateTime::parse_from_rfc2822(t).is_ok() || chrono::DateTime::parse_from_rfc3339(t).is_ok()
}

fn validate_field(field: &FieldDef, value: &Value, errors: &mut Vec<String>) {
    let path = field.name.as_str();
    let rules = &field.validation_rules;
    match field.field_type.as_str() {
        "NUMBER" => match value.as_f64() {
            Some(n) => {
                if let Some(min) = rules.min
                    && n < min
                {
                    errors.push(format!("{path}: Too small: expected number to be >={min}"));
                }
                if let Some(max) = rules.max
                    && n > max
                {
                    errors.push(format!("{path}: Too big: expected number to be <={max}"));
                }
            }
            None => errors.push(format!("{path}: {}", expected("number", value))),
        },
        "BOOLEAN" => {
            if !value.is_boolean() {
                errors.push(format!("{path}: {}", expected("boolean", value)));
            }
        }
        "ENUM" => {
            let options = field.enum_options.as_deref().unwrap_or(&[]);
            match value.as_str() {
                Some(s) if options.is_empty() || options.iter().any(|o| o == s) => {}
                Some(_) => errors.push(format!(
                    "{path}: Invalid option: expected one of {}",
                    options.iter().map(|o| format!("\"{o}\"")).collect::<Vec<_>>().join("|")
                )),
                None => errors.push(format!("{path}: {}", expected("string", value))),
            }
        }
        "LIST" => match value.as_array() {
            Some(items) => {
                let numbers = rules.item_type.as_deref() == Some("number");
                for (i, item) in items.iter().enumerate() {
                    let ok = if numbers { item.is_number() } else { item.is_string() };
                    if !ok {
                        errors.push(format!("{path}.{i}: {}", expected(if numbers { "number" } else { "string" }, item)));
                    }
                }
                if let Some(min) = rules.min_items
                    && (items.len() as f64) < min
                {
                    errors.push(format!("{path}: Too small: expected array to have >={min} items"));
                }
                if let Some(max) = rules.max_items
                    && (items.len() as f64) > max
                {
                    errors.push(format!("{path}: Too big: expected array to have <={max} items"));
                }
            }
            None => errors.push(format!("{path}: {}", expected("array", value))),
        },
        "OBJECT" => {
            if !value.is_object() {
                errors.push(format!("{path}: {}", expected("record", value)));
            }
        }
        "JSON" => {
            if value.is_null() {
                errors.push(format!("{path}: Invalid input: expected JSON value, received null"));
            }
        }
        "URL" => match value.as_str() {
            Some(s) if url::Url::parse(s).is_ok() => {}
            Some(_) => errors.push(format!("{path}: Invalid URL")),
            None => errors.push(format!("{path}: {}", expected("string", value))),
        },
        "DATE" => match value.as_str() {
            Some(s) if parse_date_like(s) => {}
            Some(_) => errors.push(format!("{path}: Invalid date string")),
            None => errors.push(format!("{path}: {}", expected("string", value))),
        },
        _ => check_string(value, rules, errors, path),
    }
}

/// Validate one candidate item. Unknown keys are errors so generated output
/// must conform exactly; optional fields may be omitted (not null).
pub fn validate_item(fields: &[FieldDef], item: &Value) -> Result<Value, Vec<String>> {
    let Some(object) = item.as_object() else {
        return Err(vec![format!("(root): {}", expected("object", item))]);
    };
    let mut errors = Vec::new();
    for field in fields {
        match object.get(&field.name) {
            None => {
                if field.required {
                    errors.push(format!("{}: Invalid input: expected {}, received undefined", field.name, json_type(field)));
                }
            }
            Some(value) => validate_field(field, value, &mut errors),
        }
    }
    let unknown: Vec<&String> = object.keys().filter(|k| !fields.iter().any(|f| &f.name == *k)).collect();
    if !unknown.is_empty() {
        errors.push(format!(
            "(root): Unrecognized key{}: {}",
            if unknown.len() == 1 { "" } else { "s" },
            unknown.iter().map(|k| format!("\"{k}\"")).collect::<Vec<_>>().join(", ")
        ));
    }
    if errors.is_empty() { Ok(item.clone()) } else { Err(errors) }
}

pub fn validate_items(fields: &[FieldDef], items: &[Value]) -> ValidationResult {
    let mut result = ValidationResult::default();
    for (index, item) in items.iter().enumerate() {
        match validate_item(fields, item) {
            Ok(data) => result.valid.push(ValidItem { index, data }),
            Err(errors) => result.invalid.push(ItemError { index, errors }),
        }
    }
    result
}

// ------------------------------------------------------------- Flashcards

static PLACEHOLDER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\{\{(\w+)\}\}").unwrap());

/// Fill a `{{field}}` template; None when any referenced field is missing or
/// empty (that card is simply not generated for the item).
pub fn render_template(template: &str, data: &Value) -> Option<String> {
    let mut missing = false;
    let out = PLACEHOLDER.replace_all(template, |caps: &regex::Captures| match data.get(&caps[1]) {
        None | Some(Value::Null) => {
            missing = true;
            String::new()
        }
        Some(Value::String(s)) if s.is_empty() => {
            missing = true;
            String::new()
        }
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .map(|v| match v {
                Value::String(s) => s.clone(),
                Value::Null => String::new(),
                other => other.to_string(),
            })
            .collect::<Vec<_>>()
            .join(", "),
        Some(other) => other.to_string(),
    });
    (!missing).then(|| out.trim().to_string())
}

#[derive(Clone, Debug, PartialEq)]
pub struct GeneratedCard {
    pub learning_item_id: String,
    pub rule_name: String,
    pub front: String,
    pub back: String,
}

pub fn generate_cards(items: &[(String, Value)], rules: &[FlashcardRule]) -> Vec<GeneratedCard> {
    let mut out = Vec::new();
    for (id, data) in items {
        for rule in rules {
            if let (Some(front), Some(back)) = (render_template(&rule.front, data), render_template(&rule.back, data))
                && !front.is_empty()
                && !back.is_empty()
            {
                out.push(GeneratedCard { learning_item_id: id.clone(), rule_name: rule.name.clone(), front, back });
            }
        }
    }
    out
}

#[derive(Clone, Debug, PartialEq)]
pub struct GeneratedPractice {
    pub learning_item_id: String,
    pub kind: String,
    pub prompt: String,
    pub answer: String,
}

pub fn generate_practice(items: &[(String, Value)], rules: &[PracticeRule]) -> Vec<GeneratedPractice> {
    let mut out = Vec::new();
    for (id, data) in items {
        for rule in rules {
            let prompt = data.get(&rule.prompt_field).and_then(Value::as_str).filter(|s| !s.is_empty());
            let answer = data.get(&rule.answer_field).and_then(Value::as_str).filter(|s| !s.is_empty());
            if let (Some(prompt), Some(answer)) = (prompt, answer) {
                out.push(GeneratedPractice {
                    learning_item_id: id.clone(),
                    kind: rule.kind.clone(),
                    prompt: prompt.to_string(),
                    answer: answer.to_string(),
                });
            }
        }
    }
    out
}

// ------------------------------------------------------- Export and prompt

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaExport {
    pub schema_name: String,
    pub schema_slug: String,
    pub schema_version: i64,
    pub item_type: String,
    pub category: String,
    pub description: Option<String>,
    pub fields: Vec<FieldDef>,
    pub config: Value,
    pub example_item: Value,
}

pub fn build_export(
    name: &str,
    slug: &str,
    item_type: &str,
    category: &str,
    description: Option<&str>,
    version: i64,
    config: &Value,
    fields: &[FieldDef],
) -> SchemaExport {
    let mut example = Map::new();
    for f in fields {
        if let Some(v) = &f.example_value {
            example.insert(f.name.clone(), v.clone());
        } else if f.required {
            let placeholder = match f.field_type.as_str() {
                "NUMBER" => Value::from(1),
                "BOOLEAN" => Value::Bool(true),
                "LIST" => Value::Array(vec![]),
                _ => Value::String("…".into()),
            };
            example.insert(f.name.clone(), placeholder);
        }
    }
    SchemaExport {
        schema_name: name.into(),
        schema_slug: slug.into(),
        schema_version: version,
        item_type: item_type.into(),
        category: category.into(),
        description: description.map(str::to_string),
        fields: fields.to_vec(),
        config: if config.is_object() { config.clone() } else { Value::Object(Map::new()) },
        example_item: Value::Object(example),
    }
}

fn json_type(f: &FieldDef) -> &'static str {
    match f.field_type.as_str() {
        "NUMBER" => "number",
        "BOOLEAN" => "boolean",
        "LIST" => "array",
        "OBJECT" | "JSON" => "object",
        _ => "string",
    }
}

fn num(v: f64) -> String {
    if v.fract() == 0.0 { format!("{}", v as i64) } else { format!("{v}") }
}

fn field_rules(f: &FieldDef) -> String {
    let mut rules = Vec::new();
    let v = &f.validation_rules;
    if f.field_type == "ENUM"
        && let Some(options) = f.enum_options.as_ref().filter(|o| !o.is_empty())
    {
        rules.push(format!("one of: {}", options.iter().map(|o| format!("\"{o}\"")).collect::<Vec<_>>().join(", ")));
    }
    if f.field_type == "LIST" {
        rules.push(format!("array of {}", if v.item_type.as_deref() == Some("number") { "numbers" } else { "strings" }));
    }
    if let Some(x) = v.min_length {
        rules.push(format!("min length {}", num(x)));
    }
    if let Some(x) = v.max_length {
        rules.push(format!("max length {}", num(x)));
    }
    if let Some(x) = v.min {
        rules.push(format!("min {}", num(x)));
    }
    if let Some(x) = v.max {
        rules.push(format!("max {}", num(x)));
    }
    if let Some(p) = v.pattern.as_deref().filter(|p| !p.is_empty()) {
        rules.push(format!("must match /{p}/"));
    }
    if let Some(x) = v.min_items {
        rules.push(format!("min {} items", num(x)));
    }
    if let Some(x) = v.max_items {
        rules.push(format!("max {} items", num(x)));
    }
    rules.join("; ")
}

/// Self-contained markdown prompt: send it with source material to any LLM
/// and get back a JSON array that the import validates against this schema.
pub fn build_llm_prompt(doc: &SchemaExport) -> String {
    let row = |f: &FieldDef| {
        let rules = field_rules(f);
        let notes: Vec<&str> = [f.description.as_deref(), f.llm_instructions.as_deref()].into_iter().flatten().collect();
        format!(
            "| `{}` | {} ({}) | {} | {} | {} |",
            f.name,
            json_type(f),
            f.field_type.to_lowercase().replacen('_', " ", 1),
            if f.required { "**yes**" } else { "no" },
            if rules.is_empty() { "—".to_string() } else { rules },
            notes.join(" ")
        )
    };
    let required: Vec<String> = doc.fields.iter().filter(|f| f.required).map(row).collect();
    let optional: Vec<String> = doc.fields.iter().filter(|f| !f.required).map(row).collect();
    let mut bad = doc.example_item.as_object().cloned().unwrap_or_default();
    bad.insert("madeUpField".into(), Value::String("not allowed".into()));
    let first_enum = doc.fields.iter().find(|f| f.field_type == "ENUM" && f.enum_options.as_ref().is_some_and(|o| !o.is_empty()));
    if let Some(f) = first_enum {
        bad.insert(f.name.clone(), Value::String("INVALID_OPTION".into()));
    }
    let pretty = |v: &Value| serde_json::to_string_pretty(v).unwrap_or_default();
    let description = doc.description.as_deref().map(|d| format!("> {d}\n")).unwrap_or_default();
    let guidance = doc
        .config
        .get("llmPrompt")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(|g| format!("\nDomain guidance: {g}\n"))
        .unwrap_or_default();
    let enum_reason = first_enum
        .map(|f| format!(", and `{}` is not one of the allowed enum values", f.name))
        .unwrap_or_default();

    format!(
        "# Content generation task: {name}

You are generating study content for a personal learning app. Convert the
source material provided together with this prompt into a **JSON array of
`{item_type}` items** that conforms exactly to the schema below
(schema `{slug}`, version {version}).

{description}{guidance}
## Output rules

1. Return **only** a JSON array. No markdown fences, no commentary, no explanations.
2. Every item must conform exactly to the field specification. Unknown or extra keys cause the item to be **rejected**.
3. Include every required field in every item.
4. Omit optional fields you cannot fill accurately — never invent data.
5. Convert **all** of the provided source material unless instructed otherwise.
6. Strings must use the exact enum spellings where an enum is specified.

## Field specification

| field | JSON type | required | rules | notes |
|---|---|---|---|---|
{required}
{optional}

## Valid output example

```json
{valid}
```

## Invalid example — do NOT do this

```json
{invalid}
```

Why it fails: `madeUpField` is not in the schema (unknown keys are rejected){enum_reason}.

## Source material

The source material follows this prompt. Convert it now, returning only the JSON array.
",
        name = doc.schema_name,
        item_type = doc.item_type,
        slug = doc.schema_slug,
        version = doc.schema_version,
        required = required.join("\n"),
        optional = optional.join("\n"),
        valid = pretty(&Value::Array(vec![doc.example_item.clone()])),
        invalid = pretty(&Value::Array(vec![Value::Object(bad)])),
    )
}

/// Parse JSON that may be wrapped in a markdown code fence (LLM output).
pub fn parse_json_text(input: &str) -> Result<Value, String> {
    let trimmed = input.trim();
    let unfenced = if trimmed.starts_with("```") {
        let without_open = trimmed.trim_start_matches("```");
        let without_lang = without_open.strip_prefix("json").or_else(|| without_open.strip_prefix("JSON")).unwrap_or(without_open);
        without_lang.trim_end().trim_end_matches("```").trim()
    } else {
        trimmed
    };
    serde_json::from_str(unfenced).map_err(|e| e.to_string())
}

/// Find the first JSON array/object in free text (for AI replies with prose).
pub fn extract_json(text: &str) -> Option<Value> {
    if let Ok(v) = parse_json_text(text) {
        return Some(v);
    }
    let fence = Regex::new(r"(?s)```(?:json)?\s*(.*?)```").ok()?;
    for caps in fence.captures_iter(text) {
        if let Ok(v) = serde_json::from_str::<Value>(caps[1].trim()) {
            return Some(v);
        }
    }
    let start = text.find(['[', '{'])?;
    let end = text.rfind([']', '}'])?;
    (end > start).then(|| serde_json::from_str(&text[start..=end]).ok()).flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn vocab_fields() -> Vec<FieldDef> {
        crate::seed::schemas().into_iter().find(|s| s.slug == "japanese-vocabulary").unwrap().fields
    }

    #[test]
    fn validates_required_types_enums_and_unknown_keys() {
        let fields = vocab_fields();
        let items = vec![
            json!({"term": "勉強", "reading": "べんきょう", "meaning": "study", "partOfSpeech": "noun"}),
            json!({"term": "猫", "meaning": "cat"}),
            json!({"term": "犬", "reading": "いぬ", "meaning": "dog", "partOfSpeech": "animal", "extra": 1}),
            json!({"term": "本", "reading": "ほん", "meaning": "book", "frequencyRank": 0, "tags": ["a", 2]}),
        ];
        let r = validate_items(&fields, &items);
        assert_eq!(r.valid.len(), 1);
        assert_eq!(r.invalid.len(), 3);
        assert!(r.invalid[0].errors[0].starts_with("reading:"));
        assert!(r.invalid[1].errors.iter().any(|e| e.contains("partOfSpeech: Invalid option")));
        assert!(r.invalid[1].errors.iter().any(|e| e.contains("Unrecognized key: \"extra\"")));
        assert!(r.invalid[2].errors.iter().any(|e| e.starts_with("frequencyRank: Too small")));
        assert!(r.invalid[2].errors.iter().any(|e| e.starts_with("tags.1:")));
    }

    #[test]
    fn kanji_length_counts_utf16_units() {
        let fields = crate::seed::schemas().into_iter().find(|s| s.slug == "japanese-kanji").unwrap().fields;
        assert!(validate_item(&fields, &json!({"character": "強", "meaning": "strong"})).is_ok());
        assert!(validate_item(&fields, &json!({"character": "強い", "meaning": "strong"})).is_err());
    }

    #[test]
    fn templates_skip_missing_fields() {
        let data = json!({"term": "猫", "reading": "ねこ", "tags": ["a", "b"], "empty": ""});
        assert_eq!(render_template("{{term}} — {{reading}}", &data).as_deref(), Some("猫 — ねこ"));
        assert_eq!(render_template("{{tags}}", &data).as_deref(), Some("a, b"));
        assert_eq!(render_template("{{pitchAccent}}", &data), None);
        assert_eq!(render_template("{{empty}}", &data), None);
    }

    #[test]
    fn prompt_lists_fields_and_examples() {
        let def = crate::seed::schemas().into_iter().find(|s| s.slug == "japanese-vocabulary").unwrap();
        let config = serde_json::to_value(&def.config).unwrap();
        let doc = build_export(&def.name, &def.slug, &def.item_type, &def.category, def.description.as_deref(), 1, &config, &def.fields);
        assert_eq!(doc.example_item["term"], "勉強");
        let md = build_llm_prompt(&doc);
        assert!(md.contains("# Content generation task: Japanese Vocabulary"));
        assert!(md.contains("| `term` | string (text) | **yes** |"));
        assert!(md.contains("Domain guidance: Generate Japanese vocabulary"));
        assert!(md.contains("\"partOfSpeech\": \"INVALID_OPTION\""));
    }

    #[test]
    fn json_extraction_from_ai_replies() {
        assert_eq!(parse_json_text("```json\n[1, 2]\n```").unwrap(), json!([1, 2]));
        assert_eq!(extract_json("Here you go:\n```json\n{\"a\": 1}\n```\nEnjoy").unwrap(), json!({"a": 1}));
        assert_eq!(extract_json("Sure! [ {\"x\": true} ] done").unwrap(), json!([{"x": true}]));
    }
}
