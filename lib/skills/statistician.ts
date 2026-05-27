import type { SkillResult } from "../types";
import { mean, std, ksQ, tDistP2, normalCDF, pearson, spearman, ranks } from "./_stats";

// ─── Two-sample Kolmogorov-Smirnov ─────────────────────────────────────────
export function ksTest(a: number[], b: number[]): SkillResult {
  if (a.length < 5 || b.length < 5) {
    return { kind: "error", message: "KS test requires n ≥ 5 in each sample" };
  }
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  const n1 = sa.length, n2 = sb.length;
  let i = 0, j = 0, D = 0;
  while (i < n1 && j < n2) {
    const va = sa[i], vb = sb[j];
    if (va <= vb) i++;
    if (vb <= va) j++;
    const F1 = i / n1, F2 = j / n2;
    const d = Math.abs(F1 - F2);
    if (d > D) D = d;
  }
  const en = Math.sqrt((n1 * n2) / (n1 + n2));
  // Numerical-Recipes finite-sample correction
  const lambda = (en + 0.12 + 0.11 / en) * D;
  const p = ksQ(lambda);
  const reject = p < 0.05;
  const interpretation = reject
    ? `KS statistic D=${D.toFixed(3)} with p=${formatP(p)}; the two distributions differ at α=0.05.`
    : `KS statistic D=${D.toFixed(3)} with p=${formatP(p)}; insufficient evidence that the distributions differ.`;
  return { kind: "ks_test", statistic: +D.toFixed(4), p_value: p, n1, n2, reject_null: reject, interpretation };
}

// ─── Welch's t-test ────────────────────────────────────────────────────────
export function welchT(a: number[], b: number[]): SkillResult {
  if (a.length < 3 || b.length < 3) {
    return { kind: "error", message: "Welch's t requires n ≥ 3 per group" };
  }
  const m1 = mean(a), m2 = mean(b);
  const v1 = variance(a), v2 = variance(b);
  const n1 = a.length, n2 = b.length;
  const se = Math.sqrt(v1 / n1 + v2 / n2);
  const t = (m1 - m2) / se;
  // Welch-Satterthwaite df
  const num = (v1 / n1 + v2 / n2) ** 2;
  const den = (v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1);
  const df = num / den;
  const p = tDistP2(t, df);
  // 95% CI on the difference of means
  const tCrit = tInverseTwoTail(0.05, df);
  const ci: [number, number] = [(m1 - m2) - tCrit * se, (m1 - m2) + tCrit * se];
  const interpretation =
    p < 0.05
      ? `Mean difference of ${(m1 - m2).toFixed(3)} is statistically significant (t=${t.toFixed(2)}, df=${df.toFixed(1)}, p=${formatP(p)}). 95% CI does not contain zero.`
      : `Mean difference of ${(m1 - m2).toFixed(3)} is not statistically significant (t=${t.toFixed(2)}, p=${formatP(p)}). Cannot reject the null.`;
  return {
    kind: "welch_t",
    t: +t.toFixed(3),
    df: +df.toFixed(1),
    p_value: p,
    mean_diff: +(m1 - m2).toFixed(4),
    ci95: [+ci[0].toFixed(4), +ci[1].toFixed(4)],
    interpretation,
  };
}

