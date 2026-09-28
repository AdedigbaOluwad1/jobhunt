export interface Column {
  header: string;
  key: string;
  width?: number;
}

export function printTable(columns: Column[], rows: Array<Record<string, string>>): void {
  if (rows.length === 0) {
    console.log('(no rows)');
    return;
  }

  const widths = columns.map((col) =>
    Math.max(col.header.length, ...rows.map((row) => (row[col.key] ?? '').length)),
  );

  const formatRow = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i])).join('  ');

  console.log(formatRow(columns.map((c) => c.header)));
  console.log(formatRow(widths.map((w) => '-'.repeat(w))));
  for (const row of rows) {
    console.log(formatRow(columns.map((c) => row[c.key] ?? '')));
  }
}
