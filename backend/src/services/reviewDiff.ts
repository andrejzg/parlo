/**
 * What did the creator change on the review screen?
 *
 * Compares the questions the model generated with the set the creator
 * confirmed, pairing them by text similarity (normalised Levenshtein ratio)
 * so a reworded question still matches its origin. The result is stored on
 * the survey, logged as a creation event and sent to PostHog as
 * `review_confirmed`, which makes "edit rate" the calibration metric for
 * question generation.
 */

export interface QuestionLike {
  text: string;
  type?: string | null;
}

export type DiffStatus = "kept" | "reworded" | "added" | "deleted";

export interface ReviewDiffItem {
  status: DiffStatus;
  generatedIndex: number | null;
  finalIndex: number | null;
  similarity: number;
  generatedText?: string;
  finalText?: string;
  typeChanged: boolean;
}

export interface ReviewDiff {
  generated: number;
  final: number;
  kept: number;
  reworded: number;
  added: number;
  deleted: number;
  /** Matched questions whose relative order changed. */
  moved: number;
  /** Share of generated questions that survived with their text unchanged. */
  keptRatio: number;
  /** Share of generated questions that survived in any form (kept or reworded). */
  survivedRatio: number;
  /** Share of generated questions kept unchanged AND in the same slot. */
  untouchedRatio: number;
  meanSimilarity: number;
  items: ReviewDiffItem[];
}

/** Pairs below this similarity are treated as different questions. */
const MATCH_THRESHOLD = 0.5;
/** Pairs at or above this are "kept" (punctuation/whitespace tweaks don't count). */
const KEPT_THRESHOLD = 0.97;

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

/** 1 = identical after normalisation, 0 = nothing in common. */
export function textSimilarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x && !y) return 1;
  const d = levenshtein(x, y);
  return Math.max(0, 1 - d / Math.max(x.length, y.length, 1));
}

/** Length of the longest increasing subsequence (for counting moves). */
function lisLength(seq: number[]): number {
  const tails: number[] = [];
  for (const v of seq) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = v;
  }
  return tails.length;
}

export function diffQuestions(generated: QuestionLike[], final: QuestionLike[]): ReviewDiff {
  const pairs: { g: number; f: number; sim: number }[] = [];
  for (let g = 0; g < generated.length; g++) {
    for (let f = 0; f < final.length; f++) {
      pairs.push({ g, f, sim: textSimilarity(generated[g].text, final[f].text) });
    }
  }
  pairs.sort((a, b) => b.sim - a.sim);

  const usedG = new Set<number>();
  const usedF = new Set<number>();
  const matches: { g: number; f: number; sim: number }[] = [];
  for (const p of pairs) {
    if (p.sim < MATCH_THRESHOLD) break;
    if (usedG.has(p.g) || usedF.has(p.f)) continue;
    usedG.add(p.g);
    usedF.add(p.f);
    matches.push(p);
  }

  const items: ReviewDiffItem[] = [];
  let kept = 0;
  let reworded = 0;
  let untouched = 0;
  for (const m of matches) {
    const status: DiffStatus = m.sim >= KEPT_THRESHOLD ? "kept" : "reworded";
    if (status === "kept") {
      kept++;
      if (m.g === m.f) untouched++;
    } else {
      reworded++;
    }
    items.push({
      status,
      generatedIndex: m.g,
      finalIndex: m.f,
      similarity: Math.round(m.sim * 1000) / 1000,
      generatedText: generated[m.g].text,
      finalText: final[m.f].text,
      typeChanged: (generated[m.g].type ?? "voice") !== (final[m.f].type ?? "voice"),
    });
  }
  for (let f = 0; f < final.length; f++) {
    if (usedF.has(f)) continue;
    items.push({ status: "added", generatedIndex: null, finalIndex: f, similarity: 0, finalText: final[f].text, typeChanged: false });
  }
  for (let g = 0; g < generated.length; g++) {
    if (usedG.has(g)) continue;
    items.push({ status: "deleted", generatedIndex: g, finalIndex: null, similarity: 0, generatedText: generated[g].text, typeChanged: false });
  }
  items.sort((a, b) => (a.finalIndex ?? 1e9) - (b.finalIndex ?? 1e9) || (a.generatedIndex ?? 0) - (b.generatedIndex ?? 0));

  const inFinalOrder = matches.slice().sort((a, b) => a.f - b.f).map((m) => m.g);
  const moved = matches.length - lisLength(inFinalOrder);
  const meanSimilarity = matches.length ? matches.reduce((s, m) => s + m.sim, 0) / matches.length : 0;
  const denom = Math.max(generated.length, 1);

  return {
    generated: generated.length,
    final: final.length,
    kept,
    reworded,
    added: final.length - matches.length,
    deleted: generated.length - matches.length,
    moved,
    keptRatio: Math.round((kept / denom) * 1000) / 1000,
    survivedRatio: Math.round(((kept + reworded) / denom) * 1000) / 1000,
    untouchedRatio: Math.round((untouched / denom) * 1000) / 1000,
    meanSimilarity: Math.round(meanSimilarity * 1000) / 1000,
    items,
  };
}

/** The PostHog-friendly subset (no per-question text). */
export function summarizeDiff(diff: ReviewDiff) {
  const { items: _items, ...summary } = diff;
  return summary;
}
