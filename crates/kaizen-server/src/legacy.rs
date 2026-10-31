//! One-time import from the original single-user Next.js/Prisma database.
//!
//! ```text
//! kaizen import-legacy --from postgresql://…/kaizen [--email you@example.com] [--name You]
//!                      [--timezone America/New_York] [--public-dir ../public] [--replace]
//! ```
//!
//! Every row keeps its id, so links between rows survive unchanged. Prisma
//! stores `DateTime` as UTC in `timestamp without time zone`; those values are
//! read as UTC. The whole import runs in one transaction.

use std::fmt::Write as _;
use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use serde_json::{Map, Value};
use sqlx::postgres::PgPoolOptions;
use sqlx::{PgPool, Postgres, Transaction};

use crate::crypto::new_id;
use crate::state::App;

pub struct Options {
    pub from: String,
    /// Defaults to the legacy app's own user email.
    pub email: Option<String>,
    pub name: Option<String>,
    pub timezone: Option<String>,
    pub public_dir: Option<PathBuf>,
    pub replace: bool,
}

/// A column expression over the legacy row `x` (a jsonb object).
enum Col {
    Text(&'static str),
    Int(&'static str),
    BigInt(&'static str),
    Float(&'static str),
    Bool(&'static str),
    /// jsonb, with a default for NOT NULL columns
    Json(&'static str, &'static str),
    /// nullable jsonb (JSON null → SQL NULL)
    JsonOpt(&'static str),
    /// Prisma DateTime (UTC, no zone)
    Time(&'static str),
    /// literal SQL ($1 = the importing user's id)
    Raw(&'static str),
}

impl Col {
    fn sql(&self) -> String {
        match self {
            Col::Text(k) => format!("x->>'{k}'"),
            Col::Int(k) => format!("(x->>'{k}')::int"),
            Col::BigInt(k) => format!("(x->>'{k}')::bigint"),
            Col::Float(k) => format!("(x->>'{k}')::double precision"),
            Col::Bool(k) => format!("(x->>'{k}')::boolean"),
            Col::Json(k, default) => format!("COALESCE(NULLIF(x->'{k}', 'null'::jsonb), '{default}'::jsonb)"),
            Col::JsonOpt(k) => format!("NULLIF(x->'{k}', 'null'::jsonb)"),
            Col::Time(k) => format!("((x->>'{k}')::timestamp AT TIME ZONE 'UTC')"),
            Col::Raw(sql) => (*sql).to_string(),
        }
    }
}

use Col::*;

struct Table {
    legacy: &'static str,
    target: &'static str,
    columns: &'static [(&'static str, Col)],
    /// Global catalog tables are shared between accounts.
    shared: bool,
    filter: &'static str,
}

const USER: Col = Raw("$1");

static TABLES: &[Table] = &[
    Table { legacy: "Course", target: "courses", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("user_id", USER), ("slug", Text("slug")), ("name", Text("name")), ("description", Text("description")),
        ("category", Text("category")), ("tab", Text("tab")), ("status", Text("status")), ("color", Text("color")),
        ("metadata", Json("metadata", "{}")), ("created_at", Time("createdAt")), ("updated_at", Time("updatedAt")),
    ] },
    Table { legacy: "Exam", target: "exams", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("course_id", Text("courseId")), ("slug", Text("slug")), ("name", Text("name")), ("description", Text("description")),
    ] },
    Table { legacy: "ExamLevel", target: "exam_levels", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("exam_id", Text("examId")), ("name", Text("name")), ("rank", Int("rank")), ("description", Text("description")),
        ("targets", Json("targets", "{}")),
    ] },
    Table { legacy: "ExamObjective", target: "exam_objectives", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("exam_level_id", Text("examLevelId")), ("title", Text("title")), ("category", Text("category")),
        ("target_count", Int("targetCount")), ("description", Text("description")), ("completed", Bool("completed")),
    ] },
    Table { legacy: "CourseGoal", target: "course_goals", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("course_id", Text("courseId")), ("title", Text("title")), ("description", Text("description")),
        ("goal_type", Text("goalType")), ("target_value", Int("targetValue")), ("current_value", Int("currentValue")), ("unit", Text("unit")),
        ("target_date", Time("targetDate")), ("exam_level_id", Text("examLevelId")), ("status", Text("status")),
        ("created_at", Time("createdAt")), ("updated_at", Time("updatedAt")),
    ] },
    Table { legacy: "CourseMilestone", target: "course_milestones", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("course_id", Text("courseId")), ("title", Text("title")), ("description", Text("description")), ("ord", Int("order")),
        ("metric", Text("metric")), ("target_value", Int("targetValue")), ("due_date", Time("dueDate")), ("completed_at", Time("completedAt")),
        ("created_at", Time("createdAt")),
    ] },
    Table { legacy: "ContentSchema", target: "content_schemas", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("user_id", USER), ("course_id", Text("courseId")), ("slug", Text("slug")), ("name", Text("name")),
        ("item_type", Text("itemType")), ("category", Text("category")), ("description", Text("description")),
        ("created_at", Time("createdAt")), ("updated_at", Time("updatedAt")),
    ] },
    Table { legacy: "ContentSchemaVersion", target: "content_schema_versions", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("schema_id", Text("schemaId")), ("version", Int("version")), ("config", Json("config", "{}")),
        ("is_active", Bool("isActive")), ("created_at", Time("createdAt")),
    ] },
    Table { legacy: "ContentSchemaField", target: "content_schema_fields", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("version_id", Text("versionId")), ("name", Text("name")), ("label", Text("label")), ("description", Text("description")),
        ("field_type", Text("fieldType")), ("required", Bool("required")), ("ord", Int("order")), ("validation_rules", Json("validationRules", "{}")),
        ("enum_options", JsonOpt("enumOptions")), ("example_value", JsonOpt("exampleValue")), ("default_value", JsonOpt("defaultValue")),
        ("import_instructions", Text("importInstructions")), ("llm_instructions", Text("llmInstructions")),
    ] },
    Table { legacy: "Source", target: "sources", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("user_id", USER), ("name", Text("name")), ("type", Text("type")), ("url", Text("url")), ("metadata", Json("metadata", "{}")),
    ] },
    Table { legacy: "ImportBatch", target: "import_batches", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("course_id", Text("courseId")), ("schema_version_id", Text("schemaVersionId")), ("source_name", Text("sourceName")),
        ("format", Text("format")), ("status", Text("status")), ("total_count", Int("totalCount")), ("valid_count", Int("validCount")),
        ("error_count", Int("errorCount")), ("errors", Json("errors", "[]")), ("created_at", Time("createdAt")),
    ] },
    Table { legacy: "Roadmap", target: "roadmaps", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("course_id", Text("courseId")), ("slug", Text("slug")), ("name", Text("name")), ("description", Text("description")),
        ("created_at", Time("createdAt")),
    ] },
    Table { legacy: "RoadmapNode", target: "roadmap_nodes", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("roadmap_id", Text("roadmapId")), ("slug", Text("slug")), ("title", Text("title")), ("description", Text("description")),
        ("branch", Text("branch")), ("level", Text("level")), ("is_target", Bool("isTarget")), ("status", Text("status")), ("ord", Int("order")),
        ("metadata", Json("metadata", "{}")),
    ] },
    Table { legacy: "RoadmapEdge", target: "roadmap_edges", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("roadmap_id", Text("roadmapId")), ("from_node_id", Text("fromNodeId")), ("to_node_id", Text("toNodeId")), ("kind", Text("kind")),
    ] },
    Table { legacy: "LearningItem", target: "learning_items", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("course_id", Text("courseId")), ("schema_id", Text("schemaId")), ("schema_version_id", Text("schemaVersionId")),
        ("item_type", Text("itemType")), ("data", Json("data", "{}")), ("roadmap_node_id", Text("roadmapNodeId")), ("source_id", Text("sourceId")),
        ("import_batch_id", Text("importBatchId")), ("source_key", Text("sourceKey")), ("created_at", Time("createdAt")), ("updated_at", Time("updatedAt")),
    ] },
    Table { legacy: "PracticeItem", target: "practice_items", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("course_id", Text("courseId")), ("learning_item_id", Text("learningItemId")), ("roadmap_node_id", Text("roadmapNodeId")),
        ("type", Text("type")), ("prompt", Text("prompt")), ("answer", Text("answer")), ("metadata", Json("metadata", "{}")), ("created_at", Time("createdAt")),
    ] },
    Table { legacy: "Book", target: "books", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("user_id", USER), ("title", Text("title")), ("author", Text("author")), ("category", Text("category")),
        ("status", Text("status")), ("start_date", Time("startDate")), ("finish_date", Time("finishDate")), ("rating", Int("rating")),
        ("page_count", Int("pageCount")), ("source_language", Text("sourceLanguage")), ("related_course_id", Text("relatedCourseId")),
        ("metadata", Json("metadata", "{}")), ("created_at", Time("createdAt")), ("updated_at", Time("updatedAt")),
    ] },
    Table { legacy: "BookNote", target: "book_notes", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("book_id", Text("bookId")), ("kind", Text("kind")), ("content", Text("content")), ("location", Text("location")),
        ("remember", Bool("remember")), ("metadata", Json("metadata", "{}")), ("created_at", Time("createdAt")), ("updated_at", Time("updatedAt")),
    ] },
    Table { legacy: "BookReadingSession", target: "book_reading_sessions", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("book_id", Text("bookId")), ("read_at", Time("readAt")), ("start_page", Int("startPage")), ("end_page", Int("endPage")),
        ("pages_read", Int("pagesRead")), ("duration_min", Int("durationMin")), ("notes", Text("notes")), ("created_at", Time("createdAt")),
    ] },
    Table { legacy: "Flashcard", target: "flashcards", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("course_id", Text("courseId")), ("learning_item_id", Text("learningItemId")), ("book_note_id", Text("bookNoteId")),
        ("front", Text("front")), ("back", Text("back")), ("notes", Text("notes")), ("metadata", Json("metadata", "{}")), ("created_at", Time("createdAt")),
    ] },
    Table { legacy: "ReviewRecord", target: "review_records", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("user_id", USER), ("flashcard_id", Text("flashcardId")), ("practice_item_id", Text("practiceItemId")),
        ("ease", Float("ease")), ("interval_days", Float("intervalDays")), ("due_at", Time("dueAt")), ("repetitions", Int("repetitions")),
        ("lapse_count", Int("lapseCount")), ("last_rating", Text("lastRating")), ("last_reviewed_at", Time("lastReviewedAt")),
        ("maturity", Text("maturity")), ("is_leech", Bool("isLeech")), ("is_suspended", Bool("isSuspended")),
    ] },
    Table { legacy: "StudySession", target: "study_sessions", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("user_id", USER), ("date", Time("date")), ("mode", Text("mode")), ("duration_min", Int("durationMin")),
        ("stats", Json("stats", "{}")),
    ] },
    Table { legacy: "Attempt", target: "attempts", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("user_id", USER), ("flashcard_id", Text("flashcardId")), ("practice_item_id", Text("practiceItemId")),
        ("session_id", Text("sessionId")), ("rating", Text("rating")), ("correct", Bool("correct")), ("answer_given", Text("answerGiven")),
        ("time_ms", Int("timeMs")), ("created_at", Time("createdAt")),
    ] },
    Table { legacy: "Mistake", target: "mistakes", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("course_id", Text("courseId")), ("practice_item_id", Text("practiceItemId")), ("description", Text("description")),
        ("category", Text("category")), ("count", Int("count")), ("resolved", Bool("resolved")), ("created_at", Time("createdAt")),
        ("updated_at", Time("updatedAt")),
    ] },
    Table { legacy: "YouTubePlaylist", target: "youtube_playlists", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("user_id", USER), ("youtube_playlist_id", Text("youtubePlaylistId")), ("source_url", Text("sourceUrl")),
        ("title", Text("title")), ("description", Text("description")), ("channel_title", Text("channelTitle")), ("thumbnail_url", Text("thumbnailUrl")),
        ("custom_image_url", Text("customImageUrl")), ("image_prompt", Text("imagePrompt")), ("current_video_id", Text("currentVideoId")),
        ("current_position", Int("currentPosition")), ("current_seconds", Int("currentSeconds")), ("status", Text("status")),
        ("total_items", Int("totalItems")), ("metadata_source", Text("metadataSource")), ("last_fetched_at", Time("lastFetchedAt")),
        ("created_at", Time("createdAt")), ("updated_at", Time("updatedAt")),
    ] },
    Table { legacy: "YouTubePlaylistItem", target: "youtube_playlist_items", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("playlist_id", Text("playlistId")), ("youtube_video_id", Text("youtubeVideoId")), ("position", Int("position")),
        ("title", Text("title")), ("description", Text("description")), ("thumbnail_url", Text("thumbnailUrl")),
        ("duration_seconds", Int("durationSeconds")), ("completed", Bool("completed")), ("watched_seconds", Int("watchedSeconds")),
        ("published_at", Time("publishedAt")), ("created_at", Time("createdAt")), ("updated_at", Time("updatedAt")),
    ] },
    Table { legacy: "GrammarProgress", target: "grammar_progress", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("user_id", USER), ("learning_item_id", Text("learningItemId")), ("status", Text("status")),
        ("curriculum_order", Int("curriculumOrder")), ("ease", Float("ease")), ("interval_days", Float("intervalDays")), ("due_at", Time("dueAt")),
        ("repetitions", Int("repetitions")), ("lapse_count", Int("lapseCount")), ("is_leech", Bool("isLeech")), ("introduced_at", Time("introducedAt")),
        ("last_studied_at", Time("lastStudiedAt")), ("last_rating", Text("lastRating")), ("total_correct", Int("totalCorrect")),
        ("total_questions", Int("totalQuestions")), ("created_at", Time("createdAt")), ("updated_at", Time("updatedAt")),
    ] },
    Table { legacy: "GrammarLesson", target: "grammar_lessons", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("user_id", USER), ("scheduled_for", Time("scheduledFor")), ("level_label", Text("levelLabel")), ("prompt", Text("prompt")),
        ("grammar_item_ids", Json("grammarItemIds", "[]")), ("vocabulary", Json("vocabulary", "[]")), ("status", Text("status")),
        ("response", JsonOpt("response")), ("completed_at", Time("completedAt")), ("created_at", Time("createdAt")),
    ] },
    Table { legacy: "KanjiRepairState", target: "kanji_repair_states", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("user_id", USER), ("kanji", Text("kanji")), ("last_repaired_at", Time("lastRepairedAt")),
        ("cooldown_until", Time("cooldownUntil")), ("repair_count", Int("repairCount")), ("last_repair_score", Float("lastRepairScore")),
        ("performance_at_repair", Json("performanceAtRepair", "{}")), ("created_at", Time("createdAt")), ("updated_at", Time("updatedAt")),
    ] },
    Table { legacy: "CodeforcesProfile", target: "codeforces_profiles", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("user_id", USER), ("handle", Text("handle")), ("profile_url", Text("profileUrl")), ("display_name", Text("displayName")),
        ("rating", Int("rating")), ("max_rating", Int("maxRating")), ("rank", Text("rank")), ("max_rank", Text("maxRank")),
        ("avatar_url", Text("avatarUrl")), ("contribution", Int("contribution")), ("last_synced_at", Time("lastSyncedAt")),
        ("sync_error", Text("syncError")), ("created_at", Time("createdAt")), ("updated_at", Time("updatedAt")),
    ] },
    Table { legacy: "CodeforcesSubmission", target: "codeforces_submissions", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("profile_id", Text("profileId")), ("codeforces_id", BigInt("codeforcesId")), ("contest_id", Int("contestId")),
        ("problem_index", Text("problemIndex")), ("problem_name", Text("problemName")), ("problem_rating", Int("problemRating")),
        ("problem_tags", Json("problemTags", "[]")), ("verdict", Text("verdict")), ("participant_type", Text("participantType")),
        ("programming_language", Text("programmingLanguage")), ("submitted_at", Time("submittedAt")),
        ("time_consumed_millis", Int("timeConsumedMillis")), ("memory_consumed_bytes", BigInt("memoryConsumedBytes")),
    ] },
    Table { legacy: "CodeforcesRatingChange", target: "codeforces_rating_changes", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("profile_id", Text("profileId")), ("contest_id", Int("contestId")), ("contest_name", Text("contestName")),
        ("contest_rank", Int("contestRank")), ("old_rating", Int("oldRating")), ("new_rating", Int("newRating")), ("updated_at", Time("updatedAt")),
    ] },
    Table { legacy: "SpeedReadingPassage", target: "speed_reading_passages", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("user_id", USER), ("title", Text("title")), ("topic", Text("topic")), ("category", Text("category")),
        ("difficulty", Text("difficulty")), ("source_url", Text("sourceUrl")), ("text", Text("text")), ("word_count", Int("wordCount")),
        ("questions", Json("questions", "[]")), ("answer_key", Json("answerKey", "[]")), ("source", Text("source")), ("created_at", Time("createdAt")),
    ] },
    Table { legacy: "SpeedReadingSession", target: "speed_reading_sessions", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("user_id", USER), ("passage_id", Text("passageId")), ("mode", Text("mode")), ("wpm", Int("wpm")),
        ("chunk_size", Int("chunkSize")), ("font_size", Int("fontSize")), ("punctuation_pause", Bool("punctuationPause")),
        ("started_at", Time("startedAt")), ("completed_at", Time("completedAt")), ("duration_sec", Int("durationSec")),
        ("correct_answers", Int("correctAnswers")), ("total_questions", Int("totalQuestions")), ("accuracy", Float("accuracy")),
        ("response_time_ms", Int("responseTimeMs")), ("estimated_retention", Float("estimatedRetention")),
        ("recommended_next_wpm", Int("recommendedNextWpm")), ("answers", Json("answers", "{}")), ("retention_due_at", Time("retentionDueAt")),
        ("retention_completed_at", Time("retentionCompletedAt")), ("retention_accuracy", Float("retentionAccuracy")),
        ("retention_answers", JsonOpt("retentionAnswers")),
    ] },
    Table { legacy: "MandarinBlueprintLevel", target: "mandarin_blueprint_levels", shared: true, filter: "", columns: &[
        ("level", Int("level")), ("phase", Int("phase")), ("reported_new_character_count", Int("reportedNewCharacterCount")),
        ("reported_total_characters", Int("reportedTotalCharacters")), ("reported_new_word_count", Int("reportedNewWordCount")),
        ("reported_total_words", Int("reportedTotalWords")), ("characters", Json("characters", "[]")), ("words", Json("words", "[]")),
        ("source_stats", Json("sourceStats", "{}")), ("created_at", Time("createdAt")), ("updated_at", Time("updatedAt")),
    ] },
    Table {
        legacy: "MandarinBlueprintLevel",
        target: "mandarin_blueprint_progress",
        shared: false,
        filter: "x->>'completedAt' IS NOT NULL OR x->>'pushedAt' IS NOT NULL OR x->>'pushError' IS NOT NULL",
        columns: &[
            ("user_id", USER), ("level", Int("level")), ("completed_at", Time("completedAt")), ("pushed_at", Time("pushedAt")),
            ("push_error", Text("pushError")), ("updated_at", Time("updatedAt")),
        ],
    },
    Table { legacy: "MandarinDictionaryEntry", target: "mandarin_dictionary_entries", shared: true, filter: "", columns: &[
        ("id", Text("id")), ("surface", Text("surface")), ("kind", Text("kind")), ("traditional", Text("traditional")),
        ("pinyin", Json("pinyin", "[]")), ("definitions", Json("definitions", "[]")), ("audio_urls", Json("audioUrls", "[]")),
        ("source_url", Text("sourceUrl")), ("fetched_at", Time("fetchedAt")),
    ] },
    Table { legacy: "AnkiDeckMapping", target: "anki_deck_mappings", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("user_id", USER), ("deck_name", Text("deckName")), ("course_id", Text("courseId")), ("schema_id", Text("schemaId")),
        ("counts_known_words", Bool("countsKnownWords")), ("adaptive_new_cards", Bool("adaptiveNewCards")),
        ("last_synced_at", Time("lastSyncedAt")), ("created_at", Time("createdAt")),
    ] },
    Table { legacy: "AnkiCardSnapshot", target: "anki_card_snapshots", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("user_id", USER), ("mapping_id", Text("mappingId")), ("anki_card_id", BigInt("ankiCardId")), ("front", Text("front")),
        ("back", Text("back")), ("state", Text("state")), ("interval_days", Int("intervalDays")), ("ease", Float("ease")), ("due_at", Time("dueAt")),
        ("reps", Int("reps")), ("lapses", Int("lapses")), ("is_leech", Bool("isLeech")), ("synced_at", Time("syncedAt")),
    ] },
    Table { legacy: "AnkiReviewLog", target: "anki_review_logs", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("user_id", USER), ("mapping_id", Text("mappingId")), ("anki_review_id", BigInt("ankiReviewId")),
        ("anki_card_id", BigInt("ankiCardId")), ("reviewed_at", Time("reviewedAt")), ("rating", Int("rating")),
        ("interval_after_days", Int("intervalAfterDays")), ("interval_before_days", Int("intervalBeforeDays")), ("time_ms", Int("timeMs")),
        ("review_type", Int("reviewType")),
    ] },
    Table { legacy: "AnkiSyncRun", target: "anki_sync_runs", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("user_id", USER), ("started_at", Time("startedAt")), ("finished_at", Time("finishedAt")), ("status", Text("status")),
        ("decks_synced", Int("decksSynced")), ("cards_synced", Int("cardsSynced")), ("reviews_added", Int("reviewsAdded")), ("error", Text("error")),
    ] },
    Table { legacy: "AnkiAdaptiveBudgetState", target: "anki_adaptive_budget_states", shared: false, filter: "", columns: &[
        ("user_id", USER), ("activated_at", Time("activatedAt")), ("current_budget", Int("currentBudget")),
        ("reliable_data_days", Int("reliableDataDays")), ("created_at", Time("createdAt")), ("updated_at", Time("updatedAt")),
    ] },
    Table { legacy: "AnkiAdaptiveEvidenceDay", target: "anki_adaptive_evidence_days", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("user_id", USER), ("anki_day", Text("ankiDay")), ("review_observations", Int("reviewObservations")),
        ("reviewed_card_count", Int("reviewedCardCount")), ("reviewed_card_ids", Json("reviewedCardIds", "[]")),
        ("lapsed_card_ids", Json("lapsedCardIds", "[]")), ("review_minutes", Float("reviewMinutes")),
        ("valid_time_observations", Int("validTimeObservations")), ("reviews_due", Int("reviewsDue")), ("reviews_completed", Int("reviewsCompleted")),
        ("completion_rate", Float("completionRate")), ("retention", Float("retention")), ("reliable", Bool("reliable")),
        ("data_available", Bool("dataAvailable")), ("finalized_at", Time("finalizedAt")), ("created_at", Time("createdAt")),
        ("updated_at", Time("updatedAt")),
    ] },
    Table { legacy: "AnkiAdaptiveBudgetDecision", target: "anki_adaptive_budget_decisions", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("user_id", USER), ("anki_day", Text("ankiDay")), ("previous_budget", Int("previousBudget")),
        ("performance_target", Int("performanceTarget")), ("confidence_ceiling", Int("confidenceCeiling")), ("final_budget", Int("finalBudget")),
        ("window_retention", Float("windowRetention")), ("retention_adjustment", Int("retentionAdjustment")),
        ("median_review_minutes", Float("medianReviewMinutes")), ("review_time_adjustment", Int("reviewTimeAdjustment")),
        ("repeat_lapse_rate", Float("repeatLapseRate")), ("lapse_adjustment", Int("lapseAdjustment")), ("completion_rate", Float("completionRate")),
        ("overdue_count", Int("overdueCount")), ("backlog_ratio", Float("backlogRatio")), ("reliable_data_days", Int("reliableDataDays")),
        ("reliable_window_days", Int("reliableWindowDays")), ("due_at_calculation", Int("dueAtCalculation")), ("reasons", Json("reasons", "[]")),
        ("allocation", Json("allocation", "[]")), ("apply_status", Text("applyStatus")), ("apply_error", Text("applyError")),
        ("calculated_at", Time("calculatedAt")), ("last_apply_at", Time("lastApplyAt")),
    ] },
    Table { legacy: "AnkiAdaptiveDeckState", target: "anki_adaptive_deck_states", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("mapping_id", Text("mappingId")), ("original_config_id", Text("originalConfigId")),
        ("managed_config_id", Text("managedConfigId")), ("managed_config_name", Text("managedConfigName")),
        ("last_applied_budget", Int("lastAppliedBudget")), ("last_applied_at", Time("lastAppliedAt")), ("restore_pending", Bool("restorePending")),
        ("last_error", Text("lastError")), ("created_at", Time("createdAt")), ("updated_at", Time("updatedAt")),
    ] },
    Table { legacy: "KnownWord", target: "known_words", shared: false, filter: "", columns: &[
        ("id", Text("id")), ("user_id", USER), ("language", Text("language")), ("surface", Text("surface")), ("lemma", Text("lemma")),
        ("reading", Text("reading")), ("strict_key", Text("strictKey")), ("loose_key", Text("looseKey")), ("source", Text("source")),
        ("source_detail", Text("sourceDetail")), ("created_at", Time("createdAt")),
    ] },
];

