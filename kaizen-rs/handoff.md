# Kaizen — handoff (2026-10-27)

Read this first when picking the work back up. Deeper references:
[README.md](README.md) (run/deploy/AI setup) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (how the pieces fit).

## Where things stand

- `kaizen-rs/` is the **active app**: a Rust server holding all logic and data
  access, plus a SolidJS frontend. The original Next.js/Prisma app at the repo
  root (and its `hyperlearning` database) is legacy, untouched, and only used
  as an import source.
- **Nothing is committed.** `git status`: `?? kaizen-rs/` and `M .claude/launch.json`
  (added run entries). Branch `local-dev`.
- The user is happy with how the features work. **Next phase: UI polish, then
  new features** (see "Next up").

## Run it

```bash
kaizen-rs/bin/dev release     # from the repo root; builds web, serves http://127.0.0.1:8787
```

- Run it in the user's own terminal (servers started from an agent session get
  stopped when the session goes idle — that caused two "crashes").
- `bin/dev api` + `bin/dev web` = API on :8787 + Vite hot reload on :5173.
- Launch configs in `.claude/launch.json`: `kaizen`, `kaizen-api`, `kaizen-web`,
  `kaizen-release`.
- Rebuilding the web app doesn't need a server restart (assets are read from
  `web/dist`); Rust changes do.
- Checks: `cargo test --workspace` (88 tests), `cargo clippy --workspace --all-targets`
  (clean), `cd web && npx vite build`.

## Local data and config

- Database: Postgres `kaizen_rs` on localhost (user `milindc`). Contains the
  full import of the legacy data (courses, roadmap, grammar progress, 6.9k+ Anki
  reviews, known words, playlists, books…).
