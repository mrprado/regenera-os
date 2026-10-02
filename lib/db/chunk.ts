// D1 allows at most 100 bound parameters per statement. Run an IN (...) query over ids in safe slices.
export async function inChunks<T, R>(ids: T[], fn: (slice: T[]) => Promise<R[]>, size = 90): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))));
  return out;
}

/** Split an array into slices (for batched IN lists and inserts). */
export const chunk = <T,>(a: T[], n = 80): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
