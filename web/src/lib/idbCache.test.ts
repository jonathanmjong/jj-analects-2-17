import { describe, expect, it } from "vitest";
import { isUniverseCacheFresh } from "./idbCache";

const T = (iso: string) => new Date(iso).getTime();

describe("isUniverseCacheFresh", () => {
  it("keeps a copy fresh until the first 04:30 UTC boundary after caching", () => {
    expect(isUniverseCacheFresh(T("2026-08-12T10:00:00Z"), T("2026-08-12T23:00:00Z"))).toBe(true);
    expect(isUniverseCacheFresh(T("2026-08-12T10:00:00Z"), T("2026-08-13T04:29:59Z"))).toBe(true);
    expect(isUniverseCacheFresh(T("2026-08-12T10:00:00Z"), T("2026-08-13T04:30:00Z"))).toBe(false);
  });

  it("uses the same-day boundary for a copy cached before 04:30 UTC", () => {
    expect(isUniverseCacheFresh(T("2026-08-13T03:00:00Z"), T("2026-08-13T04:00:00Z"))).toBe(true);
    expect(isUniverseCacheFresh(T("2026-08-13T03:00:00Z"), T("2026-08-13T04:31:00Z"))).toBe(false);
  });

  it("a copy cached exactly at the boundary rolls to the next day's boundary", () => {
    expect(isUniverseCacheFresh(T("2026-08-13T04:30:00Z"), T("2026-08-14T04:29:00Z"))).toBe(true);
    expect(isUniverseCacheFresh(T("2026-08-13T04:30:00Z"), T("2026-08-14T04:30:00Z"))).toBe(false);
  });

  it("rejects clock nonsense rather than trusting it", () => {
    expect(isUniverseCacheFresh(Number.NaN, T("2026-08-13T04:00:00Z"))).toBe(false);
    expect(isUniverseCacheFresh(T("2026-08-14T00:00:00Z"), T("2026-08-13T00:00:00Z"))).toBe(false);
  });
});
