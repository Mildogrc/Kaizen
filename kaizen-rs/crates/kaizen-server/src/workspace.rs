//! New accounts get a seeded workspace: courses, exams, goals, milestones,
//! content schemas, the math roadmap, the JLPT grammar curriculum, and a
//! starter speed-reading passage. Batches go through `jsonb_array_elements`
//! so seeding is a handful of round trips.

use anyhow::Context;
use kaizen_core::{jlpt, seed};
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};

use crate::crypto::new_id;
use crate::error::ApiResult;
use crate::state::App;

pub async fn create_user(app: &App, email: &str, name: &str, avatar: Option<&str>) -> ApiResult<String> {
    let id = new_id();
    let mut tx = app.db.begin().await?;
    sqlx::query("INSERT INTO users (id, email, name, avatar_url, settings) VALUES ($1, $2, $3, $4, $5)")
        .bind(&id)
        .bind(email.to_lowercase())
        .bind(name)
        .bind(avatar)
        .bind(kaizen_core::settings::default_user_settings())
        .execute(&mut *tx)
        .await?;
    seed_workspace(&mut tx, &id).await?;
    tx.commit().await?;
    tracing::info!(user = %id, "created account with seeded workspace");
    Ok(id)
}

/// Seed everything a fresh account needs. Idempotent per course slug.
pub async fn seed_workspace(tx: &mut Transaction<'_, Postgres>, user_id: &str) -> anyhow::Result<()> {
    let mut course_ids = std::collections::HashMap::new();
    for course in &seed::COURSES {
        let id: String = sqlx::query_scalar(
            "INSERT INTO courses (id, user_id, slug, name, description, category, tab, color)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (user_id, slug) DO UPDATE SET name = courses.name RETURNING id",
        )
        .bind(new_id())
        .bind(user_id)
        .bind(course.slug)
        .bind(course.name)
        .bind(course.description)
        .bind(course.category)
        .bind(course.tab)
        .bind(course.color)
        .fetch_one(&mut **tx)
        .await?;
        course_ids.insert(course.slug, id);
    }
    let course = |slug: &str| course_ids.get(slug).cloned().context("seed course missing");

    // Exams → levels → objectives.
    for exam in seed::exams() {
        let exam_id: String = sqlx::query_scalar(
            "INSERT INTO exams (id, course_id, slug, name, description) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (course_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id",
        )
        .bind(new_id())
        .bind(course(exam.course)?)
        .bind(exam.slug)
        .bind(exam.name)
        .bind(exam.description)
        .fetch_one(&mut **tx)
        .await?;
        for level in exam.levels {
            let level_id: String = sqlx::query_scalar(
                "INSERT INTO exam_levels (id, exam_id, name, rank, description, targets) VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (exam_id, rank) DO UPDATE SET targets = EXCLUDED.targets RETURNING id",
            )
            .bind(new_id())
            .bind(&exam_id)
            .bind(&level.name)
            .bind(level.rank as i32)
            .bind(level.description)
            .bind(&level.targets)
            .fetch_one(&mut **tx)
            .await?;
            let objectives: Vec<Value> = level
                .objectives
                .iter()
                .map(|(title, category, count)| json!({ "id": new_id(), "title": title, "category": category, "count": count }))
                .collect();
            sqlx::query(
                "INSERT INTO exam_objectives (id, exam_level_id, title, category, target_count)
                 SELECT x->>'id', $1, x->>'title', x->>'category', (x->>'count')::int FROM jsonb_array_elements($2::jsonb) x
                 WHERE NOT EXISTS (SELECT 1 FROM exam_objectives o WHERE o.exam_level_id = $1)",
            )
            .bind(&level_id)
            .bind(Value::Array(objectives))
            .execute(&mut **tx)
            .await?;
        }
    }

    let existing_goals: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM course_goals g JOIN courses c ON c.id = g.course_id WHERE c.user_id = $1",
    )
    .bind(user_id)
    .fetch_one(&mut **tx)
    .await?;
    if existing_goals == 0 {
        for goal in &seed::GOALS {
            sqlx::query(
                "INSERT INTO course_goals (id, course_id, title, description, goal_type, target_value, unit, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            )
            .bind(new_id())
            .bind(course(goal.course)?)
            .bind(goal.title)
            .bind(goal.description)
            .bind(goal.goal_type)
            .bind(goal.target_value.map(|v| v as i32))
            .bind(goal.unit)
            .bind(goal.status)
            .execute(&mut **tx)
            .await?;
        }
        let mut order: std::collections::HashMap<&str, i32> = std::collections::HashMap::new();
        for (slug, title, metric, target) in &seed::MILESTONES {
            let n = order.entry(slug).or_insert(0);
            *n += 1;
            sqlx::query("INSERT INTO course_milestones (id, course_id, title, ord, metric, target_value) VALUES ($1, $2, $3, $4, $5, $6)")
                .bind(new_id())
                .bind(course(slug)?)
                .bind(title)
                .bind(*n)
                .bind(metric)
                .bind(target.map(|v| v as i32))
                .execute(&mut **tx)
                .await?;
        }
    }

    // Content schemas.
    let mut grammar_schema: Option<(String, String)> = None;
    for def in seed::schemas() {
        let course_id = match &def.course_slug {
            Some(slug) => course_ids.get(slug.as_str()).cloned(),
            None => None,
        };
        let inserted: Option<String> = sqlx::query_scalar(
            "INSERT INTO content_schemas (id, user_id, course_id, slug, name, item_type, category, description)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (user_id, slug) DO NOTHING RETURNING id",
        )
        .bind(new_id())
        .bind(user_id)
        .bind(course_id)
        .bind(&def.slug)
        .bind(&def.name)
        .bind(&def.item_type)
        .bind(&def.category)
        .bind(&def.description)
        .fetch_optional(&mut **tx)
        .await?;
        let Some(schema_id) = inserted else { continue };
        let version_id = new_id();
        sqlx::query("INSERT INTO content_schema_versions (id, schema_id, version, config) VALUES ($1, $2, 1, $3)")
            .bind(&version_id)
            .bind(&schema_id)
            .bind(serde_json::to_value(&def.config)?)
            .execute(&mut **tx)
            .await?;
        insert_fields(tx, &version_id, &def.fields).await?;
        if def.slug == "japanese-grammar" {
            grammar_schema = Some((schema_id, version_id));
        }
    }

    // Math roadmap.
    let roadmap = seed::math_roadmap();
    let roadmap_id: Option<String> = sqlx::query_scalar(
        "INSERT INTO roadmaps (id, course_id, slug, name, description) VALUES ($1, $2, 'math-roadmap', 'Mathematics Roadmap', $3)
         ON CONFLICT (course_id, slug) DO NOTHING RETURNING id",
    )
    .bind(new_id())
    .bind(course("math")?)
    .bind("Foundations through advanced fields, with target paths to Iwasawa Theory, QFT, Physics Phenomenology, and Quantitative Finance.")
    .fetch_optional(&mut **tx)
    .await?;
    if let Some(roadmap_id) = roadmap_id {
        let mut node_ids = std::collections::HashMap::new();
        let nodes: Vec<Value> = roadmap
            .nodes
            .iter()
            .enumerate()
            .map(|(i, n)| {
                let id = new_id();
                node_ids.insert(n.slug.clone(), id.clone());
                json!({ "id": id, "slug": n.slug, "title": n.title, "branch": n.branch, "level": n.level, "isTarget": n.is_target, "description": n.description, "ord": i })
            })
            .collect();
        sqlx::query(
            "INSERT INTO roadmap_nodes (id, roadmap_id, slug, title, branch, level, is_target, description, ord)
             SELECT x->>'id', $1, x->>'slug', x->>'title', x->>'branch', x->>'level', (x->>'isTarget')::boolean, x->>'description', (x->>'ord')::int
             FROM jsonb_array_elements($2::jsonb) x",
        )
        .bind(&roadmap_id)
        .bind(Value::Array(nodes))
        .execute(&mut **tx)
        .await?;
        let edges: Vec<Value> = roadmap
            .edges
            .iter()
            .filter_map(|e| Some(json!({ "id": new_id(), "from": node_ids.get(&e.from)?, "to": node_ids.get(&e.to)?, "kind": e.kind })))
            .collect();
        sqlx::query(
            "INSERT INTO roadmap_edges (id, roadmap_id, from_node_id, to_node_id, kind)
             SELECT x->>'id', $1, x->>'from', x->>'to', x->>'kind' FROM jsonb_array_elements($2::jsonb) x
             ON CONFLICT DO NOTHING",
        )
        .bind(&roadmap_id)
        .bind(Value::Array(edges))
        .execute(&mut **tx)
        .await?;
    }

    if let Some((schema_id, version_id)) = grammar_schema {
        seed_jlpt_grammar(tx, user_id, &course("japanese")?, &schema_id, &version_id).await?;
    }

    let has_passage: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM speed_reading_passages WHERE user_id = $1)")
        .bind(user_id)
        .fetch_one(&mut **tx)
        .await?;
    if !has_passage {
        let passage = kaizen_core::speed_reading::validate_passage(&seed::starter_passage()).map_err(anyhow::Error::msg)?;
        insert_passage(tx, user_id, &passage, "built-in").await?;
    }
    sqlx::query("UPDATE users SET seeded_at = now() WHERE id = $1").bind(user_id).execute(&mut **tx).await?;
    Ok(())
}