// Approximate inverse t two-tail critical value (Acklam-style bisection over tDistP2).
function tInverseTwoTail(alpha: number, df: number): number {
  // We want t such that P(|T| > t) = alpha
  let lo = 0, hi = 50;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const p = tDistP2(mid, df);
    if (p > alpha) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function variance(xs: number[]): number {
  const n = xs.length;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / (n - 1);
}

// ─── Mann-Whitney U ────────────────────────────────────────────────────────
export function mannWhitneyU(a: number[], b: number[]): SkillResult {
  const n1 = a.length, n2 = b.length;
  if (n1 < 3 || n2 < 3) return { kind: "error", message: "Mann-Whitney requires n ≥ 3 per group" };
  const all = [...a, ...b];
  const r = ranks(all);
  let R1 = 0;
  for (let i = 0; i < n1; i++) R1 += r[i];
  const U1 = R1 - (n1 * (n1 + 1)) / 2;
  const U2 = n1 * n2 - U1;
  const U = Math.min(U1, U2);
  // Normal approximation (no tie correction; samples assumed large)
  const muU = (n1 * n2) / 2;
  const sigmaU = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  const z = (U - muU) / sigmaU;
  const p = 2 * (1 - normalCDF(Math.abs(z)));
  // Rank-biserial effect size r = 1 - 2U / (n1*n2)
  const effect = 1 - (2 * U) / (n1 * n2);
  const interpretation =
    p < 0.05
      ? `U=${U.toFixed(0)} with p=${formatP(p)}; effect size r=${effect.toFixed(2)}. Distributions differ in central tendency.`
      : `U=${U.toFixed(0)} with p=${formatP(p)}; no significant difference in central tendency.`;
  return { kind: "mann_whitney", u: +U.toFixed(0), p_value: p, effect_size: +effect.toFixed(3), interpretation };
}

// ─── Correlation (Pearson + Spearman) ──────────────────────────────────────
export function correlate(x: number[], y: number[]): SkillResult {
  if (x.length !== y.length) return { kind: "error", message: "correlate: x and y must be same length" };
  const n = x.length;
  if (n < 5) return { kind: "error", message: "correlate: n ≥ 5 required" };
  const r = pearson(x, y);
  // Two-tailed t-test for Pearson r
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  const p = tDistP2(t, n - 2);
  const rho = spearman(x, y);
  const interpretation =
    Math.abs(r) > 0.7
      ? `Strong correlation (r=${r.toFixed(2)}, p=${formatP(p)}). Spearman ρ=${rho.toFixed(2)} confirms monotonic relationship.`
      : Math.abs(r) > 0.3
      ? `Moderate correlation (r=${r.toFixed(2)}, p=${formatP(p)}). Spearman ρ=${rho.toFixed(2)}.`
      : `Weak or no linear association (r=${r.toFixed(2)}, p=${formatP(p)}).`;
  return {
    kind: "correlate",
    pearson_r: +r.toFixed(3),
    pearson_p: p,
    spearman_rho: +rho.toFixed(3),
    n,
    interpretation,
  };
}

// ─── Change point (binary segmentation, mean shift, t-statistic objective) ─
export function changePoint(
  series: number[],
  monthLabels?: string[],
  minSegment = 5,
): SkillResult {
  const n = series.length;
  if (n < minSegment * 2 + 1) {
    return { kind: "error", message: `change-point requires at least ${minSegment * 2 + 1} samples` };
  }
  // Maximum-likelihood single change point under Gaussian with shared variance:
  // minimize -log L over τ which is equivalent to maximizing the squared
  // standardized difference (n1*n2/n)*(m1-m2)^2.
  let bestTau = -1, bestStat = -Infinity, bestPre = 0, bestPost = 0;
  // Cumulative sums for O(n) loop
  const cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + series[i];
  const total = cs[n];

  for (let tau = minSegment; tau <= n - minSegment; tau++) {
    const n1 = tau, n2 = n - tau;
    const m1 = cs[tau] / n1;
    const m2 = (total - cs[tau]) / n2;
    const stat = ((n1 * n2) / n) * (m1 - m2) * (m1 - m2);
    if (stat > bestStat) {
      bestStat = stat;
      bestTau = tau;
      bestPre = m1;
      bestPost = m2;
    }
  }
  // Bootstrap confidence band for tau
  const B = 500;
  const taus: number[] = [];
  for (let b2 = 0; b2 < B; b2++) {
    const samp: number[] = new Array(n);
    for (let i = 0; i < n; i++) samp[i] = series[Math.floor(Math.random() * n)];
    let bs = -Infinity, bt = bestTau;
    const cs2 = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) cs2[i + 1] = cs2[i] + samp[i];
    const tot = cs2[n];
    for (let tau = minSegment; tau <= n - minSegment; tau++) {
      const n1 = tau, n2 = n - tau;
      const m1 = cs2[tau] / n1, m2 = (tot - cs2[tau]) / n2;
      const s = ((n1 * n2) / n) * (m1 - m2) * (m1 - m2);
      if (s > bs) { bs = s; bt = tau; }
    }
    taus.push(bt);
  }
  taus.sort((a, b) => a - b);
  const band: [number, number] = [taus[Math.floor(B * 0.025)], taus[Math.floor(B * 0.975)]];
  const relChange = ((bestPost - bestPre) / bestPre) * 100;
  const monthLabel = monthLabels ? monthLabels[bestTau] : undefined;
  const interpretation =
    `Best single change-point at index ${bestTau}${monthLabel ? ` (${monthLabel})` : ""} with pre-mean ${bestPre.toFixed(2)} → post-mean ${bestPost.toFixed(2)} (${relChange >= 0 ? "+" : ""}${relChange.toFixed(1)}%). 95% bootstrap band: indices ${band[0]}–${band[1]}.`;
  return {
    kind: "change_point",
    tau: bestTau,
    tau_month: monthLabel,
    pre_mean: +bestPre.toFixed(3),
    post_mean: +bestPost.toFixed(3),
    relative_change_pct: +relChange.toFixed(2),
    confidence_band: band,
    interpretation,
  };
}

function formatP(p: number): string {
  if (p < 0.001) return "<0.001";
  if (p < 0.01) return p.toFixed(3);
  return p.toFixed(2);
}
