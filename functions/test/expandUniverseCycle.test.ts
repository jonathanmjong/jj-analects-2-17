import { describe, expect, it } from "vitest";

/**
 * Mirrors claimLock's wrap decision in expandUniverse.ts. The real function is
 * a Firestore transaction, so the branch is reproduced here — the point being
 * that a completed pass must START THE NEXT ONE rather than latch forever.
 * It latched in production from 2026-07-24 until 2026-08-16: the universe
 * could only shrink, because cleanupUniverse kept removing companies while
 * nothing could ever be added back.
 */
const PASS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

interface State {
  cursor: number;
  totalTickers: number;
  screenedCount: number;
  qualifiedCount: number;
  status: "in_progress" | "complete";
  cycleCount?: number;
  lastPassCompletedAt?: number;
  lockedUntil?: number;
}

function claim(state: State, now: number): State | null {
  if (state.lockedUntil && state.lockedUntil > now) return null;
  const wrapped = state.cursor >= state.totalTickers;
  if (wrapped && now - (state.lastPassCompletedAt ?? 0) < PASS_COOLDOWN_MS) return null;
  return wrapped
    ? { ...state, cursor: 0, screenedCount: 0, qualifiedCount: 0, cycleCount: (state.cycleCount ?? 0) + 1, status: "in_progress" }
    : state;
}

const finished: State = { cursor: 10432, totalTickers: 10432, screenedCount: 10432, qualifiedCount: 1865, status: "complete" };

describe("expandUniverse cursor recycling", () => {
  it("starts a new pass after a completed one instead of stopping forever", () => {
    const next = claim(finished, Date.now());
    expect(next, "a completed screen must not permanently refuse the lock").not.toBeNull();
    expect(next!.cursor).toBe(0);
    expect(next!.status).toBe("in_progress");
    expect(next!.cycleCount).toBe(1);
  });

  it("resets per-pass counters so they report this pass, not all time", () => {
    const next = claim(finished, Date.now())!;
    expect(next.screenedCount).toBe(0);
    expect(next.qualifiedCount).toBe(0);
  });

  it("keeps counting cycles across repeated wraps", () => {
    let s = finished;
    for (let i = 1; i <= 3; i++) {
      s = claim(s, Date.now())!;
      expect(s.cycleCount).toBe(i);
      s = { ...s, cursor: s.totalTickers }; // simulate the pass finishing again
    }
  });

  it("waits out the cooldown before re-screening, then starts the next pass", () => {
    const now = Date.now();
    // Re-screening back to back cost ~50k EDGAR requests/day and found nothing:
    // cycles 2-7 in production each qualified zero companies.
    const justFinished = { ...finished, lastPassCompletedAt: now - 60_000 };
    expect(claim(justFinished, now), "must not immediately re-screen 10,400 tickers").toBeNull();
    const weekOld = { ...finished, lastPassCompletedAt: now - PASS_COOLDOWN_MS - 1 };
    expect(claim(weekOld, now)).not.toBeNull();
    expect(claim(weekOld, now)!.cursor).toBe(0);
  });

  it("does not let the cooldown stall a pass that is still mid-list", () => {
    const now = Date.now();
    const mid = { ...finished, cursor: 4500, status: "in_progress" as const, lastPassCompletedAt: now - 60_000 };
    expect(claim(mid, now), "cooldown gates new passes only, never an in-flight one").not.toBeNull();
  });

  it("still refuses while another invocation holds a live lock", () => {
    const now = Date.now();
    expect(claim({ ...finished, lockedUntil: now + 60_000 }, now)).toBeNull();
    expect(claim({ ...finished, lockedUntil: now - 1 }, now)).not.toBeNull();
  });

  it("leaves a mid-pass cursor untouched", () => {
    const mid: State = { ...finished, cursor: 4500, status: "in_progress" };
    const next = claim(mid, Date.now())!;
    expect(next.cursor).toBe(4500);
    expect(next.cycleCount).toBeUndefined();
  });
});