pub async fn insert_fields(tx: &mut Transaction<'_, Postgres>, version_id: &str, fields: &[kaizen_core::schema::FieldDef]) -> anyhow::Result<()> {
    let rows: Vec<Value> = fields
        .iter()
        .enumerate()
        .map(|(i, f)| {
            json!({
                "id": new_id(), "name": f.name, "label": f.label, "description": f.description, "fieldType": f.field_type,
                "required": f.required, "ord": i, "rules": f.validation_rules, "enum": f.enum_options, "example": f.example_value,
                "default": f.default_value, "import": f.import_instructions, "llm": f.llm_instructions,
            })
        })
        .collect();
    sqlx::query(
        "INSERT INTO content_schema_fields (id, version_id, name, label, description, field_type, required, ord, validation_rules,
           enum_options, example_value, default_value, import_instructions, llm_instructions)
         SELECT x->>'id', $1, x->>'name', x->>'label', x->>'description', x->>'fieldType', (x->>'required')::boolean, (x->>'ord')::int,
           COALESCE(x->'rules', '{}'::jsonb), NULLIF(x->'enum', 'null'::jsonb), NULLIF(x->'example', 'null'::jsonb),
           NULLIF(x->'default', 'null'::jsonb), x->>'import', x->>'llm'
         FROM jsonb_array_elements($2::jsonb) x",
    )
    .bind(version_id)
    .bind(Value::Array(rows))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn seed_jlpt_grammar(tx: &mut Transaction<'_, Postgres>, user_id: &str, course_id: &str, schema_id: &str, version_id: &str) -> anyhow::Result<()> {
    let source_id = new_id();
    sqlx::query("INSERT INTO sources (id, user_id, name, type, metadata) VALUES ($1, $2, 'JLPT Grammar CSV curriculum', 'spreadsheet', $3)")
        .bind(&source_id)
        .bind(user_id)
        .bind(json!({ "levels": jlpt::LEVELS, "newGrammarPerWeek": 5, "sourceProgressIgnored": true }))
        .execute(&mut **tx)
        .await?;
    let mut items = Vec::new();
    let mut order = 0;
    for level in jlpt::LEVELS {
        for row in jlpt::parse_grammar_csv(seed::jlpt_csv(level), level).map_err(anyhow::Error::msg)? {
            items.push(json!({
                "id": new_id(), "progressId": new_id(), "data": jlpt::grammar_item_data(&row),
                "sourceKey": jlpt::grammar_source_key(&row), "order": order,
            }));
            order += 1;
        }
    }
    let items = Value::Array(items);
    sqlx::query(
        "INSERT INTO learning_items (id, course_id, schema_id, schema_version_id, item_type, data, source_id, source_key)
         SELECT x->>'id', $1, $2, $3, 'JapaneseGrammarPoint', x->'data', $4, x->>'sourceKey' FROM jsonb_array_elements($5::jsonb) x
         ON CONFLICT (course_id, item_type, source_key) DO NOTHING",
    )
    .bind(course_id)
    .bind(schema_id)
    .bind(version_id)
    .bind(&source_id)
    .bind(&items)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "INSERT INTO grammar_progress (id, user_id, learning_item_id, curriculum_order)
         SELECT x->>'progressId', $1, li.id, (x->>'order')::int FROM jsonb_array_elements($2::jsonb) x
         JOIN learning_items li ON li.course_id = $3 AND li.item_type = 'JapaneseGrammarPoint' AND li.source_key = x->>'sourceKey'
         ON CONFLICT (learning_item_id) DO NOTHING",
    )
    .bind(user_id)
    .bind(&items)
    .bind(course_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn insert_passage(
    tx: &mut Transaction<'_, Postgres>,
    user_id: &str,
    passage: &kaizen_core::speed_reading::PassageInput,
    source: &str,
) -> anyhow::Result<String> {
    let id = new_id();
    sqlx::query(
        "INSERT INTO speed_reading_passages (id, user_id, title, topic, category, difficulty, source_url, text, word_count, questions, answer_key, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    )
    .bind(&id)
    .bind(user_id)
    .bind(&passage.title)
    .bind(&passage.topic)
    .bind(&passage.category)
    .bind(&passage.difficulty)
    .bind(&passage.source_url)
    .bind(&passage.text)
    .bind(kaizen_core::speed_reading::tokenize_passage(&passage.text).len() as i32)
    .bind(serde_json::to_value(&passage.questions)?)
    .bind(serde_json::to_value(&passage.answer_key)?)
    .bind(source)
    .execute(&mut **tx)
    .await?;
    Ok(id)
}
