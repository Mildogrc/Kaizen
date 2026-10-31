# Kaizen (Rust rewrite) — architecture

A ground-up rewrite of the original Next.js/Prisma Kaizen app (kept on the
`kaizen-non-rust` branch). Goals:

1. **Everything that can be Rust is Rust**: data access, all domain logic
   (spaced repetition, Anki analytics, adaptive new-card budgets, Kanji Repair
   scoring, Japanese lemmatization and known-word union bounds, grammar coach
   scheduling and prompts, schema validation and card generation, roadmap graph
   layout, YouTube / Codeforces / Chisho / Traverse integrations, AnkiConnect
   sync), auth, and the AI gateway.
2. **The browser UI stays JavaScript** (SolidJS + Vite + Tailwind CSS v4, plain
   JSX): it presents server-computed view models and handles interaction.
3. **Fast**: one view endpoint per page with everything precomputed in Rust,
   batched SQL (`jsonb_array_elements` bulk inserts), an SWR cache in the
   browser, lazy-loaded page chunks, precompressed (brotli/gzip) immutable
   assets, and a ~31 KB (brotli) core bundle.
4. **Cloud-ready**: config from the environment, Postgres as the only state
   (sessions, uploads, AI conversations), migrations at startup, `/healthz` and
   `/readyz`, graceful shutdown, JSON logs, one container image.
5. **OAuth sign-in and an AI gateway** that sends every "ask the AI" through the
   user's own subscription or API key, streaming the reply while the UI shows a
   loading animation.

## Layout

```
./
  Cargo.toml                 workspace (release: LTO, 1 codegen unit, abort on panic)
  crates/kaizen-core/        pure domain logic, no I/O, unit-tested (84 tests)
    seed/                    embedded seed data (schemas, math roadmap, JLPT CSVs, RTK kanji)
  crates/kaizen-server/      axum server, sqlx/Postgres, auth, AI gateway, integrations
    migrations/              SQL migrations, applied at startup
    src/routes/              JSON API, one module per area
    src/ai/                  gateway + providers (CLI subprocesses, HTTP APIs)
    src/anki/                AnkiConnect client, sync, adaptive budgets, browser relay
    src/auth/                sessions, OAuth/OIDC flows
    src/integrations/        Codeforces, YouTube, Mandarin Blueprint (public data)
    src/legacy.rs            one-time import from the original Prisma database
  web/                       SolidJS SPA (built to web/dist, served by the server)
  Dockerfile, docker-compose.yml, .env.example, bin/dev
```

## Request flow

Browser → axum. Static assets come from `web/dist` (precompressed, `immutable`
for hashed files, `index.html` for client routes). The JSON API lives under
`/api`, sign-in under `/auth`. Each page calls one view endpoint (e.g.
`GET /api/japanese/grammar`) that returns a fully computed view model; mutations
are small action endpoints. The SPA keeps view responses in a
stale-while-revalidate cache (instant back/forward navigation, prefetch on nav
hover); after any mutation it revalidates only the views on screen. Data flows
into a Solid store with `reconcile`, so refreshes update the DOM in place.

A CSRF guard rejects cross-site state-changing requests (`Sec-Fetch-Site` /
`Origin` checks) on top of `SameSite=Lax` cookies.

## Multi-tenancy

Every user-owned row carries `user_id` (directly or through its parent), and
every query filters by the signed-in user. New accounts get a seeded workspace
(courses, exams, goals, schemas, math roadmap, JLPT grammar curriculum, starter
reading passage). Global caches: `mandarin_blueprint_levels`,
`mandarin_dictionary_entries`.

Day boundaries (streaks, due today, daily plan) use the user's IANA time zone,
stored on the account and adopted from the browser on first sign-in.

## Auth

OAuth 2.0 authorization code + PKCE, implemented over `reqwest`, with OIDC
ID-token validation against the provider's JWKS. One redirect URI for all
providers: `<KAIZEN_PUBLIC_URL>/auth/callback` (the `state` row identifies the
provider and purpose).

* **Google** — standard OIDC (`AUTH_GOOGLE_CLIENT_ID/SECRET`).
* **ChatGPT (OpenAI)** — "Sign in with ChatGPT". On localhost Kaizen registers
  itself as a dynamic agent client (loopback redirect, no setup); hosted
  deployments use a registered `AUTH_OPENAI_CLIENT_ID`. The same flow with
  `purpose=connect` links a ChatGPT plan to an existing account for AI.
