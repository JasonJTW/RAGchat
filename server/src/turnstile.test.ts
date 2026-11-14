import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "./app.js";
import { stubSession } from "./stub-auth.js";

// The server checks a 訪客's token at Cloudflare. Behind the Next rewrite
// and cloudflared every request comes from the web container, so the
// caller's IP is not known and none is sent (`remoteip` is optional).

describe("POST /api/trial/verify", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  it("sends Cloudflare the token and secret only, no remote IP", async () => {
    delete process.env.STUB_TURNSTILE;
    process.env.TURNSTILE_SECRET_KEY = "secret-x";
    const bodies: URLSearchParams[] = [];
    const fetch = vi.fn((_: string, init: { body: URLSearchParams }) => {
      bodies.push(init.body);
      return Promise.resolve(Response.json({ success: true }));
    });
    vi.stubGlobal("fetch", fetch);

    const res = await request(app)
      .post("/api/trial/verify")
      .set("Cookie", stubSession(`user_turnstile_${Date.now()}`, "guest"))
      .send({ token: "token-y" });

    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    expect(Object.fromEntries(bodies[0])).toEqual({
      secret: "secret-x",
      response: "token-y",
    });
  });
});
