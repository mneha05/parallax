// scripts/generate-scenarios.mjs
// Generates three reliability investigation scenarios, each with a known "ground truth"
// that a well-functioning multi-agent investigation should be able to recover.
//
//  1. lot-divergence:    one production lot is aging anomalously fast
//  2. capacitor-aging:   gradual end-of-life across a fleet, project remaining life
//  3. field-returns:     change-point in field-return rate after a process change
//
// Deterministic — same seeds = same data.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../public/scenarios");
mkdirSync(OUT_DIR, { recursive: true });

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Box-Muller for normal samples
function gauss(rng, mean, sd) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean + sd * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
// Weibull sample
function weibull(rng, beta, eta) {
  const u = rng();
  return eta * Math.pow(-Math.log(1 - u), 1 / beta);
}

// ─── Scenario 1: Lot divergence ─────────────────────────────────────────────
// Five lots of 80 units each. Lot C has subtly elevated leakage current
// growth. Engineer needs to know: is C drifting, or is this noise?
function generateLotDivergence() {
  const rng = mulberry32(99127);
  const LOTS = ["A", "B", "C", "D", "E"];
  const PER_LOT = 80;
  const months = 24;

  // Each unit has a baseline leakage and a drift rate (μA/month)
  // Lots A,B,D,E: baseline ~ N(2.1, 0.18), drift ~ N(0.04, 0.012)
  // Lot C: same baseline, but drift ~ N(0.058, 0.018) — ~45% higher mean drift,
  //        within natural variation if you only look at a few units
  const lotProfiles = {
    A: { drift_mean: 0.040, drift_sd: 0.012 },
    B: { drift_mean: 0.041, drift_sd: 0.013 },
    C: { drift_mean: 0.058, drift_sd: 0.018 },
    D: { drift_mean: 0.039, drift_sd: 0.011 },
    E: { drift_mean: 0.042, drift_sd: 0.012 },
  };

  const units = [];
  const measurements = [];
  for (const lot of LOTS) {
    const profile = lotProfiles[lot];
    for (let n = 0; n < PER_LOT; n++) {
      const baseline = gauss(rng, 2.1, 0.18);
      const drift = Math.max(0, gauss(rng, profile.drift_mean, profile.drift_sd));
      const unitId = `${lot}-${String(n + 1).padStart(3, "0")}`;
      units.push({ unit_id: unitId, lot, baseline_uA: +baseline.toFixed(3), drift_uA_per_mo: +drift.toFixed(4) });
      // Every 3 months — 8 measurement points
      for (let m = 0; m <= months; m += 3) {
        const noise = gauss(rng, 0, 0.08);
        const value = +(baseline + drift * m + noise).toFixed(3);
        measurements.push({ unit_id: unitId, lot, month: m, leakage_uA: value });
      }
    }
  }

  return {
    id: "lot-divergence",
    title: "Lot Divergence — Leakage Current Drift",
    component: "ECC-7 capacitor (qualification build)",
    description:
      "Five production lots (A–E), 80 units per lot, leakage current measured every 3 months over a 24-month accelerated aging campaign. A reliability engineer suspects one lot may be drifting faster than the others but the visual difference is subtle and could be sampling noise.",
    units_total: units.length,
    measurements_total: measurements.length,
    schema: ["unit_id", "lot", "month", "leakage_uA"],
    units,
    measurements,
    ground_truth: {
      anomalous_lot: "C",
      mean_drift_uA_per_mo: { A: 0.040, B: 0.041, C: 0.058, D: 0.039, E: 0.042 },
      note: "Lot C has ~45% higher mean drift than the others.",
    },
    suggested_questions: [
      "Is any lot aging faster than the others?",
      "How confident can we be that the difference is real, not noise?",
      "If Lot C continues at its current trajectory, when does it exceed the 4.0 μA spec limit?",
    ],
  };
}

