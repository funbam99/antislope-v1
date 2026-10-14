import type { DiffRow } from "./types.js";

export function lines(source: string): string[] {
  if (!source) return [];
  const result = source.split("\n");
  if (result.at(-1) === "") result.pop();
  return result.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

export function diffRows(baseline: string, candidate: string): DiffRow[] {
  const old = lines(baseline),
    next = lines(candidate);
  if (old.length > 2000 || next.length > 2000) throw new Error("Selected file exceeds 2000 lines");
  const width = next.length + 1;
  const table = new Uint16Array((old.length + 1) * width);
  for (let i = old.length - 1; i >= 0; i--) {
    for (let j = next.length - 1; j >= 0; j--) {
      table[i * width + j] =
        old[i] === next[j]
          ? 1 + table[(i + 1) * width + j + 1]!
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0,
    j = 0;
  while (i < old.length || j < next.length) {
    if (i < old.length && j < next.length && old[i] === next[j]) {
      rows.push({ kind: "context", oldLine: ++i, newLine: ++j, text: old[i - 1]!, pair: null });
    } else if (
      i < old.length &&
      (j === next.length || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)
    ) {
      rows.push({ kind: "delete", oldLine: ++i, newLine: null, text: old[i - 1]!, pair: null });
    } else {
      rows.push({ kind: "add", oldLine: null, newLine: ++j, text: next[j - 1]!, pair: null });
    }
  }
  for (let start = 0; start < rows.length;) {
    if (rows[start]!.kind === "context") {
      start++;
      continue;
    }
    let end = start;
    while (end < rows.length && rows[end]!.kind !== "context") end++;
    const deleted = rows.slice(start, end).filter((r) => r.kind === "delete");
    const added = rows.slice(start, end).filter((r) => r.kind === "add");
    for (let k = 0; k < Math.min(deleted.length, added.length); k++) {
      deleted[k]!.pair = added[k]!.newLine;
      added[k]!.pair = deleted[k]!.oldLine;
    }
    start = end;
  }
  return rows;
}

export function hunks(rows: DiffRow[]): DiffRow[][] {
  const visible = new Set<number>();
  rows.forEach((row, index) => {
    if (row.kind === "context") return;
    visible.add(index);
    for (const direction of [-1, 1]) {
      let context = 0;
      for (let k = index + direction; k >= 0 && k < rows.length && context < 3; k += direction) {
        visible.add(k);
        if (rows[k]!.kind === "context") context++;
      }
    }
  });
  const result: DiffRow[][] = [];
  let last = -2;
  [...visible]
    .sort((a, b) => a - b)
    .forEach((index) => {
      if (index !== last + 1) result.push([]);
      result.at(-1)!.push(rows[index]!);
      last = index;
    });
  return result;
}
