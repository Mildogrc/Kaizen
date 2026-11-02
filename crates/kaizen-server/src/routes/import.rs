//! Content import (validate JSON against a schema, then save) and the schema designer.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use kaizen_core::schema::{self, FieldDef, ValidationRules};
use kaizen_core::util::slugify;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::auth::User;
use crate::crypto::new_id;
use crate::error::{ApiError, ApiResult};
use crate::state::App;

#[derive(sqlx::FromRow)]
struct FieldRow {
    name: String,
    label: String,
    description: Option<String>,
    field_type: String,
    required: bool,
    validation_rules: Value,
    enum_options: Option<Value>,
    example_value: Option<Value>,
    default_value: Option<Value>,
    import_instructions: Option<String>,
    llm_instructions: Option<String>,
}

impl FieldRow {
    fn def(self) -> FieldDef {
        FieldDef {
            name: self.name,
            label: self.label,
            description: self.description,
            field_type: self.field_type,
            required: self.required,
            validation_rules: serde_json::from_value::<ValidationRules>(self.validation_rules).unwrap_or_default(),
            enum_options: self.enum_options.map(|v| crate::db::json_strings(&v)),
            example_value: self.example_value,
            default_value: self.default_value,
            import_instructions: self.import_instructions,
            llm_instructions: self.llm_instructions,
        }
    }
}

#[derive(sqlx::FromRow)]
struct SchemaRow {
    id: String,
    slug: String,
    name: String,
    item_type: String,
    category: String,
    description: Option<String>,
    course_id: Option<String>,
    course_slug: Option<String>,
    course_name: Option<String>,
}

struct LoadedSchema {
    row: SchemaRow,
    version_id: String,
    version: i32,
    config: Value,
    fields: Vec<FieldDef>,
}

async fn load_schema(app: &App, user: &User, slug: &str) -> ApiResult<LoadedSchema> {
    let row: SchemaRow = sqlx::query_as(
        "SELECT s.id, s.slug, s.name, s.item_type, s.category, s.description, s.course_id, c.slug AS course_slug, c.name AS course_name
         FROM content_schemas s LEFT JOIN courses c ON c.id = s.course_id WHERE s.user_id = $1 AND s.slug = $2",
    )
    .bind(&user.id)
    .bind(slug)
    .fetch_optional(&app.db)
    .await?
    .ok_or_else(|| ApiError::not_found("Schema"))?;
    let (version_id, version, config): (String, i32, Value) = sqlx::query_as(
        "SELECT id, version, config FROM content_schema_versions WHERE schema_id = $1 ORDER BY is_active DESC, version DESC LIMIT 1",
    )
    .bind(&row.id)
    .fetch_optional(&app.db)
    .await?
    .ok_or_else(|| ApiError::not_found("Schema version"))?;
    let fields: Vec<FieldRow> = sqlx::query_as(
        "SELECT name, label, description, field_type, required, validation_rules, enum_options, example_value, default_value,
           import_instructions, llm_instructions FROM content_schema_fields WHERE version_id = $1 ORDER BY ord",
    )
    .bind(&version_id)
    .fetch_all(&app.db)
    .await?;
    Ok(LoadedSchema { row, version_id, version, config, fields: fields.into_iter().map(FieldRow::def).collect() })
}

fn export(s: &LoadedSchema) -> schema::SchemaExport {
    schema::build_export(
        &s.row.name,
        &s.row.slug,
        &s.row.item_type,
        &s.row.category,
        s.row.description.as_deref(),
        s.version as i64,
        &s.config,
        &s.fields,
    )
}

