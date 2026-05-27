// Each skill is exposed to its owning specialist agent as an Anthropic SDK tool.
// The dispatcher resolves a tool_use block to a real function call against the
// loaded scenario data, returning a typed SkillResult.

import type Anthropic from "@anthropic-ai/sdk";
import type { Scenario, SkillResult, AgentRole } from "../types";
import { ksTest, welchT, mannWhitneyU, correlate, changePoint } from "./statistician";
import { fitWeibullCensored, b10Life } from "./reliability";
import { lotOutlierScore } from "./pattern";

// ─── Tool schemas (one per agent) ──────────────────────────────────────────

export const STATISTICIAN_TOOLS: Anthropic.Tool[] = [
  {
    name: "compare_distributions",
    description:
      "Two-sample Kolmogorov-Smirnov test. Tests whether two samples are drawn from the same continuous distribution. Use when you need a distribution-free comparison.",
    input_schema: {
      type: "object",
      properties: {
        group_a: { type: "string", description: "lot id (e.g. 'A') or 'pre'/'post' for time-split data" },
        group_b: { type: "string", description: "second group identifier" },
        variable: { type: "string", description: "field name to test (e.g. 'leakage_uA' or 'returns')" },
      },
      required: ["group_a", "group_b", "variable"],
    },
  },
  {
    name: "test_mean_difference",
    description:
      "Welch's t-test for difference in means between two groups, with 95% CI. Use for normally-distributed continuous outcomes with possibly unequal variances.",
    input_schema: {
      type: "object",
      properties: {
        group_a: { type: "string" },
        group_b: { type: "string" },
        variable: { type: "string" },
      },
      required: ["group_a", "group_b", "variable"],
    },
  },
  {
    name: "rank_sum_test",
    description:
      "Mann-Whitney U test — non-parametric alternative to t-test. Use when distributional assumptions of t-test are questionable.",
    input_schema: {
      type: "object",
      properties: {
        group_a: { type: "string" },
        group_b: { type: "string" },
        variable: { type: "string" },
      },
      required: ["group_a", "group_b", "variable"],
    },
  },
  {
    name: "correlate",
    description:
      "Compute Pearson and Spearman correlations between two variables. Use when investigating whether one numeric variable tracks another (e.g. drift rate vs. baseline value).",
    input_schema: {
      type: "object",
      properties: {
        x_variable: { type: "string" },
        y_variable: { type: "string" },
        within_lot: { type: "string", description: "optional: restrict to a single lot" },
      },
      required: ["x_variable", "y_variable"],
    },
  },
  {
    name: "detect_change_point",
    description:
      "Single change-point detection over a univariate time series via maximum-likelihood under shared variance. Returns the most-likely change index with a bootstrap confidence band on the location.",
    input_schema: {
      type: "object",
      properties: {
        variable: { type: "string", description: "field name to scan (e.g. 'returns')" },
      },
      required: ["variable"],
    },
  },
];

export const RELIABILITY_TOOLS: Anthropic.Tool[] = [
  {
    name: "fit_weibull",
    description:
      "Fit a two-parameter Weibull distribution to survival/lifetime data by maximum likelihood, correctly handling right-censored observations. Returns β (shape), η (scale/characteristic life), and a KS goodness-of-fit p-value.",
    input_schema: {
      type: "object",
      properties: {
        time_field: { type: "string", description: "field for observed time (default 'observed_months')" },
        event_field: { type: "string", description: "field for event type — values 'failure' or 'censored'" },
      },
      required: [],
    },
  },
  {
    name: "compute_b10_life",
    description:
      "Compute B10 life (10% population failure point) from previously fitted Weibull parameters. Must be called after fit_weibull.",
    input_schema: {
      type: "object",
      properties: {
        beta: { type: "number" },
        eta:  { type: "number" },
      },
      required: ["beta", "eta"],
    },
  },
];

export const PATTERN_TOOLS: Anthropic.Tool[] = [
  {
    name: "score_lot_outliers",
    description:
      "Rank lots by how much they deviate from the cohort across multiple summary features (e.g. mean late-time leakage, drift rate, peak value). Uses median + MAD standardization. Returns a composite score per lot and flags any exceeding 2.5σ.",
    input_schema: {
      type: "object",
      properties: {
        variable: { type: "string", description: "primary measurement field" },
      },
      required: ["variable"],
    },
  },
];

export const TOOLS_BY_ROLE: Record<Exclude<AgentRole, "director" | "synthesis">, Anthropic.Tool[]> = {
  statistician: STATISTICIAN_TOOLS,
  reliability: RELIABILITY_TOOLS,
  pattern: PATTERN_TOOLS,
};

// ─── Dispatcher ────────────────────────────────────────────────────────────
// Given a scenario + a tool_use block, run the underlying skill against the
// real data and return a structured SkillResult.