// ─── Scenario 2: Capacitor end-of-life ──────────────────────────────────────
// 600 units of a single design, surveillance test data over 8 years.
// Failures recorded as time-to-failure. About 18% have failed.
// Goal: fit reliability model, project remaining-life curve.
function generateCapacitorAging() {
  const rng = mulberry32(73491);
  const POP = 600;
  const FOLLOW_MONTHS = 96; // 8 years
  // True Weibull: β=2.4 (wear-out), η=180 months
  const BETA_TRUE = 2.4;
  const ETA_TRUE = 180;

  const records = [];
  let failed = 0;
  for (let i = 0; i < POP; i++) {
    const ttf_months = weibull(rng, BETA_TRUE, ETA_TRUE);
    const unitId = `CAP-${String(i + 1).padStart(4, "0")}`;
    if (ttf_months <= FOLLOW_MONTHS) {
      records.push({
        unit_id: unitId,
        observed_months: +ttf_months.toFixed(1),
        event: "failure",
      });
      failed += 1;
    } else {
      records.push({
        unit_id: unitId,
        observed_months: FOLLOW_MONTHS,
        event: "censored", // still operational at end of observation window
      });
    }
  }

  return {
    id: "capacitor-aging",
    title: "Component Surveillance — Remaining Life Projection",
    component: "X7R ceramic capacitor, deployed fleet",
    description:
      "Surveillance program tracked 600 fielded units over 96 months (8 years). Failures recorded with time-to-failure; surviving units are right-censored at study end. Program manager needs a defensible remaining-life projection for budgeting the next replacement cycle.",
    units_total: records.length,
    failures_observed: failed,
    censored_observations: records.length - failed,
    follow_up_months: FOLLOW_MONTHS,
    schema: ["unit_id", "observed_months", "event"],
    records,
    ground_truth: {
      true_beta: BETA_TRUE,
      true_eta: ETA_TRUE,
      true_b10_months: ETA_TRUE * Math.pow(-Math.log(1 - 0.1), 1 / BETA_TRUE),
      note: "Population was sampled from Weibull(β=2.4, η=180mo). A correct MLE fit should recover these within ~5%.",
    },
    suggested_questions: [
      "What's the projected reliability at 10, 15, and 20 years?",
      "When does cumulative failure probability cross 25%?",
      "Is the failure mode consistent with normal wear-out or with infant mortality?",
    ],
  };
}

// ─── Scenario 3: Field-return change point ──────────────────────────────────
// Monthly field-return counts over 5 years. A process change at month 28
// caused return rate to step up ~40%. Question: detect the change point and
// quantify the impact.
function generateFieldReturns() {
  const rng = mulberry32(54713);
  const MONTHS = 60;
  const CHANGE_AT = 28;
  const PRE_RATE = 7.5; // mean returns/month
  const POST_RATE = 10.8;

  const returns = [];
  for (let m = 0; m < MONTHS; m++) {
    const lambda = m < CHANGE_AT ? PRE_RATE : POST_RATE;
    // Poisson via gaussian approximation (lambda is large enough)
    const count = Math.max(0, Math.round(gauss(rng, lambda, Math.sqrt(lambda))));
    const date = new Date(2021, 0, 1);
    date.setMonth(date.getMonth() + m);
    returns.push({
      month_idx: m,
      month: date.toISOString().slice(0, 7),
      returns: count,
    });
  }

  return {
    id: "field-returns",
    title: "Field-Return Rate — Process Change Investigation",
    component: "Power module, field-deployed",
    description:
      "Monthly field-return counts over 60 months. A supplier reported a process modification roughly 2-3 years ago but the exact date is missing from records. Quality team needs to identify when (and whether) the modification affected return rate.",
    months_observed: MONTHS,
    returns_total: returns.reduce((s, r) => s + r.returns, 0),
    schema: ["month_idx", "month", "returns"],
    returns,
    ground_truth: {
      true_change_point_month: CHANGE_AT,
      pre_rate: PRE_RATE,
      post_rate: POST_RATE,
      relative_change_pct: ((POST_RATE - PRE_RATE) / PRE_RATE) * 100,
      note: "True step change occurred at month 28; PELT or CUSUM should localize it within ±2 months.",
    },
    suggested_questions: [
      "When did the return rate change, and by how much?",
      "How confident is the change-point estimate?",
      "Was the change gradual or step?",
    ],
  };
}

const scenarios = [
  generateLotDivergence(),
  generateCapacitorAging(),
  generateFieldReturns(),
];

for (const s of scenarios) {
  const path = resolve(OUT_DIR, `${s.id}.json`);
  writeFileSync(path, JSON.stringify(s));
  const size = (JSON.stringify(s).length / 1024).toFixed(1);
  console.log(`✓ ${s.id}.json  (${size} KB)`);
}

// Also write a manifest so the UI can enumerate scenarios
const manifest = scenarios.map((s) => ({
  id: s.id,
  title: s.title,
  component: s.component,
  description: s.description,
  suggested_questions: s.suggested_questions,
}));
writeFileSync(resolve(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`✓ manifest.json  (${scenarios.length} scenarios)`);
