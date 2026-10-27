# Kaizen

Long-term learning, one day at a time: Japanese and Chinese (with Anki), a math
roadmap, books, speed reading, NATO alphabet, Codeforces, YouTube lecture
series — and an AI tutor that runs on your own Claude, ChatGPT, or Gemini plan.

This is the Rust rewrite of the Next.js app in the parent folder. The server
(all logic and data) is Rust; the UI is SolidJS. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits together.

## Run it locally

Requirements: Rust 1.94+, Node 20.19+, PostgreSQL 14+.

```bash
createdb kaizen_rs
```

```bash
cp .env.example .env    # set DATABASE_URL (and KAIZEN_OWNER_EMAIL)
```

```bash
bin/dev                 # builds the web app, then serves everything on http://127.0.0.1:8787
```

For frontend work, run `bin/dev api` and `bin/dev web` in two terminals and open
http://127.0.0.1:5173 (Vite hot reload, API proxied to :8787).

### Bring over your existing data

```bash
cargo run --release -p kaizen-server -- import-legacy --from postgresql://localhost/hyperlearning --public-dir ../public
```

Everything is copied into the new database (the old one is only read), assigned
to the old app's user email. Set `KAIZEN_OWNER_EMAIL` to that email. Signing in
with Google or ChatGPT under that email lands in the imported account; with a
different email, sign in once and link it under Settings → AI.

The 88-level Mandarin Blueprint catalog is shared by all accounts; load it once:

```bash
cargo run --release -p kaizen-server -- import-mandarin --csv /path/to/MandarinBluePrint.csv
```

## Connect AI

Settings → AI. "Ask AI" stays locked (the message box is disabled) until one of
these is connected:

* **ChatGPT plan** (recommended) — signing in with ChatGPT connects it; or click
  *Connect my ChatGPT plan*. On the owner's machine the Codex CLI
  (`codex login`) also works.
* **API key** for Claude (Anthropic), OpenAI, or Gemini, stored encrypted per user.

Claude Pro/Max and Google AI plans can't be connected for now (the options are
shown but disabled); use an API key for those providers.

Every "Ask AI" in the app — grammar lessons (ratings fill in automatically),
tutor plans, kanji mnemonics, leech study plans, reading passages, content
generation for imports — streams through that route.

## Sign-in

Everything requires signing in, and the only ways in are OAuth:

* **ChatGPT** (recommended): also connects your ChatGPT plan, so the AI tutor
  works with no API key. Works out of the box on localhost; hosted deployments
  need a registered `AUTH_OPENAI_CLIENT_ID`.
* **Google**: create an OAuth client (Web application) and add the redirect URI
  `<KAIZEN_PUBLIC_URL>/auth/callback`; set `AUTH_GOOGLE_CLIENT_ID/SECRET`.

## Deploy

The image contains the server binary and the built web app:

```bash
docker build -t kaizen .
```

```bash
docker compose up --build     # Postgres + Kaizen on http://localhost:8080
```

On a platform (Fly.io, Render, Cloud Run, Railway, …) run the image with:

| variable | value |
|---|---|
| `DATABASE_URL` | managed Postgres URL |
| `KAIZEN_PUBLIC_URL` | `https://your-domain` |
| `KAIZEN_SECRET_KEY` | `openssl rand -base64 32` (keep it stable) |
| `KAIZEN_OWNER_EMAIL` | your email |
| `AUTH_GOOGLE_CLIENT_ID/SECRET` | for Google sign-in |

`PORT` is honored, migrations run at startup, `/healthz` (liveness) and
`/readyz` (database) are available, logs are JSON. Run a single instance (or
sticky sessions) so the Anki browser relay reaches the right server. In the
cloud, Anki is reached through your open browser tab — add the site to
AnkiConnect's `webCorsOriginList`. Subscription CLIs only work on a machine
where you've signed them in; on a hosted server use API keys or Sign in with
ChatGPT.

## Develop

```bash
cargo test -p kaizen-core
```

```bash
cargo clippy --workspace
```