/// Courses and schemas for the import picker.
pub async fn options(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let courses: Vec<(String, String, String, Option<String>, String)> =
        sqlx::query_as("SELECT id, slug, name, color, tab FROM courses WHERE user_id = $1 ORDER BY tab, name")
            .bind(&user.id)
            .fetch_all(&app.db)
            .await?;
    let schemas: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
        "SELECT s.slug, s.name, s.item_type, c.slug FROM content_schemas s LEFT JOIN courses c ON c.id = s.course_id
         WHERE s.user_id = $1 ORDER BY s.name",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    Ok(Json(json!({
        "courses": courses.into_iter().map(|(id, slug, name, color, _)| json!({ "id": id, "slug": slug, "name": name, "color": color })).collect::<Vec<_>>(),
        "schemas": schemas.into_iter().map(|(slug, name, item_type, course)| json!({ "slug": slug, "name": name, "itemType": item_type, "courseSlug": course })).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBody {
    schema_slug: String,
    /// Raw JSON text (possibly fenced) or an already-parsed value.
    json_text: Option<String>,
    json: Option<Value>,
    #[serde(default)]
    commit: bool,
}

/// Validate pasted/AI-generated JSON; with `commit`, save the valid items.
pub async fn run(State(app): State<App>, user: User, Json(body): Json<ImportBody>) -> ApiResult<Json<Value>> {
    let s = load_schema(&app, &user, &body.schema_slug).await?;
    let parsed = match (body.json, body.json_text) {
        (Some(v), _) if !v.is_null() => v,
        (_, Some(text)) => schema::parse_json_text(&text).map_err(|e| ApiError::bad(format!("Invalid JSON: {e}")))?,
        _ => return Err(ApiError::bad("Paste the JSON to import first.")),
    };
    let items: Vec<Value> = match parsed {
        Value::Array(items) => items,
        other => vec![other],
    };
    if items.len() > 20_000 {
        return Err(ApiError::bad("Import at most 20,000 items at a time."));
    }
    let result = schema::validate_items(&s.fields, &items);
    let mut preview = json!({
        "ok": true, "total": items.len(), "validCount": result.valid.len(), "errorCount": result.invalid.len(),
        "validSample": result.valid.iter().take(10).collect::<Vec<_>>(),
        "errors": result.invalid.iter().take(20).collect::<Vec<_>>(),
    });
    if body.commit && !result.valid.is_empty() {
        let course_id = s.row.course_id.clone().ok_or_else(|| ApiError::bad("This schema is not attached to a course; cannot import."))?;
        let batch_id = new_id();
        let mut tx = app.db.begin().await?;
        sqlx::query(
            "INSERT INTO import_batches (id, course_id, schema_version_id, source_name, format, status, total_count, valid_count, error_count, errors)
             VALUES ($1, $2, $3, 'pasted JSON', 'json', $4, $5, $6, $7, $8)",
        )
        .bind(&batch_id)
        .bind(&course_id)
        .bind(&s.version_id)
        .bind(if result.invalid.is_empty() { "COMPLETED" } else { "PARTIAL" })
        .bind(items.len() as i32)
        .bind(result.valid.len() as i32)
        .bind(result.invalid.len() as i32)
        .bind(serde_json::to_value(&result.invalid).map_err(anyhow::Error::from)?)
        .execute(&mut *tx)
        .await?;
        for chunk in result.valid.chunks(1000) {
            let rows: Vec<Value> = chunk.iter().map(|v| json!({ "id": new_id(), "data": v.data })).collect();
            sqlx::query(
                "INSERT INTO learning_items (id, course_id, schema_id, schema_version_id, item_type, data, import_batch_id)
                 SELECT x->>'id', $1, $2, $3, $4, x->'data', $5 FROM jsonb_array_elements($6::jsonb) x",
            )
            .bind(&course_id)
            .bind(&s.row.id)
            .bind(&s.version_id)
            .bind(&s.row.item_type)
            .bind(&batch_id)
            .bind(Value::Array(rows))
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        preview["batchId"] = json!(batch_id);
        preview["savedCount"] = json!(result.valid.len());
    }
    Ok(Json(preview))
}

pub async fn schemas(State(app): State<App>, user: User) -> ApiResult<Json<Value>> {
    let rows: Vec<(String, String, String, String, Option<String>, Option<i32>, i64, i64)> = sqlx::query_as(
        "SELECT s.slug, s.name, s.item_type, s.category, c.name,
           (SELECT max(v.version) FROM content_schema_versions v WHERE v.schema_id = s.id),
           (SELECT count(*) FROM content_schema_fields f JOIN content_schema_versions v ON v.id = f.version_id
              WHERE v.schema_id = s.id AND v.version = (SELECT max(version) FROM content_schema_versions WHERE schema_id = s.id)),
           (SELECT count(*) FROM learning_items li WHERE li.schema_id = s.id)
         FROM content_schemas s LEFT JOIN courses c ON c.id = s.course_id WHERE s.user_id = $1 ORDER BY s.name",
    )
    .bind(&user.id)
    .fetch_all(&app.db)
    .await?;
    Ok(Json(json!({
        "categories": schema::CATEGORIES,
        "fieldTypes": schema::FIELD_TYPES,
        "schemas": rows.into_iter().map(|(slug, name, item_type, category, course, version, fields, items)| json!({
            "slug": slug, "name": name, "itemType": item_type, "category": category, "courseName": course,
            "version": version.unwrap_or(1), "fieldCount": fields, "itemCount": items,
        })).collect::<Vec<_>>(),
    })))
}

pub async fn schema_detail(State(app): State<App>, user: User, Path(slug): Path<String>) -> ApiResult<Json<Value>> {
    let s = load_schema(&app, &user, &slug).await?;
    let items: i64 = sqlx::query_scalar("SELECT count(*) FROM learning_items WHERE schema_id = $1").bind(&s.row.id).fetch_one(&app.db).await?;
    let doc = export(&s);
    Ok(Json(json!({
        "schema": {
            "slug": s.row.slug, "name": s.row.name, "itemType": s.row.item_type, "category": s.row.category,
            "description": s.row.description, "courseSlug": s.row.course_slug, "courseName": s.row.course_name,
            "version": s.version, "config": s.config, "fields": s.fields, "itemCount": items,
        },
        "export": doc,
        "prompt": schema::build_llm_prompt(&doc),
    })))
}

/// The LLM import prompt as a Markdown download.
pub async fn schema_prompt(State(app): State<App>, user: User, Path(slug): Path<String>) -> ApiResult<Response> {
    let s = load_schema(&app, &user, &slug).await?;
    let markdown = schema::build_llm_prompt(&export(&s));
    let disposition = format!("attachment; filename=\"{}-import-prompt.md\"", s.row.slug);
    Ok(([(header::CONTENT_TYPE, "text/markdown; charset=utf-8".to_string()), (header::CONTENT_DISPOSITION, disposition)], markdown).into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashcardRuleInput {
    name: String,
    front: String,
    back: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSchema {
    name: String,
    item_type: String,
    category: String,
    course_slug: Option<String>,
    new_course_name: Option<String>,
    description: Option<String>,
    target: Option<String>,
    exam_name: Option<String>,
    target_date: Option<String>,
    fields: Vec<FieldDef>,
    #[serde(default)]
    flashcard_rules: Vec<FlashcardRuleInput>,
    #[serde(default)]
    practice_modes: Vec<String>,
    #[serde(default)]
    srs_enabled: bool,
    completion_criteria: Option<String>,
    llm_prompt: Option<String>,
}

fn clean(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// Create a schema (and optionally a new custom course with a goal).
pub async fn create_schema(State(app): State<App>, user: User, Json(body): Json<NewSchema>) -> ApiResult<Json<Value>> {
    let name = body.name.trim();
    let item_type = body.item_type.trim();
    if name.is_empty() || item_type.is_empty() {
        return Err(ApiError::bad("Give the schema a name and an item type."));
    }
    if body.fields.is_empty() {
        return Err(ApiError::bad("Add at least one field."));
    }
    let mut seen = std::collections::HashSet::new();
    for field in &body.fields {
        if field.name.trim().is_empty() || !seen.insert(field.name.trim()) {
            return Err(ApiError::bad("Every field needs a unique name."));
        }
        if !schema::FIELD_TYPES.contains(&field.field_type.as_str()) {
            return Err(ApiError::bad(format!("Unknown field type {}.", field.field_type)));
        }
    }
    let category = if schema::CATEGORIES.contains(&body.category.as_str()) { body.category.clone() } else { "CUSTOM".into() };
    let mut tx = app.db.begin().await?;
    let course_id: Option<String> = match (clean(body.course_slug), clean(body.new_course_name)) {
        (Some(slug), _) => sqlx::query_scalar("SELECT id FROM courses WHERE user_id = $1 AND slug = $2")
            .bind(&user.id)
            .bind(slug)
            .fetch_optional(&mut *tx)
            .await?,
        (None, Some(course_name)) => {
            let slug = slugify(&course_name);
            let target = clean(body.target);
            let exam = clean(body.exam_name);
            let target_date = clean(body.target_date);
            let id: String = sqlx::query_scalar(
                "INSERT INTO courses (id, user_id, slug, name, description, category, tab, metadata) VALUES ($1, $2, $3, $4, $5, $6, 'CUSTOM', $7)
                 ON CONFLICT (user_id, slug) DO UPDATE SET updated_at = now() RETURNING id",
            )
            .bind(new_id())
            .bind(&user.id)
            .bind(&slug)
            .bind(&course_name)
            .bind(target.as_ref().map(|t| format!("Target: {t}")))
            .bind(&category)
            .bind(json!({ "exam": exam, "targetDate": target_date }))
            .fetch_one(&mut *tx)
            .await?;
            if let Some(target) = target {
                let date = target_date
                    .as_deref()
                    .and_then(kaizen_core::time::parse_date_key)
                    .map(|d| kaizen_core::time::start_of_date(d, user.tz));
                sqlx::query("INSERT INTO course_goals (id, course_id, title, goal_type, target_date) VALUES ($1, $2, $3, $4, $5)")
                    .bind(new_id())
                    .bind(&id)
                    .bind(target)
                    .bind(if exam.is_some() { "exam_prep" } else { "custom" })
                    .bind(date)
                    .execute(&mut *tx)
                    .await?;
            }
            Some(id)
        }
        _ => None,
    };
    let base = slugify(item_type);
    let base = if base.is_empty() { slugify(name) } else { base };
    let mut slug = base.clone();
    let mut n = 2;
    while sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM content_schemas WHERE user_id = $1 AND slug = $2)")
        .bind(&user.id)
        .bind(&slug)
        .fetch_one(&mut *tx)
        .await?
    {
        slug = format!("{base}-{n}");
        n += 1;
    }
    let schema_id = new_id();
    sqlx::query("INSERT INTO content_schemas (id, user_id, course_id, slug, name, item_type, category, description) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)")
        .bind(&schema_id)
        .bind(&user.id)
        .bind(&course_id)
        .bind(&slug)
        .bind(name)
        .bind(item_type)
        .bind(&category)
        .bind(clean(body.description))
        .execute(&mut *tx)
        .await?;
    let mut config = json!({
        "flashcardRules": body.flashcard_rules.iter().map(|r| json!({ "name": r.name, "front": r.front, "back": r.back })).collect::<Vec<_>>(),
        "practiceModes": body.practice_modes,
    });
    if body.srs_enabled {
        config["srsRules"] = json!({ "algorithm": "sm2", "newPerDay": 20 });
    }
    if let Some(c) = clean(body.completion_criteria) {
        config["completionCriteria"] = json!(c);
    }
    if let Some(p) = clean(body.llm_prompt) {
        config["llmPrompt"] = json!(p);
    }
    let version_id = new_id();
    sqlx::query("INSERT INTO content_schema_versions (id, schema_id, version, config) VALUES ($1, $2, 1, $3)")
        .bind(&version_id)
        .bind(&schema_id)
        .bind(config)
        .execute(&mut *tx)
        .await?;
    let fields: Vec<FieldDef> = body
        .fields
        .into_iter()
        .map(|mut f| {
            f.name = f.name.trim().to_string();
            if f.label.trim().is_empty() {
                f.label = f.name.clone();
            }
            f
        })
        .collect();
    crate::workspace::insert_fields(&mut tx, &version_id, &fields).await?;
    tx.commit().await?;
    Ok(Json(json!({ "ok": true, "slug": slug })))
}
