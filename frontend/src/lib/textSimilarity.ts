/**
 * Normalised Levenshtein similarity (1 = same text after normalisation).
 * Mirrors backend/src/services/reviewDiff.ts so the review-screen events
 * carry the same number the server will compute at confirm time.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

export function textSimilarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x && !y) return 1;
  const d = levenshtein(x, y);
  return Math.round(Math.max(0, 1 - d / Math.max(x.length, y.length, 1)) * 1000) / 1000;
}