/// Everything an account owns, for `--replace` (AI conversations, sign-in
/// identities, and secrets are kept).
const WIPE: &[&str] = &[
    "review_records", "attempts", "study_sessions", "anki_adaptive_budget_decisions", "anki_adaptive_evidence_days",
    "anki_adaptive_budget_states", "anki_sync_runs", "anki_card_snapshots", "anki_review_logs", "anki_deck_mappings", "known_words",
    "known_word_stats", "grammar_lessons", "grammar_progress", "kanji_repair_states", "codeforces_profiles", "speed_reading_sessions",
    "speed_reading_passages", "mandarin_blueprint_progress", "youtube_playlists", "blobs", "books", "content_schemas", "sources", "courses",
];

async fn legacy_has(legacy: &PgPool, table: &str) -> Result<bool> {
    let exists: Option<String> = sqlx::query_scalar("SELECT to_regclass($1)::text").bind(format!("\"{table}\"")).fetch_one(legacy).await?;
    Ok(exists.is_some())
}

/// Copy one legacy table in keyset-paged batches. Returns the rows inserted.
async fn copy_table(legacy: &PgPool, tx: &mut Transaction<'_, Postgres>, table: &Table, user_id: &str) -> Result<u64> {
    if !legacy_has(legacy, table.legacy).await? {
        return Ok(0);
    }
    let columns: Vec<&str> = table.columns.iter().map(|(name, _)| *name).collect();
    let exprs: Vec<String> = table.columns.iter().map(|(_, col)| col.sql()).collect();
    let mut insert = format!(
        "INSERT INTO {} ({}) SELECT {} FROM jsonb_array_elements($2::jsonb) x",
        table.target,
        columns.join(", "),
        exprs.join(", ")
    );
    if !table.filter.is_empty() {
        let _ = write!(insert, " WHERE {}", table.filter);
    }
    if table.shared {
        insert.push_str(" ON CONFLICT DO NOTHING");
    }
    let select = format!("SELECT t.id, to_jsonb(t) FROM \"{}\" t WHERE t.id > $1 ORDER BY t.id LIMIT 2000", table.legacy);
    let mut cursor = String::new();
    let mut inserted = 0;
    loop {
        let rows: Vec<(String, Value)> = sqlx::query_as(sqlx::AssertSqlSafe(select.clone())).bind(&cursor).fetch_all(legacy).await?;
        let Some((last, _)) = rows.last() else { break };
        cursor = last.clone();
        let batch = Value::Array(rows.into_iter().map(|(_, row)| row).collect());
        let result = sqlx::query(sqlx::AssertSqlSafe(insert.clone()))
            .bind(user_id)
            .bind(batch)
            .execute(&mut **tx)
            .await
            .with_context(|| format!("importing {} into {}", table.legacy, table.target))?;
        inserted += result.rows_affected();
    }
    Ok(inserted)
}

