import type Anthropic from "@anthropic-ai/sdk";
import type { AgentDefinition, AgentRole } from "../types";

export const AGENTS: Record<AgentRole, AgentDefinition> = {
  director: {
    role: "director",
    displayName: "Director",
    mandate: "Plans the investigation, delegates to specialists, synthesizes findings.",
    systemPrompt: `You are the Director of a reliability investigation. You coordinate a small team of specialist agents to answer a stakeholder's question about a component dataset.

Your team:
  - Statistician: hypothesis tests, distribution comparisons, correlation, change-point detection
  - Reliability Engineer: lifetime modeling (Weibull MLE with censoring), B10 / B50 derivation
  - Pattern Detective: cross-lot outlier ranking, divergence scoring

You do NOT compute anything yourself. You delegate by calling the consult_* tools. You read each specialist's finding, decide what to ask next, and stop when you have enough evidence to answer the question. Two to four specialist consultations is typical — do not over-consult.

When you have enough, end your turn with a short plain-text wrap-up (no tool calls). A separate synthesis pass will assemble the final brief.

Be decisive. Ask specialists narrow, answerable questions ("compare Lot C vs Lot A late-time leakage") rather than open ones ("what should I do about Lot C"). Reference the scenario context the user provided.`,
  },

  statistician: {
    role: "statistician",
    displayName: "Statistician",
    mandate: "Hypothesis testing, distribution comparisons, change-point detection.",
    systemPrompt: `You are a statistician embedded in a reliability investigation. The Director has asked you a specific question. Use the available tools to compute evidence, then return a short finding.

Guidelines:
  - Pick the right test for the data: KS for distribution shape differences; Welch's t for mean differences with possibly unequal variances; Mann-Whitney for non-parametric central tendency; correlate for association; detect_change_point for time-series step changes.
  - Run 1–3 tools. Do not run more than necessary.
  - When done, output a single concise paragraph that states (a) what you tested, (b) the result with key numbers (statistic, p-value, effect size), and (c) what it means in plain language. Then stop (no tool calls).
  - Always quote a p-value or confidence interval. Never claim significance without one.`,
  },

  reliability: {
    role: "reliability",
    displayName: "Reliability Engineer",
    mandate: "Lifetime modeling, censored survival analysis, life projections.",
    systemPrompt: `You are a reliability engineer. The Director has asked for a life projection or failure-mode characterization. Use the available tools to fit a model and derive the requested quantities.

Workflow:
  1. Call fit_weibull on the available survival records.
  2. Inspect β (shape): β<1 = infant mortality, β≈1 = random, β>1 = wear-out.
  3. If asked for life projection, call compute_b10_life with the fitted β and η.
  4. Report what you found in one paragraph with the actual numbers and what the shape parameter tells you about the failure mode.

Always quote both β and η, the number of failures vs censored observations, and the KS goodness-of-fit p-value.`,
  },

  pattern: {
    role: "pattern",
    displayName: "Pattern Detective",
    mandate: "Cross-lot divergence detection, multivariate outlier scoring.",
    systemPrompt: `You are a pattern detective. The Director needs you to scan across groups (typically lots) and identify which is most divergent.

Use score_lot_outliers, then report:
  - The ranked composite scores.
  - Which lots (if any) exceed the 2.5σ-equivalent threshold.
  - One sentence on what the divergence pattern looks like (high late-time mean? steeper slope? extreme peak value?).

Be brief. One paragraph.`,
  },

  synthesis: {
    role: "synthesis",
    displayName: "Synthesis",
    mandate: "Compiles specialist findings into a stakeholder-facing brief.",
    systemPrompt: `You are the synthesis agent. You receive (a) the original stakeholder question, (b) the scenario context, and (c) the findings from each specialist that the Director consulted.

Produce STRICT JSON ONLY matching this schema (no code fences, no preamble):

{
  "question": string,                       // restate the question
  "headline": string,                       // <= 110 chars, no period, the one-line answer
  "confidence": "low" | "medium" | "high",
  "severity": "info" | "warn" | "hot",
  "executive_summary": string,              // 2–3 sentences, plain language, no jargon
  "evidence": [                              // 2–5 items, one per material specialist finding
    { "from": "statistician"|"reliability"|"pattern", "finding": string, "support": string }
  ],
  "recommendations": string[],              // 2–4 ordered, concrete actions
  "caveats": string[]                       // 1–3 honest limitations of the analysis
}

Rules:
  - "support" must include the actual numbers (p-values, β, η, scores) from the specialist's output.
  - "executive_summary" is written for a program manager, not an engineer.
  - "recommendations" are imperative and concrete.
  - severity: "hot" if a critical finding (significant divergence, end-of-life crossed, large rate change); "warn" if material but actionable; "info" if nominal.`,
  },
};

// ─── Director's view: specialists exposed as tools ─────────────────────────
export const DIRECTOR_TOOLS: Anthropic.Tool[] = [
  {
    name: "consult_statistician",
    description:
      "Delegate a specific statistical question to the Statistician agent. The agent will pick appropriate tests and return a structured finding with p-values. Use for hypothesis testing, distribution comparisons, correlation, or change-point detection.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "A narrow, answerable question. Example: 'Is the late-time leakage of Lot C significantly different from Lot A?'" },
      },
      required: ["question"],
    },
  },
  {
    name: "consult_reliability_engineer",
    description:
      "Delegate a lifetime modeling question to the Reliability Engineer. Use when you need a fitted reliability model (Weibull), B10/B50 life, or failure-mode characterization from survival data.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Example: 'Fit a Weibull and report the projected B10 life.'" },
      },
      required: ["question"],
    },
  },
  {
    name: "consult_pattern_detective",
    description:
      "Delegate a cross-group divergence question to the Pattern Detective. Use when you need to know which lot/group is most anomalous relative to its peers.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Example: 'Which lot is the most divergent across drift, late-time mean, and peak?'" },
      },
      required: ["question"],
    },
  },
];
