-- Kaizen schema. Every user-owned row carries user_id directly or through its
-- parent; ids are text (legacy cuid ids are preserved on import, new ids are
-- UUIDv7 hex).

-- ---------------------------------------------------------------- identity

CREATE TABLE users (
    id          TEXT PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    avatar_url  TEXT,
    timezone    TEXT NOT NULL DEFAULT 'UTC',
    settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
    seeded_at   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE identities (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider       TEXT NOT NULL,
    subject        TEXT NOT NULL,
    email          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, subject)
);
CREATE INDEX identities_user ON identities(user_id);

-- id = sha256(token) hex; the raw token only lives in the cookie.
CREATE TABLE sessions (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_agent    TEXT,
    ip            TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

-- Short-lived OAuth authorization attempts (state → PKCE verifier, nonce).
CREATE TABLE oauth_states (
    state          TEXT PRIMARY KEY,
    provider       TEXT NOT NULL,
    purpose        TEXT NOT NULL DEFAULT 'login',
    user_id        TEXT REFERENCES users(id) ON DELETE CASCADE,
    pkce_verifier  TEXT NOT NULL,
    nonce          TEXT NOT NULL,
    redirect_uri   TEXT NOT NULL,
    return_to      TEXT,
    client_id      TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Encrypted per-user secrets (API keys, ChatGPT plan OAuth tokens).
CREATE TABLE user_secrets (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    nonce       BYTEA NOT NULL,
    ciphertext  BYTEA NOT NULL,
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, kind)
);

-- Instance-wide values (e.g. the stable OAuth host id for this install).
CREATE TABLE app_kv (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------- courses

CREATE TABLE courses (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug         TEXT NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    category     TEXT NOT NULL,
    tab          TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'ACTIVE',
    color        TEXT,
    metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, slug)
);

CREATE TABLE exams (
    id           TEXT PRIMARY KEY,
    course_id    TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    slug         TEXT NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    UNIQUE (course_id, slug)
);

CREATE TABLE exam_levels (
    id           TEXT PRIMARY KEY,
    exam_id      TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    rank         INTEGER NOT NULL,
    description  TEXT,
    targets      JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (exam_id, rank)
);

CREATE TABLE exam_objectives (
    id             TEXT PRIMARY KEY,
    exam_level_id  TEXT NOT NULL REFERENCES exam_levels(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    category       TEXT NOT NULL,
    target_count   INTEGER,
    description    TEXT,
    completed      BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX exam_objectives_level ON exam_objectives(exam_level_id);

CREATE TABLE course_goals (
    id             TEXT PRIMARY KEY,
    course_id      TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    description    TEXT,
    goal_type      TEXT NOT NULL DEFAULT 'custom',
    target_value   INTEGER,
    current_value  INTEGER NOT NULL DEFAULT 0,
    unit           TEXT,
    target_date    TIMESTAMPTZ,
    exam_level_id  TEXT REFERENCES exam_levels(id) ON DELETE SET NULL,
    status         TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX course_goals_course ON course_goals(course_id, status);

CREATE TABLE course_milestones (
    id            TEXT PRIMARY KEY,
    course_id     TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    description   TEXT,
    ord           INTEGER NOT NULL DEFAULT 0,
    metric        TEXT,
    target_value  INTEGER,
    due_date      TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX course_milestones_course ON course_milestones(course_id, ord);

-- ------------------------------------------------------- schemas & content

CREATE TABLE content_schemas (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id    TEXT REFERENCES courses(id) ON DELETE CASCADE,
    slug         TEXT NOT NULL,
    name         TEXT NOT NULL,
    item_type    TEXT NOT NULL,
    category     TEXT NOT NULL DEFAULT 'CUSTOM',
    description  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, slug)
);

CREATE TABLE content_schema_versions (
    id          TEXT PRIMARY KEY,
    schema_id   TEXT NOT NULL REFERENCES content_schemas(id) ON DELETE CASCADE,
    version     INTEGER NOT NULL DEFAULT 1,
    config      JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (schema_id, version)
);

CREATE TABLE content_schema_fields (
    id                   TEXT PRIMARY KEY,
    version_id           TEXT NOT NULL REFERENCES content_schema_versions(id) ON DELETE CASCADE,
    name                 TEXT NOT NULL,
    label                TEXT NOT NULL,
    description          TEXT,
    field_type           TEXT NOT NULL,
    required             BOOLEAN NOT NULL DEFAULT false,
    ord                  INTEGER NOT NULL DEFAULT 0,
    validation_rules     JSONB NOT NULL DEFAULT '{}'::jsonb,
    enum_options         JSONB,
    example_value        JSONB,
    default_value        JSONB,
    import_instructions  TEXT,
    llm_instructions     TEXT,
    UNIQUE (version_id, name)
);
CREATE INDEX content_schema_fields_order ON content_schema_fields(version_id, ord);

CREATE TABLE sources (
    id        TEXT PRIMARY KEY,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name      TEXT NOT NULL,
    type      TEXT NOT NULL,
    url       TEXT,
    metadata  JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE import_batches (
    id                 TEXT PRIMARY KEY,
    course_id          TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    schema_version_id  TEXT REFERENCES content_schema_versions(id) ON DELETE SET NULL,
    source_name        TEXT,
    format             TEXT NOT NULL DEFAULT 'json',
    status             TEXT NOT NULL DEFAULT 'PENDING',
    total_count        INTEGER NOT NULL DEFAULT 0,
    valid_count        INTEGER NOT NULL DEFAULT 0,
    error_count        INTEGER NOT NULL DEFAULT 0,
    errors             JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX import_batches_course ON import_batches(course_id, created_at DESC);

CREATE TABLE roadmaps (
    id           TEXT PRIMARY KEY,
    course_id    TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    slug         TEXT NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (course_id, slug)
);

CREATE TABLE roadmap_nodes (
    id           TEXT PRIMARY KEY,
    roadmap_id   TEXT NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
    slug         TEXT NOT NULL,
    title        TEXT NOT NULL,
    description  TEXT,
    branch       TEXT,
    level        TEXT NOT NULL DEFAULT 'CORE',
    is_target    BOOLEAN NOT NULL DEFAULT false,
    status       TEXT NOT NULL DEFAULT 'NOT_STARTED',
    ord          INTEGER NOT NULL DEFAULT 0,
    metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (roadmap_id, slug)
);

CREATE TABLE roadmap_edges (
    id            TEXT PRIMARY KEY,
    roadmap_id    TEXT NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
    from_node_id  TEXT NOT NULL REFERENCES roadmap_nodes(id) ON DELETE CASCADE,
    to_node_id    TEXT NOT NULL REFERENCES roadmap_nodes(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL DEFAULT 'PREREQUISITE',
    UNIQUE (from_node_id, to_node_id, kind)
);

CREATE TABLE learning_items (
    id                 TEXT PRIMARY KEY,
    course_id          TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    schema_id          TEXT REFERENCES content_schemas(id) ON DELETE SET NULL,
    schema_version_id  TEXT REFERENCES content_schema_versions(id) ON DELETE SET NULL,
    item_type          TEXT NOT NULL,
    data               JSONB NOT NULL,
    roadmap_node_id    TEXT REFERENCES roadmap_nodes(id) ON DELETE SET NULL,
    source_id          TEXT REFERENCES sources(id) ON DELETE SET NULL,
    import_batch_id    TEXT REFERENCES import_batches(id) ON DELETE SET NULL,
    source_key         TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (course_id, item_type, source_key)
);
CREATE INDEX learning_items_course ON learning_items(course_id, item_type);
CREATE INDEX learning_items_schema ON learning_items(schema_id);

CREATE TABLE flashcards (
    id                TEXT PRIMARY KEY,
    course_id         TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    learning_item_id  TEXT REFERENCES learning_items(id) ON DELETE CASCADE,
    book_note_id      TEXT,
    front             TEXT NOT NULL,
    back              TEXT NOT NULL,
    notes             TEXT,
    metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX flashcards_course ON flashcards(course_id);
CREATE INDEX flashcards_item ON flashcards(learning_item_id);

CREATE TABLE practice_items (
    id                TEXT PRIMARY KEY,
    course_id         TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    learning_item_id  TEXT REFERENCES learning_items(id) ON DELETE CASCADE,
    roadmap_node_id   TEXT REFERENCES roadmap_nodes(id) ON DELETE SET NULL,
    type              TEXT NOT NULL,
    prompt            TEXT NOT NULL,
    answer            TEXT NOT NULL,
    metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX practice_items_course ON practice_items(course_id, type);

CREATE TABLE review_records (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    flashcard_id      TEXT UNIQUE REFERENCES flashcards(id) ON DELETE CASCADE,
    practice_item_id  TEXT UNIQUE REFERENCES practice_items(id) ON DELETE CASCADE,
    ease              DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    interval_days     DOUBLE PRECISION NOT NULL DEFAULT 0,
    due_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    repetitions       INTEGER NOT NULL DEFAULT 0,
    lapse_count       INTEGER NOT NULL DEFAULT 0,
    last_rating       TEXT,
    last_reviewed_at  TIMESTAMPTZ,
    maturity          TEXT NOT NULL DEFAULT 'NEW',
    is_leech          BOOLEAN NOT NULL DEFAULT false,
    is_suspended      BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX review_records_due ON review_records(user_id, due_at) WHERE NOT is_suspended;

CREATE TABLE study_sessions (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date          TIMESTAMPTZ NOT NULL DEFAULT now(),
    mode          TEXT NOT NULL DEFAULT 'balanced',
    duration_min  INTEGER,
    stats         JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX study_sessions_user ON study_sessions(user_id, mode, date);

CREATE TABLE attempts (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    flashcard_id      TEXT REFERENCES flashcards(id) ON DELETE CASCADE,
    practice_item_id  TEXT REFERENCES practice_items(id) ON DELETE CASCADE,
    session_id        TEXT REFERENCES study_sessions(id) ON DELETE SET NULL,
    rating            TEXT,
    correct           BOOLEAN,
    answer_given      TEXT,
    time_ms           INTEGER,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX attempts_user ON attempts(user_id, created_at);

CREATE TABLE mistakes (
    id                TEXT PRIMARY KEY,
    course_id         TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    practice_item_id  TEXT REFERENCES practice_items(id) ON DELETE SET NULL,
    description       TEXT NOT NULL,
    category          TEXT,
    count             INTEGER NOT NULL DEFAULT 1,
    resolved          BOOLEAN NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mistakes_course ON mistakes(course_id, resolved);

-- ------------------------------------------------------------------- books

CREATE TABLE books (
    id                 TEXT PRIMARY KEY,
    user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title              TEXT NOT NULL,
    author             TEXT,
    category           TEXT,
    status             TEXT NOT NULL DEFAULT 'WANT_TO_READ',
    start_date         TIMESTAMPTZ,
    finish_date        TIMESTAMPTZ,
    rating             INTEGER,
    page_count         INTEGER,
    source_language    TEXT,
    related_course_id  TEXT REFERENCES courses(id) ON DELETE SET NULL,
    metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX books_user ON books(user_id, status);

CREATE TABLE book_notes (
    id          TEXT PRIMARY KEY,
    book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL DEFAULT 'NOTE',
    content     TEXT NOT NULL,
    location    TEXT,
    remember    BOOLEAN NOT NULL DEFAULT false,
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX book_notes_book ON book_notes(book_id, kind);

CREATE TABLE book_reading_sessions (
    id            TEXT PRIMARY KEY,
    book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    read_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    start_page    INTEGER,
    end_page      INTEGER,
    pages_read    INTEGER NOT NULL,
    duration_min  INTEGER NOT NULL,
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX book_reading_sessions_book ON book_reading_sessions(book_id, read_at);

-- ----------------------------------------------------------------- youtube

CREATE TABLE youtube_playlists (
    id                   TEXT PRIMARY KEY,
    user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    youtube_playlist_id  TEXT NOT NULL,
    source_url           TEXT NOT NULL,
    title                TEXT NOT NULL,
    description          TEXT,
    channel_title        TEXT,
    thumbnail_url        TEXT,
    custom_image_url     TEXT,
    image_prompt         TEXT,
    current_video_id     TEXT,
    current_position     INTEGER NOT NULL DEFAULT 0,
    current_seconds      INTEGER NOT NULL DEFAULT 0,
    status               TEXT NOT NULL DEFAULT 'ACTIVE',
    total_items          INTEGER NOT NULL DEFAULT 0,
    metadata_source      TEXT NOT NULL DEFAULT 'youtube-page',
    last_fetched_at      TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, youtube_playlist_id)
);

CREATE TABLE youtube_playlist_items (
    id                TEXT PRIMARY KEY,
    playlist_id       TEXT NOT NULL REFERENCES youtube_playlists(id) ON DELETE CASCADE,
    youtube_video_id  TEXT NOT NULL,
    position          INTEGER NOT NULL,
    title             TEXT NOT NULL,
    description       TEXT,
    thumbnail_url     TEXT,
    duration_seconds  INTEGER,
    completed         BOOLEAN NOT NULL DEFAULT false,
    watched_seconds   INTEGER NOT NULL DEFAULT 0,
    published_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (playlist_id, position)
);

-- Uploaded files (playlist artwork). Kept in Postgres so app servers stay stateless.
CREATE TABLE blobs (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_type  TEXT NOT NULL,
    data          BYTEA NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------- grammar

CREATE TABLE grammar_progress (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    learning_item_id  TEXT NOT NULL UNIQUE REFERENCES learning_items(id) ON DELETE CASCADE,
    status            TEXT NOT NULL DEFAULT 'NEW',
    curriculum_order  INTEGER NOT NULL DEFAULT 0,
    ease              DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    interval_days     DOUBLE PRECISION NOT NULL DEFAULT 0,
    due_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    repetitions       INTEGER NOT NULL DEFAULT 0,
    lapse_count       INTEGER NOT NULL DEFAULT 0,
    is_leech          BOOLEAN NOT NULL DEFAULT false,
    introduced_at     TIMESTAMPTZ,
    last_studied_at   TIMESTAMPTZ,
    last_rating       TEXT,
    total_correct     INTEGER NOT NULL DEFAULT 0,
    total_questions   INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX grammar_progress_user ON grammar_progress(user_id, status, due_at);

CREATE TABLE grammar_lessons (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scheduled_for     TIMESTAMPTZ NOT NULL DEFAULT now(),
    level_label       TEXT NOT NULL,
    prompt            TEXT NOT NULL,
    grammar_item_ids  JSONB NOT NULL,
    vocabulary        JSONB NOT NULL DEFAULT '[]'::jsonb,
    status            TEXT NOT NULL DEFAULT 'GENERATED',
    response          JSONB,
    completed_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX grammar_lessons_user ON grammar_lessons(user_id, status, scheduled_for);

CREATE TABLE kanji_repair_states (
    id                     TEXT PRIMARY KEY,
    user_id                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kanji                  TEXT NOT NULL,
    last_repaired_at       TIMESTAMPTZ NOT NULL,
    cooldown_until         TIMESTAMPTZ NOT NULL,
    repair_count           INTEGER NOT NULL DEFAULT 1,
    last_repair_score      DOUBLE PRECISION NOT NULL DEFAULT 0,
    performance_at_repair  JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, kanji)
);

-- -------------------------------------------------------------- codeforces

CREATE TABLE codeforces_profiles (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    handle          TEXT NOT NULL,
    profile_url     TEXT NOT NULL,
    display_name    TEXT,
    rating          INTEGER,
    max_rating      INTEGER,
    rank            TEXT,
    max_rank        TEXT,
    avatar_url      TEXT,
    contribution    INTEGER,
    last_synced_at  TIMESTAMPTZ,
    sync_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, handle)
);

CREATE TABLE codeforces_submissions (
    id                     TEXT PRIMARY KEY,
    profile_id             TEXT NOT NULL REFERENCES codeforces_profiles(id) ON DELETE CASCADE,
    codeforces_id          BIGINT NOT NULL,
    contest_id             INTEGER,
    problem_index          TEXT NOT NULL,
    problem_name           TEXT NOT NULL,
    problem_rating         INTEGER,
    problem_tags           JSONB NOT NULL DEFAULT '[]'::jsonb,
    verdict                TEXT,
    participant_type       TEXT,
    programming_language   TEXT,
    submitted_at           TIMESTAMPTZ NOT NULL,
    time_consumed_millis   INTEGER,
    memory_consumed_bytes  BIGINT,
    UNIQUE (profile_id, codeforces_id)
);
CREATE INDEX codeforces_submissions_profile ON codeforces_submissions(profile_id, submitted_at);

CREATE TABLE codeforces_rating_changes (
    id            TEXT PRIMARY KEY,
    profile_id    TEXT NOT NULL REFERENCES codeforces_profiles(id) ON DELETE CASCADE,
    contest_id    INTEGER NOT NULL,
    contest_name  TEXT NOT NULL,
    contest_rank  INTEGER NOT NULL,
    old_rating    INTEGER NOT NULL,
    new_rating    INTEGER NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL,
    UNIQUE (profile_id, contest_id)
);

-- ----------------------------------------------------------- speed reading

CREATE TABLE speed_reading_passages (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    topic        TEXT NOT NULL,
    category     TEXT NOT NULL,
    difficulty   TEXT NOT NULL,
    source_url   TEXT,
    text         TEXT NOT NULL,
    word_count   INTEGER NOT NULL,
    questions    JSONB NOT NULL,
    answer_key   JSONB NOT NULL,
    source       TEXT NOT NULL DEFAULT 'llm',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX speed_reading_passages_user ON speed_reading_passages(user_id, created_at DESC);

CREATE TABLE speed_reading_sessions (
    id                      TEXT PRIMARY KEY,
    user_id                 TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    passage_id              TEXT NOT NULL REFERENCES speed_reading_passages(id) ON DELETE CASCADE,
    mode                    TEXT NOT NULL,
    wpm                     INTEGER NOT NULL,
    chunk_size              INTEGER NOT NULL,
    font_size               INTEGER NOT NULL,
    punctuation_pause       BOOLEAN NOT NULL DEFAULT true,
    started_at              TIMESTAMPTZ NOT NULL,
    completed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_sec            INTEGER NOT NULL,
    correct_answers         INTEGER NOT NULL,
    total_questions         INTEGER NOT NULL,
    accuracy                DOUBLE PRECISION NOT NULL,
    response_time_ms        INTEGER NOT NULL,
    estimated_retention     DOUBLE PRECISION NOT NULL,
    recommended_next_wpm    INTEGER NOT NULL,
    answers                 JSONB NOT NULL,
    retention_due_at        TIMESTAMPTZ,
    retention_completed_at  TIMESTAMPTZ,
    retention_accuracy      DOUBLE PRECISION,
    retention_answers       JSONB
);
CREATE INDEX speed_reading_sessions_user ON speed_reading_sessions(user_id, completed_at);

-- ---------------------------------------------------------------- mandarin

-- Global catalog (the same 88 levels for everyone).
CREATE TABLE mandarin_blueprint_levels (
    level                         INTEGER PRIMARY KEY,
    phase                         INTEGER,
    reported_new_character_count  INTEGER NOT NULL,
    reported_total_characters     INTEGER NOT NULL,
    reported_new_word_count       INTEGER NOT NULL,
    reported_total_words          INTEGER NOT NULL,
    characters                    JSONB NOT NULL DEFAULT '[]'::jsonb,
    words                         JSONB NOT NULL DEFAULT '[]'::jsonb,
    source_stats                  JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mandarin_blueprint_progress (
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    level         INTEGER NOT NULL REFERENCES mandarin_blueprint_levels(level) ON DELETE CASCADE,
    completed_at  TIMESTAMPTZ,
    pushed_at     TIMESTAMPTZ,
    push_error    TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, level)
);

-- Global dictionary cache.
CREATE TABLE mandarin_dictionary_entries (
    id           TEXT PRIMARY KEY,
    surface      TEXT NOT NULL,
    kind         TEXT NOT NULL,
    traditional  TEXT,
    pinyin       JSONB NOT NULL DEFAULT '[]'::jsonb,
    definitions  JSONB NOT NULL DEFAULT '[]'::jsonb,
    audio_urls   JSONB NOT NULL DEFAULT '[]'::jsonb,
    source_url   TEXT NOT NULL,
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (surface, kind)
);

-- -------------------------------------------------------------------- anki

CREATE TABLE anki_deck_mappings (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    deck_name           TEXT NOT NULL,
    course_id           TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    schema_id           TEXT REFERENCES content_schemas(id) ON DELETE SET NULL,
    counts_known_words  BOOLEAN NOT NULL DEFAULT true,
    adaptive_new_cards  BOOLEAN NOT NULL DEFAULT false,
    last_synced_at      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, deck_name)
);
CREATE INDEX anki_deck_mappings_course ON anki_deck_mappings(course_id);

CREATE TABLE anki_card_snapshots (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mapping_id     TEXT NOT NULL REFERENCES anki_deck_mappings(id) ON DELETE CASCADE,
    anki_card_id   BIGINT NOT NULL,
    front          TEXT NOT NULL,
    back           TEXT NOT NULL,
    state          TEXT NOT NULL,
    interval_days  INTEGER NOT NULL DEFAULT 0,
    ease           DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    due_at         TIMESTAMPTZ,
    reps           INTEGER NOT NULL DEFAULT 0,
    lapses         INTEGER NOT NULL DEFAULT 0,
    is_leech       BOOLEAN NOT NULL DEFAULT false,
    synced_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, anki_card_id)
);
CREATE INDEX anki_card_snapshots_mapping ON anki_card_snapshots(mapping_id, state);
CREATE INDEX anki_card_snapshots_due ON anki_card_snapshots(user_id, due_at);

CREATE TABLE anki_review_logs (
    id                    TEXT PRIMARY KEY,
    user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mapping_id            TEXT NOT NULL REFERENCES anki_deck_mappings(id) ON DELETE CASCADE,
    anki_review_id        BIGINT NOT NULL,
    anki_card_id          BIGINT NOT NULL,
    reviewed_at           TIMESTAMPTZ NOT NULL,
    rating                INTEGER NOT NULL,
    interval_after_days   INTEGER NOT NULL DEFAULT 0,
    interval_before_days  INTEGER NOT NULL DEFAULT 0,
    time_ms               INTEGER NOT NULL DEFAULT 0,
    review_type           INTEGER,
    UNIQUE (user_id, anki_review_id, anki_card_id)
);
CREATE INDEX anki_review_logs_mapping ON anki_review_logs(mapping_id, reviewed_at);
CREATE INDEX anki_review_logs_user ON anki_review_logs(user_id, reviewed_at);

CREATE TABLE anki_sync_runs (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at    TIMESTAMPTZ,
    status         TEXT NOT NULL DEFAULT 'running',
    decks_synced   INTEGER NOT NULL DEFAULT 0,
    cards_synced   INTEGER NOT NULL DEFAULT 0,
    reviews_added  INTEGER NOT NULL DEFAULT 0,
    error          TEXT
);
CREATE INDEX anki_sync_runs_user ON anki_sync_runs(user_id, started_at DESC);

CREATE TABLE anki_adaptive_budget_states (
    user_id             TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    activated_at        TIMESTAMPTZ NOT NULL,
    current_budget      INTEGER NOT NULL,
    reliable_data_days  INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE anki_adaptive_evidence_days (
    id                       TEXT PRIMARY KEY,
    user_id                  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    anki_day                 TEXT NOT NULL,
    review_observations      INTEGER NOT NULL DEFAULT 0,
    reviewed_card_count      INTEGER NOT NULL DEFAULT 0,
    reviewed_card_ids        JSONB NOT NULL DEFAULT '[]'::jsonb,
    lapsed_card_ids          JSONB NOT NULL DEFAULT '[]'::jsonb,
    review_minutes           DOUBLE PRECISION,
    valid_time_observations  INTEGER NOT NULL DEFAULT 0,
    reviews_due              INTEGER,
    reviews_completed        INTEGER NOT NULL DEFAULT 0,
    completion_rate          DOUBLE PRECISION,
    retention                DOUBLE PRECISION,
    reliable                 BOOLEAN NOT NULL DEFAULT false,
    data_available           BOOLEAN NOT NULL DEFAULT true,
    finalized_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, anki_day)
);

CREATE TABLE anki_adaptive_budget_decisions (
    id                      TEXT PRIMARY KEY,
    user_id                 TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    anki_day                TEXT NOT NULL,
    previous_budget         INTEGER NOT NULL,
    performance_target      INTEGER NOT NULL,
    confidence_ceiling      INTEGER NOT NULL,
    final_budget            INTEGER NOT NULL,
    window_retention        DOUBLE PRECISION,
    retention_adjustment    INTEGER NOT NULL DEFAULT 0,
    median_review_minutes   DOUBLE PRECISION,
    review_time_adjustment  INTEGER NOT NULL DEFAULT 0,
    repeat_lapse_rate       DOUBLE PRECISION,
    lapse_adjustment        INTEGER NOT NULL DEFAULT 0,
    completion_rate         DOUBLE PRECISION,
    overdue_count           INTEGER NOT NULL DEFAULT 0,
    backlog_ratio           DOUBLE PRECISION,
    reliable_data_days      INTEGER NOT NULL DEFAULT 0,
    reliable_window_days    INTEGER NOT NULL DEFAULT 0,
    due_at_calculation      INTEGER NOT NULL DEFAULT 0,
    reasons                 JSONB NOT NULL DEFAULT '[]'::jsonb,
    allocation              JSONB NOT NULL DEFAULT '[]'::jsonb,
    apply_status            TEXT NOT NULL DEFAULT 'pending',
    apply_error             TEXT,
    calculated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_apply_at           TIMESTAMPTZ,
    UNIQUE (user_id, anki_day)
);

CREATE TABLE anki_adaptive_deck_states (
    id                   TEXT PRIMARY KEY,
    mapping_id           TEXT NOT NULL UNIQUE REFERENCES anki_deck_mappings(id) ON DELETE CASCADE,
    original_config_id   TEXT NOT NULL,
    managed_config_id    TEXT NOT NULL,
    managed_config_name  TEXT NOT NULL,
    last_applied_budget  INTEGER,
    last_applied_at      TIMESTAMPTZ,
    restore_pending      BOOLEAN NOT NULL DEFAULT false,
    last_error           TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------- known words

CREATE TABLE known_words (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    language       TEXT NOT NULL,
    surface        TEXT NOT NULL,
    lemma          TEXT NOT NULL,
    reading        TEXT,
    strict_key     TEXT NOT NULL,
    loose_key      TEXT NOT NULL,
    source         TEXT NOT NULL,
    source_detail  TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, language, source, strict_key)
);
CREATE INDEX known_words_loose ON known_words(user_id, language, loose_key);
CREATE INDEX known_words_recent ON known_words(user_id, created_at DESC);

CREATE TABLE known_word_stats (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date          DATE NOT NULL,
    language      TEXT NOT NULL,
    lower_bound   INTEGER NOT NULL,
    upper_bound   INTEGER NOT NULL,
    migaku_count  INTEGER NOT NULL DEFAULT 0,
    anki_count    INTEGER NOT NULL DEFAULT 0,
    manual_count  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, date, language)
);

-- ---------------------------------------------------------------------- ai

CREATE TABLE ai_conversations (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    context_kind  TEXT NOT NULL,
    context_ref   TEXT,
    provider      TEXT NOT NULL,
    model         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_conversations_context ON ai_conversations(user_id, context_kind, context_ref, updated_at DESC);

CREATE TABLE ai_messages (
    id               TEXT PRIMARY KEY,
    conversation_id  TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role             TEXT NOT NULL,
    content          TEXT NOT NULL,
    provider         TEXT,
    model            TEXT,
    duration_ms      INTEGER,
    error            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_messages_conversation ON ai_messages(conversation_id, created_at);
