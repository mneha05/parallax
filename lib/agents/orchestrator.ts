import Anthropic from "@anthropic-ai/sdk";
import type {
  Scenario,
  StreamEvent,
  AgentRole,
  SkillResult,
  SynthesizedBrief,
  KeyNumber,
} from "../types";
import { AGENTS, DIRECTOR_TOOLS } from "./definitions";
import { TOOLS_BY_ROLE, dispatchSkill } from "../skills";

const MODEL = "claude-sonnet-4-5";
const MAX_DIRECTOR_TURNS = 6;
const MAX_SPECIALIST_TURNS = 5;

interface OrchestratorOptions {
  apiKey: string;
  scenario: Scenario;
  question: string;
  emit: (event: StreamEvent) => void;
}

interface OrchestratorResult {
  mode: "model";
  totalSkillCalls: number;
  totalModelCalls: number;
  findings: SpecialistFinding[];
  brief: SynthesizedBrief;
}

interface SpecialistFinding {
  role: AgentRole;
  question: string;
  text: string;
  skillResults: Array<{ skill: string; result: SkillResult }>;
}

export async function orchestrate(opts: OrchestratorOptions): Promise<OrchestratorResult> {
  const { apiKey, scenario, question, emit } = opts;
  const client = new Anthropic({ apiKey });

  let totalSkillCalls = 0;
  let totalModelCalls = 0;
  const findings: SpecialistFinding[] = [];

  const scenarioContext = describeScenarioForAgent(scenario);
  const directorUserPrompt = `SCENARIO CONTEXT:\n${scenarioContext}\n\nSTAKEHOLDER QUESTION:\n${question}\n\nPlan and delegate.`;

  // Director conversation
  const directorMessages: Anthropic.MessageParam[] = [
    { role: "user", content: directorUserPrompt },
  ];

  for (let turn = 0; turn < MAX_DIRECTOR_TURNS; turn++) {
    totalModelCalls++;
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: AGENTS.director.systemPrompt,
      tools: DIRECTOR_TOOLS,
      messages: directorMessages,
    });

    // Append assistant response to history
    directorMessages.push({ role: "assistant", content: resp.content });

    // Emit any plain text the director produced
    const textBlocks = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    for (const t of textBlocks) {
      const txt = t.text.trim();
      if (txt) emit({ type: "director_thought", text: txt, at: Date.now() });
    }

    // If no more tool calls, director is done
    const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) break;
    if (resp.stop_reason !== "tool_use") break;

    // Collect tool results for the next director turn
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const tu of toolUses) {
      const role = mapDirectorToolToRole(tu.name);
      if (!role) {
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `Unknown tool ${tu.name}` });
        continue;
      }
      const subQuestion = (tu.input as { question: string }).question;
      emit({ type: "subagent_invoked", role, brief: subQuestion, at: Date.now() });

      // Run the specialist
      const finding = await runSpecialist({
        client,
        scenario,
        role,
        question: subQuestion,
        emit,
        onSkillCall: () => totalSkillCalls++,
        onModelCall: () => totalModelCalls++,
      });
      findings.push(finding);

      // Format the specialist's finding for the director's tool_result
      const formatted = formatFindingForDirector(finding);
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: formatted });
    }

    directorMessages.push({ role: "user", content: toolResults });
  }

  // ─── Synthesis pass ───────────────────────────────────────────────────────
  totalModelCalls++;
  const synthesisUser = buildSynthesisPrompt(question, scenario, findings);
  const synthResp = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: AGENTS.synthesis.systemPrompt,
    messages: [{ role: "user", content: synthesisUser }],
  });
  const synthText = synthResp.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "{}";
  const brief = parseSynthesisJSON(synthText, question);
  emit({ type: "synthesis", brief, at: Date.now() });

  return { mode: "model", totalSkillCalls, totalModelCalls, findings, brief };
}