* **Claude** — not possible: Anthropic does not offer sign-in for third-party
  apps and does not allow them to collect claude.ai credentials. Claude is
  available for AI with an Anthropic API key.

Sessions are opaque 256-bit tokens in an `HttpOnly; SameSite=Lax` cookie; only
their SHA-256 is stored. Hosted instances accept the owner
(`KAIZEN_OWNER_EMAIL`), `KAIZEN_ALLOWED_EMAILS`, or anyone with
`KAIZEN_OPEN_SIGNUP=1`. There is no password or development sign-in: every
session starts from Google or ChatGPT OAuth. A ChatGPT sign-in also stores the
plan tokens and, if the user hasn't chosen an AI yet, makes the ChatGPT plan
their AI route.

## AI gateway

`POST /api/ai/chat` → Server-Sent Events:

| event          | data                                                          |
|----------------|---------------------------------------------------------------|
| `conversation` | `{conversationId}`                                            |
| `start`        | `{provider, label, model}` — which route is answering        |
| `status`       | `{status}`: connecting → thinking → writing (or retrying)    |
| `delta`        | `{text}` — streamed reply text                               |
| `done`         | `{messageId, text, durationMs, firstTokenMs, extras}`         |
| `error`        | `{message, code}` (`not_connected`, `usage_limit`, …)        |

The SPA's AI panel shows an animated "orb", the current status and elapsed time
until the first token, then renders Markdown as it streams (raw HTML escaped).
`extras` carries structured results the page can act on: parsed
Again/Good/Perfect ratings for grammar lessons, extracted JSON for schema
imports and reading passages.

Routes (Settings → AI picks provider + "subscription" or "API key"):

| provider | subscription                                                    | API key               |
|----------|-----------------------------------------------------------------|-----------------------|
| OpenAI   | "Sign in with ChatGPT" plan tokens → Responses API; or the official `codex` CLI (owner) | OpenAI Responses API |
| Claude   | disabled for now (`claude` CLI route behind `CLI_PLAN_SUBSCRIPTIONS`) | Anthropic Messages API (`claude-opus-5-5` default) |
| Gemini   | disabled for now (`agy` CLI route behind `CLI_PLAN_SUBSCRIPTIONS`) | Gemini API            |

The settings parser only allows subscription mode for providers in
`SUBSCRIPTION_PROVIDERS` (currently OpenAI) and new accounts default to the
ChatGPT plan. The SPA checks the resolved route before every send: until one
resolves, the AI panel's message box is disabled and points to Settings → AI.

CLIs run as subprocesses in a scratch directory with a scrubbed environment,
tools disabled, one turn, the prompt on stdin, and the user's own settings
files skipped (`--setting-sources ""` cuts Claude's time-to-first-token from
~3 s to ~1 s). They are killed when the browser disconnects or presses Stop.
Machine-level CLI logins and instance API keys belong to the instance owner;
other users bring their own key or ChatGPT plan. Per-user keys and tokens are
encrypted with AES-256-GCM (`KAIZEN_SECRET_KEY`). Conversations persist in
`ai_conversations` / `ai_messages` so a lesson survives reloads.

## Anki

AnkiConnect runs on the learner's computer (`127.0.0.1:8765`). Transports:

* **direct** — the server calls AnkiConnect (Kaizen on the same machine).
* **relay** — hosted Kaizen: the open browser tab holds a WebSocket to
  `/api/anki/relay`; the server sends `{id, action, version, params}`, the tab
  forwards it to AnkiConnect and returns `{id, response}` (or
  `{id, transportError}`). Add the app's origin to AnkiConnect's
  `webCorsOriginList`. Relay connections are per server instance, so hosted
  deployments should run one instance (or use sticky sessions).

Sync snapshots cards and review logs incrementally, refreshes known words from
mature cards, and reconciles the adaptive new-card budget (which writes the
`new/day` limit of a managed options preset on the chosen decks).

## Legacy import

```
kaizen import-legacy --from <old DATABASE_URL> [--email you@example.com]
                     [--timezone America/New_York] [--public-dir ../public] [--replace]
```

Copies every table of the original Prisma database into the new schema in one
transaction, keeping ids, reading Prisma's naive-UTC timestamps as UTC,
converting local-midnight stat dates in the given (or system) time zone, and
moving uploaded playlist artwork into `blobs`. The account defaults to the
legacy user's email. The server refuses to run migrations against a database
that has `_prisma_migrations`, so the original database can't be clobbered.
