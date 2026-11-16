// Kaizen on Cloudflare: this Worker owns studykaizen.com and forwards every
// request (including the Anki relay WebSocket) to ONE container running the
// repository's Docker image (Rust server + built web app). Data lives in an
// external Postgres; the container's disk is throwaway.
//
// One instance on purpose: the Anki browser relay keeps per-user WebSocket
// state in the server process, so every request must reach the same server.

import { DurableObject } from "cloudflare:workers";

const PORT = 8080;
// Sleep after 20 idle minutes (no requests, no open WebSocket) to save cost.
// The next visitor waits a few seconds while it starts again.
const INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000;
const CANONICAL_HOST = "studykaizen.com";

interface Env {
  KAIZEN: DurableObjectNamespace<KaizenContainer>;
  // Plain vars (wrangler.jsonc)
  KAIZEN_PUBLIC_URL: string;
  KAIZEN_OPEN_SIGNUP: string;
  KAIZEN_EMAIL_FROM: string;
  KAIZEN_STUDENT_AI_MODEL: string;
  KAIZEN_STUDENT_AI_MONTHLY_USD: string;
  // Secrets (`npx wrangler secret put NAME`)
  DATABASE_URL: string;
  KAIZEN_SECRET_KEY: string;
  KAIZEN_OWNER_EMAIL: string;
  AUTH_GOOGLE_CLIENT_ID: string;
  AUTH_GOOGLE_CLIENT_SECRET: string;
  ANTHROPIC_API_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_EMAIL_API_TOKEN?: string;
  YOUTUBE_API_KEY?: string;
}

/** Only these reach the container; nothing else from the Worker env leaks in. */
function containerEnv(env: Env): Record<string, string> {
  const pass: Record<string, string | undefined> = {
    PORT: String(PORT),
    KAIZEN_LOG_FORMAT: "json",
    ANKI_TRANSPORT: "relay",
    KAIZEN_PUBLIC_URL: env.KAIZEN_PUBLIC_URL,
    KAIZEN_OPEN_SIGNUP: env.KAIZEN_OPEN_SIGNUP,
    KAIZEN_EMAIL_FROM: env.KAIZEN_EMAIL_FROM,
    KAIZEN_STUDENT_AI_MODEL: env.KAIZEN_STUDENT_AI_MODEL,
    KAIZEN_STUDENT_AI_MONTHLY_USD: env.KAIZEN_STUDENT_AI_MONTHLY_USD,
    DATABASE_URL: env.DATABASE_URL,
    KAIZEN_SECRET_KEY: env.KAIZEN_SECRET_KEY,
    KAIZEN_OWNER_EMAIL: env.KAIZEN_OWNER_EMAIL,
    AUTH_GOOGLE_CLIENT_ID: env.AUTH_GOOGLE_CLIENT_ID,
    AUTH_GOOGLE_CLIENT_SECRET: env.AUTH_GOOGLE_CLIENT_SECRET,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_EMAIL_API_TOKEN: env.CLOUDFLARE_EMAIL_API_TOKEN,
    YOUTUBE_API_KEY: env.YOUTUBE_API_KEY,
  };
  return Object.fromEntries(Object.entries(pass).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""));
}

export class KaizenContainer extends DurableObject<Env> {
  private starting: Promise<void> | undefined;
  private monitoring: Promise<void> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = ctx.container;
    if (container?.running) {
      // A restarted Durable Object has no timeout until it sets one again.
      void ctx.blockConcurrencyWhile(() => container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS));
      this.observeExit();
    }
  }

  async fetch(request: Request): Promise<Response> {
    this.starting ??= this.startAndWaitForPort().finally(() => {
      this.starting = undefined;
    });
    try {
      await this.starting;
    } catch (error) {
      console.error("container start failed", error);
      return new Response("Kaizen is starting up. Refresh in a few seconds.", {
        status: 503,
        headers: { "retry-after": "5", "content-type": "text/plain; charset=utf-8" },
      });
    }
    const url = new URL(request.url);
    url.protocol = "http:";
    url.host = "container";
    const forwarded = new Request(url, request);
    forwarded.headers.delete("host");
    // Returned as-is so WebSocket upgrades pass through.
    return this.ctx.container!.getTcpPort(PORT).fetch(forwarded);
  }

  private async startAndWaitForPort(): Promise<void> {
    const container = this.ctx.container!;
    if (!container.running) {
      container.start({
        image: container.images.base,
        // 1/4 vCPU, 1 GiB (the Japanese dictionary needs more than "lite").
        instance: { vcpu: 0.25, memoryMib: 1024, diskMb: 4000 },
        // Postgres, Google sign-in, Anthropic, and Cloudflare email are outside.
        enableInternet: true,
        env: containerEnv(this.env),
      });
    }
    this.observeExit();
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);

    // `running` means start was requested, not that the server is listening.
    const port = container.getTcpPort(PORT);
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        const response = await port.fetch("http://container/readyz", { signal: AbortSignal.timeout(2000) });
        await response.body?.cancel();
        if (response.ok) return;
      } catch {
        // Not listening yet.
      }
      await scheduler.wait(200);
    }
    throw new Error(`Kaizen did not become ready on port ${PORT}`);
  }

  private observeExit(): void {
    if (this.monitoring) return;
    this.monitoring = this.ctx
      .container!.monitor()
      .then(() => console.log("Kaizen container exited"))
      .catch((error: unknown) => console.error("Kaizen container failed:", error))
      .finally(() => {
        this.monitoring = undefined;
      });
    this.ctx.waitUntil(this.monitoring);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // www and any other alias redirect to the one origin OAuth and cookies use.
    if (url.hostname !== CANONICAL_HOST && url.hostname.endsWith(CANONICAL_HOST)) {
      url.hostname = CANONICAL_HOST;
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
    return env.KAIZEN.getByName("kaizen").fetch(request);
  },
} satisfies ExportedHandler<Env>;