// ─── Specialist runner ─────────────────────────────────────────────────────
async function runSpecialist(args: {
  client: Anthropic;
  scenario: Scenario;
  role: AgentRole;
  question: string;
  emit: (event: StreamEvent) => void;
  onSkillCall: () => void;
  onModelCall: () => void;
}): Promise<SpecialistFinding> {
  const { client, scenario, role, question, emit, onSkillCall, onModelCall } = args;
  if (role === "director" || role === "synthesis") throw new Error("not a specialist");
  const def = AGENTS[role];
  const tools = TOOLS_BY_ROLE[role];

  const scenarioContext = describeScenarioForAgent(scenario);
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `SCENARIO CONTEXT:\n${scenarioContext}\n\nDIRECTOR'S QUESTION FOR YOU:\n${question}\n\nUse your tools to answer.`,
    },
  ];

  const skillResults: Array<{ skill: string; result: SkillResult }> = [];
  let finalText = "";

  for (let turn = 0; turn < MAX_SPECIALIST_TURNS; turn++) {
    onModelCall();
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: def.systemPrompt,
      tools,
      messages,
    });
    messages.push({ role: "assistant", content: resp.content });

    const textBlocks = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    for (const t of textBlocks) {
      const txt = t.text.trim();
      if (txt) emit({ type: "subagent_thought", role, text: txt, at: Date.now() });
    }

    const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0 || resp.stop_reason !== "tool_use") {
      finalText = textBlocks.map((t) => t.text).join("\n").trim();
      break;
    }

    const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const args = tu.input as Record<string, unknown>;
      emit({ type: "skill_call", role, skill: tu.name, args, at: Date.now() });
      onSkillCall();
      const result = dispatchSkill(scenario, tu.name, args);
      skillResults.push({ skill: tu.name, result });
      emit({ type: "skill_result", role, skill: tu.name, result, at: Date.now() });
      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: toolResultBlocks });
  }

  // Extract key numbers for the UI
  const keyNumbers = extractKeyNumbers(skillResults);
  emit({
    type: "subagent_finding",
    role,
    headline: finalText.split(/[.\n]/)[0]?.slice(0, 110) || `${def.displayName} finding`,
    detail: finalText || "(no narrative produced)",
    numbers: keyNumbers,
    at: Date.now(),
  });

  return { role, question, text: finalText, skillResults };
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function mapDirectorToolToRole(name: string): AgentRole | null {
  if (name === "consult_statistician") return "statistician";
  if (name === "consult_reliability_engineer") return "reliability";
  if (name === "consult_pattern_detective") return "pattern";
  return null;
}

function formatFindingForDirector(finding: SpecialistFinding): string {
  const skillSummary = finding.skillResults
    .map((sr, i) => `[${i + 1}] ${sr.skill}: ${describeSkillResult(sr.result)}`)
    .join("\n");
  return `Specialist: ${AGENTS[finding.role].displayName}\nSkill results:\n${skillSummary}\n\nNarrative:\n${finding.text}`;
}

export function describeSkillResult(r: SkillResult): string {
  switch (r.kind) {
    case "ks_test":
      return `KS=${r.statistic}, p=${formatP(r.p_value)}, reject_null=${r.reject_null}`;
    case "welch_t":
      return `t=${r.t}, df=${r.df}, p=${formatP(r.p_value)}, mean_diff=${r.mean_diff}, ci95=[${r.ci95.join(", ")}]`;
    case "mann_whitney":
      return `U=${r.u}, p=${formatP(r.p_value)}, effect=${r.effect_size}`;
    case "correlate":
      return `r=${r.pearson_r}, p=${formatP(r.pearson_p)}, ρ=${r.spearman_rho}, n=${r.n}`;
    case "change_point":
      return `τ=${r.tau}${r.tau_month ? ` (${r.tau_month})` : ""}, pre=${r.pre_mean}, post=${r.post_mean}, Δ=${r.relative_change_pct}%, 95%CI=[${r.confidence_band.join(", ")}]`;
    case "weibull_fit":
      return `β=${r.beta}, η=${r.eta}, n=${r.n} (${r.n_failed} fail, ${r.n_censored} cens), KS p=${formatP(r.ks_p)}`;
    case "b10_life":
      return `B10=${r.b10_months}mo (${r.b10_years}y)`;
    case "lot_outlier":
      return `ranking: ${r.ranking.map((x) => `${x.lot}=${x.score}`).join(", ")}; flagged: ${r.flagged.join(", ") || "none"}`;
    case "error":
      return `ERROR: ${r.message}`;
  }
}

