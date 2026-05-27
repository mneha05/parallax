// ─── Scenario datasets ──────────────────────────────────────────────────────
export interface ScenarioManifestEntry {
  id: string;
  title: string;
  component: string;
  description: string;
  suggested_questions: string[];
}

export type LotDivergenceScenario = {
  id: "lot-divergence";
  title: string;
  component: string;
  description: string;
  units_total: number;
  measurements_total: number;
  schema: string[];
  units: Array<{ unit_id: string; lot: string; baseline_uA: number; drift_uA_per_mo: number }>;
  measurements: Array<{ unit_id: string; lot: string; month: number; leakage_uA: number }>;
  ground_truth: Record<string, unknown>;
  suggested_questions: string[];
};

export type CapacitorAgingScenario = {
  id: "capacitor-aging";
  title: string;
  component: string;
  description: string;
  units_total: number;
  failures_observed: number;
  censored_observations: number;
  follow_up_months: number;
  schema: string[];
  records: Array<{ unit_id: string; observed_months: number; event: "failure" | "censored" }>;
  ground_truth: Record<string, unknown>;
  suggested_questions: string[];
};

export type FieldReturnsScenario = {
  id: "field-returns";
  title: string;
  component: string;
  description: string;
  months_observed: number;
  returns_total: number;
  schema: string[];
  returns: Array<{ month_idx: number; month: string; returns: number }>;
  ground_truth: Record<string, unknown>;
  suggested_questions: string[];
};

export type Scenario = LotDivergenceScenario | CapacitorAgingScenario | FieldReturnsScenario;

// ─── Agents ─────────────────────────────────────────────────────────────────
export type AgentRole = "director" | "statistician" | "reliability" | "pattern" | "synthesis";

export interface AgentDefinition {
  role: AgentRole;
  displayName: string;
  mandate: string;        // one-liner shown in UI
  systemPrompt: string;
}

// ─── Skills ─────────────────────────────────────────────────────────────────
// Skills are pure functions exposed to specialist agents via tool use.
// Each has a JSON-schema parameter shape and returns a structured result.
export interface SkillDefinition {
  name: string;
  description: string;
  owner: Exclude<AgentRole, "director" | "synthesis">;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

// ─── Streaming events ──────────────────────────────────────────────────────
// Server -> client during an investigation.
export type StreamEvent =
  | { type: "investigation_start"; question: string; scenario: string; at: number }
  | { type: "director_thought"; text: string; at: number }
  | { type: "subagent_invoked"; role: AgentRole; brief: string; at: number }
  | { type: "subagent_thought"; role: AgentRole; text: string; at: number }
  | { type: "skill_call"; role: AgentRole; skill: string; args: Record<string, unknown>; at: number }
  | { type: "skill_result"; role: AgentRole; skill: string; result: SkillResult; at: number }
  | { type: "subagent_finding"; role: AgentRole; headline: string; detail: string; numbers: KeyNumber[]; at: number }
  | { type: "synthesis"; brief: SynthesizedBrief; at: number }
  | { type: "error"; message: string; at: number }
  | { type: "done"; total_skill_calls: number; total_model_calls: number; mode: "model" | "mock"; at: number };

export interface KeyNumber {
  label: string;
  value: string;   // pre-formatted (units, %, etc.)
  emphasis?: "primary" | "secondary";
}

// ─── Skill results ─────────────────────────────────────────────────────────
export type SkillResult =
  | { kind: "ks_test"; statistic: number; p_value: number; n1: number; n2: number; reject_null: boolean; interpretation: string }
  | { kind: "welch_t"; t: number; df: number; p_value: number; mean_diff: number; ci95: [number, number]; interpretation: string }
  | { kind: "mann_whitney"; u: number; p_value: number; effect_size: number; interpretation: string }
  | { kind: "correlate"; pearson_r: number; pearson_p: number; spearman_rho: number; n: number; interpretation: string }
  | { kind: "change_point"; tau: number; tau_month?: string; pre_mean: number; post_mean: number; relative_change_pct: number; confidence_band: [number, number]; interpretation: string }
  | { kind: "weibull_fit"; beta: number; eta: number; log_likelihood: number; n: number; n_failed: number; n_censored: number; ks_p: number; interpretation: string }
  | { kind: "b10_life"; b10_months: number; b10_years: number; beta: number; eta: number; interpretation: string }
  | { kind: "lot_outlier"; ranking: Array<{ lot: string; score: number }>; flagged: string[]; method: string; interpretation: string }
  | { kind: "error"; message: string };

export interface SynthesizedBrief {
  question: string;
  headline: string;
  confidence: "low" | "medium" | "high";
  severity: "info" | "warn" | "hot";
  executive_summary: string;
  evidence: Array<{
    from: AgentRole;
    finding: string;
    support: string; // numerical support
  }>;
  recommendations: string[];
  caveats: string[];
}
