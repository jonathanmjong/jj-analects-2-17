export function exportRowsAsCsv(rows: Array<Record<string, unknown>>, filename: string): void {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => JSON.stringify(row[h] ?? "")).join(",")),
  ].join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv" }), filename);
}

export function exportRowsAsJson(rows: Array<Record<string, unknown>>, filename: string): void {
  downloadBlob(new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }), filename);
}

export async function exportRowsAsXlsx(rows: Array<Record<string, unknown>>, filename: string): Promise<void> {
  const XLSX = await import("xlsx");
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Rankings");
  XLSX.writeFile(workbook, filename);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