function extractKeyNumbers(srs: Array<{ skill: string; result: SkillResult }>): KeyNumber[] {
  const out: KeyNumber[] = [];
  for (const { result: r } of srs) {
    switch (r.kind) {
      case "ks_test":
        out.push({ label: "KS p-value", value: formatP(r.p_value), emphasis: "primary" });
        out.push({ label: "KS statistic", value: r.statistic.toFixed(3) });
        break;
      case "welch_t":
        out.push({ label: "p-value", value: formatP(r.p_value), emphasis: "primary" });
        out.push({ label: "mean diff", value: r.mean_diff.toFixed(3) });
        out.push({ label: "95% CI", value: `[${r.ci95[0].toFixed(2)}, ${r.ci95[1].toFixed(2)}]` });
        break;
      case "change_point":
        out.push({ label: "change point", value: r.tau_month ?? `idx ${r.tau}`, emphasis: "primary" });
        out.push({ label: "rate change", value: `${r.relative_change_pct >= 0 ? "+" : ""}${r.relative_change_pct.toFixed(1)}%` });
        break;
      case "weibull_fit":
        out.push({ label: "β (shape)", value: r.beta.toFixed(2), emphasis: "primary" });
        out.push({ label: "η (scale)", value: `${r.eta.toFixed(0)} mo` });
        out.push({ label: "n failures", value: `${r.n_failed} / ${r.n}` });
        break;
      case "b10_life":
        out.push({ label: "B10 life", value: `${r.b10_years.toFixed(2)} yrs`, emphasis: "primary" });
        break;
      case "lot_outlier":
        if (r.flagged.length > 0)
          out.push({ label: "flagged lot", value: r.flagged.join(", "), emphasis: "primary" });
        out.push({ label: "top score", value: r.ranking[0].score.toFixed(2) });
        break;
    }
  }
  return out;
}

function describeScenarioForAgent(scenario: Scenario): string {
  const lines = [
    `Dataset: ${scenario.title}`,
    `Component: ${scenario.component}`,
    `Description: ${scenario.description}`,
    `Schema: ${scenario.schema.join(", ")}`,
  ];
  if (scenario.id === "lot-divergence") {
    const lots = Array.from(new Set(scenario.units.map((u) => u.lot)));
    lines.push(`Lots present: ${lots.join(", ")}`);
    lines.push(`Units: ${scenario.units_total}; measurements: ${scenario.measurements_total}`);
  } else if (scenario.id === "capacitor-aging") {
    lines.push(`Units: ${scenario.units_total}; failures: ${scenario.failures_observed}; censored: ${scenario.censored_observations}; follow-up: ${scenario.follow_up_months} months`);
  } else if (scenario.id === "field-returns") {
    lines.push(`Months: ${scenario.months_observed}; total returns: ${scenario.returns_total}`);
  }
  return lines.join("\n");
}

function buildSynthesisPrompt(question: string, scenario: Scenario, findings: SpecialistFinding[]): string {
  const sections: string[] = [];
  sections.push(`STAKEHOLDER QUESTION:\n${question}`);
  sections.push(`SCENARIO:\n${describeScenarioForAgent(scenario)}`);
  sections.push("SPECIALIST FINDINGS:");
  findings.forEach((f, i) => {
    sections.push(`--- Finding ${i + 1} (${AGENTS[f.role].displayName}) ---`);
    sections.push(`Asked: ${f.question}`);
    sections.push(`Skill outputs:`);
    f.skillResults.forEach((sr) => sections.push(`  - ${sr.skill}: ${describeSkillResult(sr.result)}`));
    sections.push(`Narrative: ${f.text}`);
  });
  sections.push("\nProduce the JSON brief now. JSON only, no preamble.");
  return sections.join("\n\n");
}

function parseSynthesisJSON(raw: string, question: string): SynthesizedBrief {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.headline === "string") return parsed as SynthesizedBrief;
  } catch {
    // fall through
  }
  return {
    question,
    headline: "Synthesis failed to parse",
    confidence: "low",
    severity: "info",
    executive_summary: "The synthesis agent returned non-JSON output; falling back to raw text.",
    evidence: [],
    recommendations: [],
    caveats: ["Synthesis JSON parse failure — see raw output in server logs."],
  };
}

function formatP(p: number): string {
  if (p < 0.001) return "<0.001";
  if (p < 0.01) return p.toFixed(3);
  return p.toFixed(2);
}