export function dispatchSkill(
  scenario: Scenario,
  toolName: string,
  input: Record<string, unknown>,
): SkillResult {
  try {
    switch (toolName) {
      case "compare_distributions": {
        const { a, b } = extractTwoGroups(scenario, input);
        return ksTest(a, b);
      }
      case "test_mean_difference": {
        const { a, b } = extractTwoGroups(scenario, input);
        return welchT(a, b);
      }
      case "rank_sum_test": {
        const { a, b } = extractTwoGroups(scenario, input);
        return mannWhitneyU(a, b);
      }
      case "correlate": {
        const { x, y } = extractTwoVars(scenario, input);
        return correlate(x, y);
      }
      case "detect_change_point": {
        if (scenario.id !== "field-returns") {
          return { kind: "error", message: "change-point only supported for time-series scenarios" };
        }
        const series = scenario.returns.map((r) => r.returns);
        const labels = scenario.returns.map((r) => r.month);
        return changePoint(series, labels);
      }
      case "fit_weibull": {
        if (scenario.id !== "capacitor-aging") {
          return { kind: "error", message: "fit_weibull requires survival data (capacitor-aging scenario)" };
        }
        return fitWeibullCensored(scenario.records);
      }
      case "compute_b10_life": {
        const beta = Number(input.beta);
        const eta = Number(input.eta);
        if (!Number.isFinite(beta) || !Number.isFinite(eta)) {
          return { kind: "error", message: "compute_b10_life requires numeric beta and eta" };
        }
        return b10Life(beta, eta);
      }
      case "score_lot_outliers": {
        if (scenario.id !== "lot-divergence") {
          return { kind: "error", message: "lot outlier scoring requires multi-lot data" };
        }
        const lots = Array.from(new Set(scenario.measurements.map((m) => m.lot)));
        const features = lots.map((lot) => {
          const lotMeas = scenario.measurements.filter((m) => m.lot === lot);
          const byMonth = new Map<number, number[]>();
          for (const m of lotMeas) {
            const arr = byMonth.get(m.month) ?? [];
            arr.push(m.leakage_uA);
            byMonth.set(m.month, arr);
          }
          const months = [...byMonth.keys()].sort((a, b) => a - b);
          const meansByMonth = months.map((mo) => mean(byMonth.get(mo)!));
          // Features: late-time mean, simple OLS slope of mean vs month, max value
          const lateMean = meansByMonth[meansByMonth.length - 1];
          const slope = ols(months, meansByMonth);
          const peakVal = Math.max(...lotMeas.map((m) => m.leakage_uA));
          return { lot, features: [lateMean, slope, peakVal] };
        });
        return lotOutlierScore(features);
      }
      default:
        return { kind: "error", message: `Unknown skill: ${toolName}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: "error", message: msg };
  }
}

// ─── Data extractors ──────────────────────────────────────────────────────
function extractTwoGroups(
  scenario: Scenario,
  input: Record<string, unknown>,
): { a: number[]; b: number[] } {
  const ga = String(input.group_a);
  const gb = String(input.group_b);
  const variable = String(input.variable);

  if (scenario.id === "lot-divergence") {
    const fieldOk = ["leakage_uA"].includes(variable);
    if (!fieldOk) throw new Error(`unknown variable ${variable}`);
    // Compare two lots — use latest-month measurements where signal is strongest
    const months = Array.from(new Set(scenario.measurements.map((m) => m.month))).sort((a, b) => a - b);
    const lateMonth = months[months.length - 1];
    const a = scenario.measurements.filter((m) => m.lot === ga && m.month === lateMonth).map((m) => m.leakage_uA);
    const b = scenario.measurements.filter((m) => m.lot === gb && m.month === lateMonth).map((m) => m.leakage_uA);
    if (a.length === 0 || b.length === 0) throw new Error(`one or both lots not found (${ga}, ${gb})`);
    return { a, b };
  }
  if (scenario.id === "field-returns") {
    // Allow 'pre' vs 'post' with respect to a midpoint; supports change-point follow-up
    const cs = scenario.returns;
    const half = Math.floor(cs.length / 2);
    if (ga === "pre" && gb === "post") {
      return {
        a: cs.slice(0, half).map((r) => r.returns),
        b: cs.slice(half).map((r) => r.returns),
      };
    }
    throw new Error("field-returns supports only group_a='pre', group_b='post'");
  }
  throw new Error(`two-group comparison not supported for scenario ${scenario.id}`);
}

function extractTwoVars(scenario: Scenario, input: Record<string, unknown>): { x: number[]; y: number[] } {
  const xv = String(input.x_variable);
  const yv = String(input.y_variable);
  if (scenario.id === "lot-divergence") {
    const within = input.within_lot ? String(input.within_lot) : null;
    const rows = within
      ? scenario.units.filter((u) => u.lot === within)
      : scenario.units;
    const get = (field: string, u: typeof rows[number]) =>
      field === "baseline_uA" ? u.baseline_uA : field === "drift_uA_per_mo" ? u.drift_uA_per_mo : NaN;
    return { x: rows.map((u) => get(xv, u)), y: rows.map((u) => get(yv, u)) };
  }
  throw new Error(`correlation extraction not implemented for ${scenario.id}`);
}

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
function ols(x: number[], y: number[]): number {
  const mx = mean(x), my = mean(y);
  let num = 0, den = 0;
  for (let i = 0; i < x.length; i++) {
    num += (x[i] - mx) * (y[i] - my);
    den += (x[i] - mx) ** 2;
  }
  return num / den;
}
