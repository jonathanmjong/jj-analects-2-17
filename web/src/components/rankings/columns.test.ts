import { describe, expect, it } from "vitest";
import { columns } from "./columns";

/** The id TanStack will actually use for a column def. */
function resolvedId(col: { id?: string; accessorKey?: unknown }): string {
  if (col.id) return col.id;
  const key = typeof col.accessorKey === "string" ? col.accessorKey : "";
  return key.replaceAll(".", "_");
}

describe("rankings table column ids", () => {
  const ids = new Set(columns.map((c) => resolvedId(c as never)));

  it("has no dotted accessorKey without an explicit id", () => {
    for (const col of columns as Array<{ id?: string; accessorKey?: unknown }>) {
      if (typeof col.accessorKey === "string" && col.accessorKey.includes(".")) {
        expect(col.id, `${col.accessorKey} needs an explicit id — TanStack would rewrite it`).toBeTruthy();
      }
    }
  });

  it("exposes the ids the page's default sort and visibility state reference", () => {
    // Keep in sync with the usePageState defaults in RankingsPage.
    for (const referenced of ["overallRank", "industry", "country"]) {
      expect(ids.has(referenced), `column id "${referenced}" is referenced but does not exist`).toBe(true);
    }
  });

  it("gives every column a non-empty, unique id", () => {
    const all = (columns as Array<{ id?: string; accessorKey?: unknown }>).map(resolvedId);
    expect(all.every((id) => id.length > 0)).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });
});