- **One account** (the old app's email, `r***@gmail.com`) with two sign-ins
  linked: **ChatGPT** and **Google** (Google uses a different email; it was
  merged into this account by moving the identity row).
- `kaizen-rs/.env` (not committed, mode 600) sets: `DATABASE_URL`, `KAIZEN_BIND`,
  `KAIZEN_PUBLIC_URL=http://127.0.0.1:8787`, `KAIZEN_OWNER_EMAIL`, `KAIZEN_WEB_DIR`,
  `AUTH_GOOGLE_CLIENT_ID/SECRET` (from the user's Google Cloud OAuth client,
  redirect `http://127.0.0.1:8787/auth/callback`). Every option is documented
  in `.env.example`.
- Local secret key: `~/.config/kaizen/secret.key` (encrypts stored API keys and
  ChatGPT tokens; don't delete it).
- The user's AI setting: ChatGPT plan (`provider=openai, mode=subscription`,
  model `gpt-6.1-sol`), connected through Sign in with ChatGPT.
- **The live Anki is connected** (AnkiConnect at 127.0.0.1:8765). Syncs write
  snapshots/logs, and the *adaptive new-card budget is enabled*: it rewrites the
  new-cards/day limit of a managed preset on the AnimeDeck deck. Be careful
  when testing Anki features — they touch the real collection.

## Layout (where to change what)

```
crates/kaizen-core/     pure logic, no I/O, unit tests (SRS, Anki analytics, adaptive
                        budget, grammar coach, kanji repair, known words, schemas,
                        roadmap layout, settings parsing, seeds in seed/)
crates/kaizen-server/
  src/routes/*.rs       JSON API — one "view" endpoint per page + small actions;
                        router in routes/mod.rs
  src/ai/               AI gateway: mod.rs (routes, SSE chat, context extras),
                        turns.rs (in-flight replies survive disconnects),
                        chatgpt.rs (ChatGPT plan + OpenAI API), apis.rs (Anthropic,
                        Gemini), cli.rs (claude/codex/agy CLIs)
  src/anki/             AnkiConnect client (mod.rs), sync.rs, adaptive.rs, relay.rs
  src/auth/             sessions, OAuth (Google OIDC, Sign in with ChatGPT)
  src/integrations/     Codeforces, YouTube, Mandarin Blueprint
  src/workspace.rs      seeding for new accounts
  migrations/0001_init.sql   whole schema (add new numbered files for changes)
web/src/
  main.jsx              routes (lazy pages)
  lib/api.js            fetch + SWR cache (useApi, post/put/del, invalidate)
  lib/ai.js             AI panel store: send/attach/stop, connection check
  lib/nav.js            sidebar + command palette entries
  components/ui.jsx     design kit (Page, Card, Stat, Pills, Load, Modal, …)
  components/AiPanel.jsx, Layout.jsx, charts.jsx, RoadmapTree.jsx
  pages/*.jsx           one file per page
  app.css               Tailwind v4 + design tokens (light/dark)
```

Patterns worth reusing:
- A page = `useApi('/x')` + `<Load q={q}>{(d) => …}</Load>` (data lands in a
  reconciled store, so refetches update in place). Mutations: `attempt(() => post(...), 'toast')`.
- "Ask the AI" from any page: `ai.ask({ kind, ref, title, prompt, resume, extras, actions })`.
  Server-side, `context_extras()` in `src/ai/mod.rs` turns a finished reply into
  structured data per `context_kind` (grammar ratings, JSON for imports/passages);
  `actions` turns that into buttons in the panel.
- Content types are **schemas** (fields + validation + flashcard rules); the
  Import page already has "generate items with AI → validate → save".
- Anki writes go through `Anki::new(app, user_id)` (`create_deck`, `create_model`,
  `can_add_notes`, `add_notes`, …) — see `integrations/mandarin.rs::push_level`
  for a full "build notes and push to Anki" example.

## Decisions the user made (keep them)

- Sign-in is **OAuth only**: ChatGPT (recommended — also connects the plan for
  AI) or Google. No dev/password login. "Sign in with Claude" isn't possible
  (Anthropic policy).
- AI: only the **ChatGPT plan** counts as a subscription. Claude/Gemini
  "My subscription" is shown grayed out ("not available"); they work with API
  keys. Switch: `CLI_PLAN_SUBSCRIPTIONS` in `src/ai/mod.rs` and
  `SUBSCRIPTION_PROVIDERS` in `kaizen-core/src/settings.rs`.
- **Ask AI is locked** (message box disabled) until the account's AI route
  resolves; the server also refuses chats before storing anything.
- AI replies keep running if the panel/tab closes; grammar-lesson ratings are
  cached per lesson in localStorage until saved.
- UI preferences: **pill buttons instead of dropdowns** for small option sets;
  the **math roadmap must stay a layered tree diagram with edges** (never a list).

## Known gaps / not verified

- Docker image never built (no Docker on this Mac); `Dockerfile` and
  `docker-compose.yml` are written but untested.
- Gemini API and Anthropic API routes have no keys configured → untested live.
- An in-progress AI reply is lost if the server restarts (kept in memory).
- Hosted mode: the Anki browser relay needs a single server instance (or sticky
  sessions); hosted Sign in with ChatGPT needs a registered `AUTH_OPENAI_CLIENT_ID`.
- Pronunciation page is slow-ish (~0.4 s) because it reads card fields live from Anki.

## Next up (user's goals)

1. **UI polish.** Design tokens live in `web/src/app.css`, components in
   `components/ui.jsx`. Every page was spot-checked (all routes render, light/dark,
   mobile), but nothing has had a careful design pass.
2. **Medical students.** Likely: a "Medicine" course/area with schemas for
   high-yield facts, diseases, drugs, (First Aid / UWorld-style) question
   explanations; seeds go in `kaizen-core/seed` + `workspace.rs` (new accounts)
   and need a migration/backfill for existing accounts. Consider making areas
   (Japanese, Chinese, Math…) optional per user so a med student isn't shown
   language courses.
3. **An Anki tab.** Today `/anki` is a setup page (deck mappings, adaptive budget,
   sync history) and analytics live under `/analytics`. A first-class Anki tab
   could combine decks, due counts, leeches, and card creation.
4. **A languages tab.** Japanese and Chinese are separate course pages
   (`pages/Course.jsx` + language tools). A Languages hub could group them and
   make adding another language (Korean, Spanish…) data-driven.
5. **AI-assisted card creation.** Building blocks exist: schema-guided AI
   generation on the Import page, `context_extras` JSON extraction, and
   `Anki.add_notes`. A flow like "paste notes / lecture text → AI drafts cards →
   review/edit → push to an Anki deck (or Kaizen's own SRS)" fits naturally;
   add a new `context_kind` (e.g. `card-draft`) with JSON extras.