/// IANA zone of this machine (`/etc/localtime` → `…/zoneinfo/Area/City`).
fn system_timezone() -> Option<String> {
    if let Ok(tz) = std::env::var("TZ")
        && tz.parse::<chrono_tz::Tz>().is_ok()
    {
        return Some(tz);
    }
    let target = std::fs::read_link("/etc/localtime").ok()?;
    let path = target.to_string_lossy();
    let zone = path.split("zoneinfo/").nth(1)?;
    zone.parse::<chrono_tz::Tz>().is_ok().then(|| zone.to_string())
}

pub async fn import(app: &App, options: Options) -> Result<String> {
    let timezone = match options.timezone.clone().or_else(system_timezone) {
        Some(tz) if tz.parse::<chrono_tz::Tz>().is_ok() => tz,
        Some(tz) => bail!("unknown timezone `{tz}` (use an IANA name like America/New_York)"),
        None => "UTC".to_string(),
    };
    let legacy = PgPoolOptions::new().max_connections(2).connect(&options.from).await.context("connecting to the legacy database (--from)")?;
    let legacy_user: Option<(String, String, String, Value)> =
        sqlx::query_as("SELECT id, email, name, settings FROM \"User\" ORDER BY \"createdAt\" LIMIT 1").fetch_optional(&legacy).await?;
    let (legacy_user_id, legacy_email, legacy_name, legacy_settings) =
        legacy_user.unwrap_or_else(|| (new_id(), String::new(), "Learner".to_string(), Value::Object(Map::new())));
    let email = options.email.clone().unwrap_or(legacy_email).trim().to_lowercase();
    if !email.contains('@') {
        bail!("pass --email <account email> (the legacy database has no user email)");
    }

    // Refuse to mix ids with another account's rows.
    let legacy_course_ids: Vec<String> = if legacy_has(&legacy, "Course").await? {
        sqlx::query_scalar("SELECT id FROM \"Course\"").fetch_all(&legacy).await?
    } else {
        vec![]
    };

    let mut tx = app.db.begin().await?;
    let existing: Option<(String, Value)> =
        sqlx::query_as("SELECT id, settings FROM users WHERE email = $1").bind(&email).fetch_optional(&mut *tx).await?;
    let user_id = match &existing {
        Some((id, _)) => {
            let has_data: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM courses WHERE user_id = $1)").bind(id).fetch_one(&mut *tx).await?;
            if has_data && !options.replace {
                bail!("{email} already has a workspace. Re-run with --replace to replace it with the legacy data (AI chats and sign-ins are kept).");
            }
            for table in WIPE {
                sqlx::query(sqlx::AssertSqlSafe(format!("DELETE FROM {table} WHERE user_id = $1"))).bind(id).execute(&mut *tx).await?;
            }
            id.clone()
        }
        None => {
            let taken: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM users WHERE id = $1)").bind(&legacy_user_id).fetch_one(&mut *tx).await?;
            let id = if taken { new_id() } else { legacy_user_id.clone() };
            sqlx::query("INSERT INTO users (id, email, name, timezone, settings) VALUES ($1, $2, $3, $4, $5)")
                .bind(&id)
                .bind(&email)
                .bind(options.name.as_deref().unwrap_or(&legacy_name))
                .bind(&timezone)
                .bind(kaizen_core::settings::default_user_settings())
                .execute(&mut *tx)
                .await?;
            id
        }
    };
    let foreign: i64 = sqlx::query_scalar("SELECT count(*) FROM courses WHERE id = ANY($1) AND user_id <> $2")
        .bind(&legacy_course_ids)
        .bind(&user_id)
        .fetch_one(&mut *tx)
        .await?;
    if foreign > 0 {
        bail!("this legacy database was already imported into a different account");
    }

    // Settings: legacy sections overlay the account's (keeping its AI setup).
    let mut settings = existing.map(|(_, s)| s).filter(Value::is_object).unwrap_or_else(kaizen_core::settings::default_user_settings);
    if let (Some(target), Some(source)) = (settings.as_object_mut(), legacy_settings.as_object()) {
        for (key, value) in source {
            if key != "ai" {
                target.insert(key.clone(), value.clone());
            }
        }
    }
    sqlx::query("UPDATE users SET settings = $2, timezone = CASE WHEN timezone = 'UTC' THEN $3 ELSE timezone END, seeded_at = now(), updated_at = now() WHERE id = $1")
        .bind(&user_id)
        .bind(&settings)
        .bind(&timezone)
        .execute(&mut *tx)
        .await?;

    let mut report = format!("Importing into {email} ({user_id}), timezone {timezone}\n");
    for table in TABLES {
        let n = copy_table(&legacy, &mut tx, table, &user_id).await?;
        if n > 0 {
            let _ = writeln!(report, "  {:<32} {n}", table.target);
        }
    }

    // Daily known-word stats: Prisma stored local midnight as a UTC instant.
    if legacy_has(&legacy, "KnownWordStat").await? {
        let rows: Vec<Value> = sqlx::query_scalar("SELECT to_jsonb(t) FROM \"KnownWordStat\" t").fetch_all(&legacy).await?;
        let n = sqlx::query(
            "INSERT INTO known_word_stats (id, user_id, date, language, lower_bound, upper_bound, migaku_count, anki_count, manual_count)
             SELECT x->>'id', $1, (((x->>'date')::timestamp AT TIME ZONE 'UTC') AT TIME ZONE $3)::date, x->>'language',
               (x->>'lower')::int, (x->>'upper')::int, (x->>'migakuCount')::int, (x->>'ankiCount')::int, (x->>'manualCount')::int
             FROM jsonb_array_elements($2::jsonb) x ON CONFLICT DO NOTHING",
        )
        .bind(&user_id)
        .bind(Value::Array(rows))
        .bind(&timezone)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        let _ = writeln!(report, "  {:<32} {n}", "known_word_stats");
    }

    // Uploaded playlist artwork moves into blobs.
    if let Some(public_dir) = &options.public_dir {
        let uploads: Vec<(String, String)> = sqlx::query_as(
            "SELECT id, custom_image_url FROM youtube_playlists WHERE user_id = $1 AND custom_image_url LIKE '/uploads/%'",
        )
        .bind(&user_id)
        .fetch_all(&mut *tx)
        .await?;
        let mut moved = 0;
        for (playlist_id, url) in uploads {
            let relative = url.trim_start_matches('/');
            if relative.contains("..") {
                continue;
            }
            let Ok(bytes) = std::fs::read(public_dir.join(relative)) else { continue };
            let content_type = match relative.rsplit('.').next().unwrap_or("") {
                "png" => "image/png",
                "webp" => "image/webp",
                "gif" => "image/gif",
                _ => "image/jpeg",
            };
            let blob_id = new_id();
            sqlx::query("INSERT INTO blobs (id, user_id, content_type, data) VALUES ($1, $2, $3, $4)")
                .bind(&blob_id)
                .bind(&user_id)
                .bind(content_type)
                .bind(bytes)
                .execute(&mut *tx)
                .await?;
            sqlx::query("UPDATE youtube_playlists SET custom_image_url = $2 WHERE id = $1")
                .bind(&playlist_id)
                .bind(format!("/api/blobs/{blob_id}"))
                .execute(&mut *tx)
                .await?;
            moved += 1;
        }
        if moved > 0 {
            let _ = writeln!(report, "  {:<32} {moved}", "playlist artwork → blobs");
        }
    }
    tx.commit().await?;
    legacy.close().await;
    report.push_str("Done.");
    Ok(report)
}
