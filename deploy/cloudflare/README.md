# Deploying Kaizen to studykaizen.com (Cloudflare)

A Cloudflare Worker owns `studykaizen.com` and forwards every request to one
[Cloudflare Container](https://developers.cloudflare.com/containers/) running
the repository's `Dockerfile` (Rust server + built web app). Data lives in
Postgres on [Neon](https://neon.tech); the container's disk is throwaway.

```
browser ──► Worker (studykaizen.com) ──► KaizenContainer (one instance) ──► Neon Postgres
                                                     ├──► Google sign-in, Anthropic API
                                                     └──► Cloudflare Email (verification codes)
```

There is exactly one container on purpose: the Anki browser relay keeps
WebSocket state inside the server process. It sleeps after 20 idle minutes
(the next visit takes a few seconds to wake it).

**Cost:** Workers Paid ($5/month, required for Containers) + container usage
(roughly $0–10/month at this size) + Neon free tier + Anthropic usage for
verified students (capped at $2 per student per month).

## One-time setup

Do these in order. Steps 1–6 happen in web dashboards or need your password.

1. **Docker Desktop** (builds the image): `brew install --cask docker`, then
   open Docker.app once. `docker info` should succeed.
2. **Cloudflare Workers Paid plan:** dashboard → Workers & Pages → Plans.
3. **Neon database:** create a project (Postgres 17, region US East). Copy the
   **direct** connection string (not the "pooled" one), ending in
   `?sslmode=require`.
4. **Google sign-in:** in Google Cloud Console → APIs & Services →
   Credentials, open the existing OAuth client and add:
   - Authorized JavaScript origin: `https://studykaizen.com`
   - Authorized redirect URI: `https://studykaizen.com/auth/callback`

   Then OAuth consent screen → **Publish app** ("In production"). Otherwise
   only listed test users can sign in. Kaizen only asks for `openid email
   profile`, so Google doesn't require a review.
5. **Email for verification codes:** dashboard → Email → Email Sending →
   onboard `studykaizen.com` (Cloudflare adds the SPF/DKIM records). Then
   create an API token (My Profile → API Tokens) with the *Email Sending*
   send permission for this account. Note your account ID (dashboard sidebar).
6. **Anthropic API key** for students' free AI: console.anthropic.com → API
   Keys. Also set a monthly **spend limit** there as a second safety net.
7. **Log Wrangler in:** `cd deploy/cloudflare && npm install && npx wrangler login`.

Then from `deploy/cloudflare/`:

```bash
./copy-data.sh          # copy this Mac's database to Neon (Neon must be empty)
npx wrangler deploy     # builds the image, deploys Worker + container, attaches the domain
./set-secrets.sh        # stores secrets (hidden prompts); triggers a redeploy
```

Open https://studykaizen.com. The first container start after a deploy can
take a few minutes while Cloudflare provisions it.

## Updating

```bash
cd deploy/cloudflare && npx wrangler deploy
```

Migrations run when the container starts. Logs: `npx wrangler tail`, or the
Containers dashboard.

## Anki

Kaizen reaches each user's Anki through their open browser tab. Every user
adds `https://studykaizen.com` to AnkiConnect's `webCorsOriginList`
(Anki → Tools → Add-ons → AnkiConnect → Config).

## Settings (wrangler.jsonc `vars`)

| var | default | meaning |
|---|---|---|
| `KAIZEN_OPEN_SIGNUP` | `1` | anyone with a verified Google account can create an account |
| `KAIZEN_STUDENT_AI_MODEL` | `claude-haiku-5-5` | model for verified students' free AI |
| `KAIZEN_STUDENT_AI_MONTHLY_USD` | `2` | free-AI budget per student per month |
| `KAIZEN_EMAIL_FROM` | `Kaizen <noreply@studykaizen.com>` | sender of verification codes |
