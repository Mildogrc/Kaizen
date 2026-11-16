-- Free AI for verified Augusta University (Medical College of Georgia)
-- students. A student proves they own an @augusta.edu address with a one-time
-- code; their AI requests then run on the instance's Anthropic key, within a
-- monthly spending cap tracked in student_ai_usage.

CREATE TABLE student_verifications (
    user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email         TEXT NOT NULL,
    -- Keyed SHA-256 of the pending code (never the code itself).
    code_hash     TEXT,
    code_expires  TIMESTAMPTZ,
    attempts      INTEGER NOT NULL DEFAULT 0,
    sends_today   INTEGER NOT NULL DEFAULT 0,
    sends_day     DATE,
    last_sent_at  TIMESTAMPTZ,
    verified_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One school address unlocks one Kaizen account.
CREATE UNIQUE INDEX student_verifications_verified_email
    ON student_verifications (lower(email)) WHERE verified_at IS NOT NULL;

-- One row per free AI request. Cost is in millionths of a US dollar; a row is
-- written when the request starts (so parallel requests count toward the
-- rate limit) and updated with the real cost when it ends.
CREATE TABLE student_ai_usage (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model          TEXT NOT NULL,
    input_tokens   BIGINT NOT NULL DEFAULT 0,
    output_tokens  BIGINT NOT NULL DEFAULT 0,
    cost_micros    BIGINT NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX student_ai_usage_user_time ON student_ai_usage (user_id, created_at);
