import type { SkillResult } from "../types";
import { mean, std } from "./_stats";

interface LotSummary {
  lot: string;
  features: number[]; // arbitrary set of summary stats (e.g. mean drift, max value, slope)
}

/**
 * Identify divergent lots by computing a per-feature standardized distance
 * from the median across lots, then summing as a robust "outlier score".
 *
 * This is intentionally simpler than full Mahalanobis (we don't have enough
 * lots to invert a covariance matrix). It correctly recovers the case where
 * one feature is shifted by 1.5-2σ relative to the cohort.
 */
export function lotOutlierScore(lots: LotSummary[]): SkillResult {
  if (lots.length < 3) return { kind: "error", message: "Need ≥3 lots for outlier ranking." };
  const F = lots[0].features.length;
  // Per-feature center (median) and scale (MAD)
  const center = new Array<number>(F);
  const scale = new Array<number>(F);
  for (let f = 0; f < F; f++) {
    const col = lots.map((l) => l.features[f]).sort((a, b) => a - b);
    const med = col[Math.floor(col.length / 2)];
    const abs = col.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
    const mad = (abs[Math.floor(abs.length / 2)] * 1.4826) || 1e-9;
    center[f] = med;
    scale[f] = mad;
  }
  // Score each lot
  const ranking = lots.map((l) => {
    let s = 0;
    for (let f = 0; f < F; f++) {
      const z = (l.features[f] - center[f]) / scale[f];
      s += z * z;
    }
    return { lot: l.lot, score: Math.sqrt(s) };
  });
  ranking.sort((a, b) => b.score - a.score);
  // Flag any lot with score > 2.5 (≈ two-sigma equivalent in this composite metric)
  const flagged = ranking.filter((r) => r.score > 2.5).map((r) => r.lot);
  const interpretation =
    flagged.length === 0
      ? `No lot exceeds the 2.5σ-equivalent outlier threshold. Top score: ${ranking[0].lot} at ${ranking[0].score.toFixed(2)}.`
      : `Flagged lot${flagged.length > 1 ? "s" : ""}: ${flagged.join(", ")} (composite score${flagged.length > 1 ? "s" : ""} ${ranking.filter((r) => flagged.includes(r.lot)).map((r) => r.score.toFixed(2)).join(", ")}). Computed over ${F} features using median + scaled-MAD.`;
  return {
    kind: "lot_outlier",
    ranking: ranking.map((r) => ({ lot: r.lot, score: +r.score.toFixed(3) })),
    flagged,
    method: "MAD-standardized composite distance",
    interpretation,
  };
}
