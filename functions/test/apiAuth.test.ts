import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyIdToken = vi.fn();
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({ verifyIdToken }) }));
vi.mock("../src/lib/firestore.js", () => ({ collections: { rankingsLatest: () => ({}) } }));
vi.mock("../src/lib/logger.js", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("firebase-functions/v2/https", () => ({ onRequest: (a: unknown) => a }));

const { requireSubscriber } = await import("../src/api/http.js");

/** Drives the middleware directly — this is the security boundary, not express's routing. */
async function run(authorization?: string) {
  const headers: Record<string, string> = authorization ? { authorization } : {};
  let status = 200;
  let body: unknown = null;
  let nexted = false;
  const req = { get: (n: string) => headers[n.toLowerCase()] };
  const res = {
    status(c: number) { status = c; return this; },
    json(b: unknown) { body = b; return this; },
  };
  let threw: unknown = null;
  try {
    await requireSubscriber(req as never, res as never, () => { nexted = true; });
  } catch (err) {
    threw = err;
  }
  return { status, body, nexted, threw };
}

describe("rankings export API — subscriber gate", () => {
  // Braced body on purpose: an arrow returning mockClear() hands vitest the mock
  // function itself, which it then treats as a teardown callback and CALLS after
  // each test — invoking the stubbed verifier and surfacing its rejection as an
  // unhandled error attributed to whichever test ran last.
  beforeEach(() => {
    verifyIdToken.mockReset();
  });

  it("rejects a request with no Authorization header, without calling the verifier", async () => {
    const r = await run();
    expect(r.status).toBe(401);
    expect(r.nexted).toBe(false);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("rejects a non-bearer scheme", async () => {
    expect((await run("Basic abc123")).status).toBe(401);
  });

  it("rejects an unverifiable token without echoing why", async () => {
    verifyIdToken.mockImplementation(async () => {
      throw new Error("Firebase ID token has expired at 2026-01-01");
    });
    const r = await run("Bearer bad");
    expect(r.threw, "the gate must never propagate a verifier error").toBeNull();
    expect(r.status).toBe(401);
    expect(r.nexted).toBe(false);
    expect(JSON.stringify(r.body)).not.toContain("expired at");
  });

  it("rejects a verified token that is not subscribed", async () => {
    for (const claims of [{ uid: "u" }, { uid: "u", subscribed: false }, { uid: "u", subscribed: "yes" }]) {
      verifyIdToken.mockResolvedValue(claims);
      const r = await run("Bearer ok");
      expect(r.status, JSON.stringify(claims)).toBe(403);
      expect(r.nexted).toBe(false);
    }
  });

  it("passes a subscribed caller through", async () => {
    verifyIdToken.mockResolvedValue({ uid: "u", subscribed: true });
    const r = await run("Bearer ok");
    expect(r.nexted).toBe(true);
    expect(r.status).toBe(200);
  });

  it("accepts the scheme case-insensitively but requires a token after it", async () => {
    verifyIdToken.mockResolvedValue({ uid: "u", subscribed: true });
    expect((await run("bearer ok")).nexted).toBe(true);
    expect((await run("Bearer")).status).toBe(401);
    expect((await run("Bearer   ")).status).toBe(401);
  });
});
