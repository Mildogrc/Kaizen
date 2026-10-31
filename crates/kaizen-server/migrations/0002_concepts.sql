-- Concepts: one idea a learner can know or not (eigenvalues, the Krebs cycle).
-- Sources teach a concept at unit level (an episode, a chapter, a page range);
-- Anki cards test it through the tag concept::<subject>::<slug>.

-- Note tags from the last sync, so cards can be matched to concepts.
ALTER TABLE anki_card_snapshots ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX anki_card_snapshots_tags ON anki_card_snapshots USING gin (tags);

CREATE TABLE concepts (
    id               TEXT PRIMARY KEY,
    user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject          TEXT NOT NULL,
    slug             TEXT NOT NULL,
    title            TEXT NOT NULL,
    summary          TEXT,
    -- The roadmap course it belongs to (Linear Algebra for eigenvalues).
    roadmap_node_id  TEXT REFERENCES roadmap_nodes(id) ON DELETE SET NULL,
    -- Starter map it was installed from, if any.
    starter          TEXT,
    ord              INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, subject, slug)
);
CREATE INDEX concepts_user ON concepts(user_id, subject, ord);

CREATE TABLE concept_edges (
    id               TEXT PRIMARY KEY,
    from_concept_id  TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    to_concept_id    TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    kind             TEXT NOT NULL DEFAULT 'PREREQUISITE',
    UNIQUE (from_concept_id, to_concept_id, kind),
    CHECK (from_concept_id <> to_concept_id)
);
CREATE INDEX concept_edges_to ON concept_edges(to_concept_id);

CREATE TABLE concept_sources (
    id                   TEXT PRIMARY KEY,
    concept_id           TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    -- Exactly one target. Videos are keyed by playlist + video id because a
    -- playlist refresh recreates its item rows.
    youtube_playlist_id  TEXT REFERENCES youtube_playlists(id) ON DELETE CASCADE,
    youtube_video_id     TEXT,
    book_id              TEXT REFERENCES books(id) ON DELETE CASCADE,
    url                  TEXT,
    -- The unit as the learner names it: "Episode 14", "§5A", "Problem set 6.1".
    label                TEXT NOT NULL,
    role                 TEXT NOT NULL DEFAULT 'LECTURE' CHECK (role IN ('INTUITION', 'LECTURE', 'RIGOROUS', 'PRACTICE')),
    -- Seconds into a video, or pages of a book.
    range_start          INTEGER,
    range_end            INTEGER,
    status               TEXT NOT NULL DEFAULT 'LINKED' CHECK (status IN ('LINKED', 'SUGGESTED', 'DISMISSED')),
    -- Who proposed a suggested link: 'ai', 'title', 'starter'.
    suggested_by         TEXT,
    -- Hand-tracked progress for problem sets and links (4 of 12).
    progress_done        INTEGER,
    progress_total       INTEGER,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(youtube_playlist_id, book_id, url) = 1),
    CHECK ((youtube_playlist_id IS NULL) = (youtube_video_id IS NULL)),
    CHECK (range_start IS NULL OR range_end IS NULL OR range_end >= range_start)
);
CREATE INDEX concept_sources_concept ON concept_sources(concept_id, status);
CREATE INDEX concept_sources_video ON concept_sources(youtube_playlist_id, youtube_video_id);
CREATE INDEX concept_sources_book ON concept_sources(book_id);
