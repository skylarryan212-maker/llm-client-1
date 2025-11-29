type PrimitiveCounts = {
  string: number;
  number: number;
  boolean: number;
  null: number;
  other: number;
};

export interface StructuredStats {
  keyCount: number;
  maxDepth: number;
  arrayLengths: Array<{ path: string; length: number }>;
  primitiveCounts: PrimitiveCounts;
}

export function collectStructuredStats(value: unknown): StructuredStats {
  const primitiveCounts: PrimitiveCounts = {
    string: 0,
    number: 0,
    boolean: 0,
    null: 0,
    other: 0,
  };
  let keyCount = 0;
  let maxDepth = 0;
  const arrays: Array<{ path: string; length: number }> = [];

  function walk(val: unknown, depth: number, path: string) {
    if (depth > maxDepth) maxDepth = depth;
    if (val === null) {
      primitiveCounts.null += 1;
      return;
    }
    const type = typeof val;
    if (type === "string") {
      primitiveCounts.string += 1;
      return;
    }
    if (type === "number") {
      primitiveCounts.number += 1;
      return;
    }
    if (type === "boolean") {
      primitiveCounts.boolean += 1;
      return;
    }
    if (Array.isArray(val)) {
      arrays.push({ path, length: val.length });
      val.slice(0, 50).forEach((item, idx) =>
        walk(item, depth + 1, `${path}[${idx}]`),
      );
      return;
    }
    if (type === "object") {
      const entries = Object.entries(val as Record<string, unknown>);
      keyCount += entries.length;
      entries.slice(0, 100).forEach(([k, v]) =>
        walk(v, depth + 1, path ? `${path}.${k}` : k),
      );
      return;
    }
    primitiveCounts.other += 1;
  }

  walk(value, 0, "");

  const arrayLengths = arrays
    .sort((a, b) => b.length - a.length)
    .slice(0, 5);

  return { keyCount, maxDepth, arrayLengths, primitiveCounts };
}
