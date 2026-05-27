import type { SkillResult } from "../types";

interface SurvivalRecord {
  observed_months: number;
  event: "failure" | "censored";
}

/**
 * Weibull MLE for right-censored survival data.
 *
 * Likelihood for n observations with c failures:
 *   ℓ(β, η) = Σ_failures [log(β) - β log(η) + (β-1) log(t_i)] - Σ_all (t_i / η)^β
 *
 * Given β, the η that maximizes ℓ has a closed form:
 *   η(β) = [ (Σ t_i^β) / c ]^(1/β)
 *
 * Substituting yields a profile likelihood in β alone — we maximize over β
 * via golden-section search on a sensible bracket.
 */
export function fitWeibullCensored(records: SurvivalRecord[]): SkillResult {
  const t = records.map((r) => r.observed_months).filter((v) => v > 0);
  const isFail = records.map((r) => r.event === "failure");
  const c = isFail.filter(Boolean).length;
  const n = records.length;
  if (c < 5) return { kind: "error", message: "Weibull MLE needs at least 5 failures." };

  const logT = t.map((v) => Math.log(v));

  // Profile log-likelihood with eta substituted out
  function profile(beta: number): number {
    let sumT_beta = 0;
    for (let i = 0; i < n; i++) sumT_beta += Math.pow(t[i], beta);
    const etaHat = Math.pow(sumT_beta / c, 1 / beta);
    let ll = 0;
    for (let i = 0; i < n; i++) {
      if (isFail[i]) {
        ll += Math.log(beta) - beta * Math.log(etaHat) + (beta - 1) * logT[i];
      }
      ll -= Math.pow(t[i] / etaHat, beta);
    }
    return ll;
  }

  // Golden-section search over β ∈ [0.3, 8.0]
  const phi = (Math.sqrt(5) - 1) / 2;
  let lo = 0.3, hi = 8.0;
  let x1 = hi - phi * (hi - lo);
  let x2 = lo + phi * (hi - lo);
  let f1 = profile(x1), f2 = profile(x2);
  for (let it = 0; it < 80; it++) {
    if (f1 < f2) {
      lo = x1; x1 = x2; f1 = f2;
      x2 = lo + phi * (hi - lo);
      f2 = profile(x2);
    } else {
      hi = x2; x2 = x1; f2 = f1;
      x1 = hi - phi * (hi - lo);
      f1 = profile(x1);
    }
    if (hi - lo < 1e-6) break;
  }
  const beta = (lo + hi) / 2;
  let sumT_beta = 0;
  for (let i = 0; i < n; i++) sumT_beta += Math.pow(t[i], beta);
  const eta = Math.pow(sumT_beta / c, 1 / beta);
  const ll = profile(beta);

  // KS goodness-of-fit: empirical fraction of population failed by time t_i
  // vs the fitted Weibull CDF F(t_i). Both are on the same probability scale
  // (over the full population, including censored units).
  const failTimes = t.filter((_, i) => isFail[i]).sort((a, b) => a - b);
  let D = 0;
  for (let i = 0; i < failTimes.length; i++) {
    const F_emp_after = (i + 1) / n;            // fraction of population failed by/at t_i (right side)
    const F_emp_before = i / n;                  // (left side, before this jump)
    const F_fit = 1 - Math.exp(-Math.pow(failTimes[i] / eta, beta));
    D = Math.max(D, Math.abs(F_emp_after - F_fit), Math.abs(F_emp_before - F_fit));
  }
  // Approx p via Kolmogorov asymptotic; Lilliefors-style adjustment for
  // estimated parameters is intractable here, so we use the standard form and
  // note in interpretation that this is conservative.
  const en = Math.sqrt(c); // effective n is number of observed failures
  const lambda = (en + 0.12 + 0.11 / en) * D;
  const ksP = kolmogorovQ(lambda);

  const shapeMsg =
    beta < 1
      ? "β<1 indicates infant-mortality / decreasing hazard"
      : beta < 1.5
      ? "β≈1 indicates near-constant hazard (memoryless / random failure)"
      : beta < 2.5
      ? "β between 1.5 and 2.5 indicates moderate wear-out"
      : "β>2.5 indicates strong wear-out / aging-driven failure";

  const interpretation =
    `Maximum-likelihood Weibull fit: β=${beta.toFixed(3)}, η=${eta.toFixed(1)} months ` +
    `(${n} observations, ${c} failures, ${n - c} right-censored). ${shapeMsg}. ` +
    `Goodness-of-fit: KS p=${formatP(ksP)}.`;

  return {
    kind: "weibull_fit",
    beta: +beta.toFixed(3),
    eta: +eta.toFixed(2),
    log_likelihood: +ll.toFixed(2),
    n,
    n_failed: c,
    n_censored: n - c,
    ks_p: ksP,
    interpretation,
  };
}

export function b10Life(beta: number, eta: number): SkillResult {
  // F(t) = 1 - exp(-(t/η)^β) = 0.1  →  t = η * (-ln 0.9)^(1/β)
  const b10 = eta * Math.pow(-Math.log(0.9), 1 / beta);
  const b10y = b10 / 12;
  const interpretation =
    `B10 life = ${b10.toFixed(1)} months (${b10y.toFixed(2)} years) — the time at which 10% of the population is expected to have failed. ` +
    `Derived from β=${beta.toFixed(2)}, η=${eta.toFixed(1)} months.`;
  return { kind: "b10_life", b10_months: +b10.toFixed(2), b10_years: +b10y.toFixed(3), beta, eta, interpretation };
}

function kolmogorovQ(lambda: number): number {
  if (lambda < 0.18) return 1;
  let s = 0, prev = 0, sign = 1;
  for (let j = 1; j <= 150; j++) {
    const term = sign * Math.exp(-2 * j * j * lambda * lambda);
    s += term;
    if (Math.abs(term) <= 1e-10 * Math.abs(prev)) break;
    prev = term; sign *= -1;
  }
  return Math.max(0, Math.min(1, 2 * s));
}

function formatP(p: number): string {
  if (p < 0.001) return "<0.001";
  if (p < 0.01) return p.toFixed(3);
  return p.toFixed(2);
}
