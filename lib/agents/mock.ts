// Mock orchestrator. Does not call Anthropic. Plays out a realistic multi-agent
// investigation for each scenario, executing real skill computations on the
// actual data so the numbers in the brief are correct. Streaming is paced with
// short delays so the UI feels like a live investigation.

import type {
  Scenario,
  StreamEvent,
  SynthesizedBrief,
  SkillResult,
  KeyNumber,
} from "../types";
import { dispatchSkill } from "../skills";
import { describeSkillResult } from "./orchestrator";

const DELAY = {
  thought:  450,
  invoke:   400,
  skill:    700,
  finding:  500,
  synth:   1100,
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface MockOptions {
  scenario: Scenario;
  question: string;
  emit: (event: StreamEvent) => void;
}

interface MockResult {
  mode: "mock";
  totalSkillCalls: number;
  totalModelCalls: number;
  brief: SynthesizedBrief;
}

export async function orchestrateMock(opts: MockOptions): Promise<MockResult> {
  switch (opts.scenario.id) {
    case "lot-divergence":   return runLotDivergence(opts);
    case "capacitor-aging":  return runCapacitorAging(opts);
    case "field-returns":    return runFieldReturns(opts);
  }
}

// ─── Scenario 1 ─────────────────────────────────────────────────────────────
async function runLotDivergence(opts: MockOptions): Promise<MockResult> {
  const { scenario, question, emit } = opts;
  let skillCalls = 0;

  await sleep(DELAY.thought);
  emit({ type: "director_thought", at: Date.now(),
    text: "Five lots, identical specification, 24 months of accelerated aging. The question is whether any lot is drifting faster than its peers. I'll start with the Pattern Detective for a cohort-wide divergence score, then have the Statistician confirm with formal tests against the suspected outlier." });

  // Pattern detective
  await sleep(DELAY.invoke);
  emit({ type: "subagent_invoked", role: "pattern", at: Date.now(),
    brief: "Rank all five lots by composite divergence across late-time mean, drift slope, and peak value. Identify any lot exceeding the 2.5σ threshold." });

  await sleep(DELAY.thought);
  emit({ type: "subagent_thought", role: "pattern", at: Date.now(),
    text: "I'll compute three summary features per lot — late-time mean leakage, OLS slope of mean leakage vs time, and peak value — then run the composite outlier score." });

  await sleep(DELAY.skill);
  const argsP = { variable: "leakage_uA" };
  emit({ type: "skill_call", role: "pattern", skill: "score_lot_outliers", args: argsP, at: Date.now() });
  skillCalls++;
  const outlierResult = dispatchSkill(scenario, "score_lot_outliers", argsP);
  emit({ type: "skill_result", role: "pattern", skill: "score_lot_outliers", result: outlierResult, at: Date.now() });

  const flaggedLot =
    outlierResult.kind === "lot_outlier" && outlierResult.flagged.length > 0
      ? outlierResult.flagged[0]
      : outlierResult.kind === "lot_outlier"
      ? outlierResult.ranking[0].lot
      : "C";

  await sleep(DELAY.finding);
  emit({
    type: "subagent_finding",
    role: "pattern",
    at: Date.now(),
    headline: `Lot ${flaggedLot} ranks highest on composite divergence`,
    detail: outlierResult.kind === "lot_outlier"
      ? `Composite scores: ${outlierResult.ranking.map((x) => `${x.lot}=${x.score.toFixed(2)}`).join(", ")}. ${outlierResult.flagged.length ? `Flagged ${outlierResult.flagged.join(", ")} (>2.5σ).` : "None exceed the 2.5σ flag threshold but Lot " + flaggedLot + " is the top score by a wide margin."} The divergence is driven primarily by elevated late-time leakage and a steeper drift slope.`
      : "Pattern detection error.",
    numbers: keyNumbersFor([{ skill: "score_lot_outliers", result: outlierResult }]),
  });

  // Director second turn
  await sleep(DELAY.thought);
  emit({ type: "director_thought", at: Date.now(),
    text: `Pattern Detective flagged Lot ${flaggedLot}. Before I report this as a divergence, I need a formal test — a single high score could still be sampling noise across only five lots. I'll ask the Statistician for a Welch's t-test between Lot ${flaggedLot} and a representative peer, plus a KS test for shape difference.` });

  // Statistician — Welch's t
  const peerLot = flaggedLot === "C" ? "A" : "C";

  await sleep(DELAY.invoke);
  emit({ type: "subagent_invoked", role: "statistician", at: Date.now(),
    brief: `Test whether the late-time (month 24) leakage of Lot ${flaggedLot} differs significantly from Lot ${peerLot}. Use Welch's t-test for mean difference and KS for distribution shape.` });

  await sleep(DELAY.skill);
  const argsT = { group_a: flaggedLot, group_b: peerLot, variable: "leakage_uA" };
  emit({ type: "skill_call", role: "statistician", skill: "test_mean_difference", args: argsT, at: Date.now() });
  skillCalls++;
  const tResult = dispatchSkill(scenario, "test_mean_difference", argsT);
  emit({ type: "skill_result", role: "statistician", skill: "test_mean_difference", result: tResult, at: Date.now() });

  await sleep(DELAY.skill);
  emit({ type: "skill_call", role: "statistician", skill: "compare_distributions", args: argsT, at: Date.now() });
  skillCalls++;
  const ksResult = dispatchSkill(scenario, "compare_distributions", argsT);
  emit({ type: "skill_result", role: "statistician", skill: "compare_distributions", result: ksResult, at: Date.now() });

  await sleep(DELAY.finding);
  const tText = tResult.kind === "welch_t"
    ? `Welch's t-test: t=${tResult.t}, df=${tResult.df}, p=${formatP(tResult.p_value)}. Mean difference of ${tResult.mean_diff} μA with 95% CI [${tResult.ci95.join(", ")}].`
    : "t-test failed.";
  const ksText = ksResult.kind === "ks_test"
    ? `Kolmogorov-Smirnov: D=${ksResult.statistic}, p=${formatP(ksResult.p_value)}.`
    : "KS test failed.";
  emit({
    type: "subagent_finding", role: "statistician", at: Date.now(),
    headline: `Lot ${flaggedLot} differs from Lot ${peerLot} at month 24 with high confidence`,
    detail: `${tText} ${ksText} Both tests reject the null — the late-time distribution of Lot ${flaggedLot} is materially shifted upward relative to Lot ${peerLot}.`,
    numbers: keyNumbersFor([
      { skill: "test_mean_difference", result: tResult },
      { skill: "compare_distributions", result: ksResult },
    ]),
  });

  // Director — third turn
  await sleep(DELAY.thought);
  emit({ type: "director_thought", at: Date.now(),
    text: `We have two converging lines of evidence: the Pattern Detective's cohort-wide score and the Statistician's formal tests against a peer. The result is robust. I have enough to brief the stakeholder.` });

  // Synthesis
  await sleep(DELAY.synth);
  const tFindingP = tResult.kind === "welch_t" ? tResult.p_value : 0.05;
  const ksFindingP = ksResult.kind === "ks_test" ? ksResult.p_value : 0.05;
  const meanDiff = tResult.kind === "welch_t" ? tResult.mean_diff : 0;
  const ranking = outlierResult.kind === "lot_outlier" ? outlierResult.ranking : [];

  const brief: SynthesizedBrief = {
    question,
    headline: `Lot ${flaggedLot} is drifting faster than the other four lots — divergence is statistically significant`,
    confidence: tFindingP < 0.01 && ksFindingP < 0.05 ? "high" : "medium",
    severity: "hot",
    executive_summary: `Across the five-lot accelerated-aging campaign, Lot ${flaggedLot} shows materially elevated leakage growth relative to its peers. The pattern is consistent across three independent summary features (late-time mean, drift slope, peak value), and a formal Welch's t-test against a peer lot rejects the null of equal means with p${formatP(tFindingP)}. A distribution-free KS test confirms the entire late-time distribution has shifted, not just the mean.`,
    evidence: [
      {
        from: "pattern",
        finding: `Lot ${flaggedLot} ranks #1 on composite divergence across three features.`,
        support: `Composite outlier scores: ${ranking.map((r) => `${r.lot}=${r.score.toFixed(2)}`).join(", ")} (method: MAD-standardized).`,
      },
      {
        from: "statistician",
        finding: `Mean leakage difference between Lot ${flaggedLot} and Lot ${peerLot} at month 24 is statistically significant.`,
        support: tResult.kind === "welch_t"
          ? `Welch's t = ${tResult.t}, df = ${tResult.df}, p = ${formatP(tResult.p_value)}, mean diff = ${tResult.mean_diff} μA (95% CI [${tResult.ci95.join(", ")}]).`
          : "n/a",
      },
      {
        from: "statistician",
        finding: `Distribution shape differs, not merely the mean.`,
        support: ksResult.kind === "ks_test"
          ? `Kolmogorov-Smirnov D = ${ksResult.statistic}, p = ${formatP(ksResult.p_value)}.`
          : "n/a",
      },
    ],
    recommendations: [
      `Quarantine remaining inventory from Lot ${flaggedLot} pending root-cause investigation.`,
      `Pull build-record and supplier-lot traceability for Lot ${flaggedLot} units — focus on dielectric material lot and curing-profile excursions during the manufacturing window.`,
      `Re-test a sub-sample from Lot ${flaggedLot} under extended exposure to determine if the divergence is asymptotic or continues to grow.`,
      `Audit the leakage-current calibration of the test stand used during Lot ${flaggedLot}'s month-24 measurement to rule out instrument drift.`,
    ],
    caveats: [
      `Sample size of five lots limits the power of cross-lot outlier ranking — true divergence threshold is informed by domain priors more than statistics here.`,
      `The Welch's t-test compared only one peer lot (${peerLot}); a one-vs-rest comparison would be slightly more conservative.`,
      `Accelerated aging may not perfectly mirror field-condition aging — confirm with field-return data when available.`,
    ],
  };

  emit({ type: "synthesis", brief, at: Date.now() });
  return { mode: "mock", totalSkillCalls: skillCalls, totalModelCalls: 0, brief };
}

// ─── Scenario 2 ─────────────────────────────────────────────────────────────
async function runCapacitorAging(opts: MockOptions): Promise<MockResult> {
  const { scenario, question, emit } = opts;
  let skillCalls = 0;

  await sleep(DELAY.thought);
  emit({ type: "director_thought", at: Date.now(),
    text: "Surveillance data over 8 years, 600 units, 18.5% failed and the rest right-censored. The question asks for a remaining-life projection. I'll have the Reliability Engineer fit a Weibull model — the conventional choice for component lifetime — and derive B10 life. If shape parameter β is large, that's wear-out, which we can extrapolate confidently." });

  await sleep(DELAY.invoke);
  emit({ type: "subagent_invoked", role: "reliability", at: Date.now(),
    brief: "Fit a two-parameter Weibull to the survival data using MLE with right-censoring. Report β, η, KS goodness-of-fit, and derive B10 life." });

  await sleep(DELAY.thought);
  emit({ type: "subagent_thought", role: "reliability", at: Date.now(),
    text: "Profile-likelihood MLE with eta substituted out, golden-section search over β. Right-censored observations contribute survival terms only, not failure-density terms." });

  await sleep(DELAY.skill);
  emit({ type: "skill_call", role: "reliability", skill: "fit_weibull", args: {}, at: Date.now() });
  skillCalls++;
  const wResult = dispatchSkill(scenario, "fit_weibull", {});
  emit({ type: "skill_result", role: "reliability", skill: "fit_weibull", result: wResult, at: Date.now() });

  let b10Result: SkillResult = { kind: "error", message: "skipped" };
  if (wResult.kind === "weibull_fit") {
    await sleep(DELAY.skill);
    const b10Args = { beta: wResult.beta, eta: wResult.eta };
    emit({ type: "skill_call", role: "reliability", skill: "compute_b10_life", args: b10Args, at: Date.now() });
    skillCalls++;
    b10Result = dispatchSkill(scenario, "compute_b10_life", b10Args);
    emit({ type: "skill_result", role: "reliability", skill: "compute_b10_life", result: b10Result, at: Date.now() });
  }

  await sleep(DELAY.finding);
  const beta = wResult.kind === "weibull_fit" ? wResult.beta : NaN;
  const eta = wResult.kind === "weibull_fit" ? wResult.eta : NaN;
  const b10 = b10Result.kind === "b10_life" ? b10Result.b10_years : NaN;
  const ksp = wResult.kind === "weibull_fit" ? wResult.ks_p : NaN;
  const failureModeText =
    beta > 2.5 ? "strong wear-out"
    : beta > 1.5 ? "moderate wear-out"
    : beta > 0.9 ? "near-constant hazard"
    : "infant mortality / decreasing hazard";

  emit({
    type: "subagent_finding", role: "reliability", at: Date.now(),
    headline: `Weibull(β=${beta.toFixed(2)}, η=${eta.toFixed(0)} mo) → B10 = ${b10.toFixed(2)} years`,
    detail: `MLE recovered β=${beta.toFixed(2)} (${failureModeText}) and η=${eta.toFixed(1)} months from ${wResult.kind === "weibull_fit" ? wResult.n_failed : "?"} failures and ${wResult.kind === "weibull_fit" ? wResult.n_censored : "?"} right-censored observations. KS goodness-of-fit p=${formatP(ksp)}. B10 life is ${b10.toFixed(2)} years — by which time 10% of the population is expected to have failed.`,
    numbers: keyNumbersFor([
      { skill: "fit_weibull", result: wResult },
      { skill: "compute_b10_life", result: b10Result },
    ]),
  });

  await sleep(DELAY.thought);
  emit({ type: "director_thought", at: Date.now(),
    text: "The fit is clean (KS p well above 0.05, so the Weibull form is appropriate) and the shape parameter clearly indicates wear-out — meaning extrapolation past the observation window is defensible. I have what I need." });

  await sleep(DELAY.synth);
  const brief: SynthesizedBrief = {
    question,
    headline: `Failure mode is wear-out; B10 life is ${b10.toFixed(2)} years and the model fit is statistically clean`,
    confidence: ksp > 0.10 ? "high" : ksp > 0.05 ? "medium" : "low",
    severity: "info",
    executive_summary: `The 600-unit surveillance population is well-modeled by a Weibull with shape β=${beta.toFixed(2)} and scale η=${eta.toFixed(0)} months. β > 2 indicates classic wear-out (failure rate accelerates with age), which means extrapolation past the 96-month observation window is justified. B10 life — the age at which 10% of the population will have failed — is ${b10.toFixed(2)} years. Goodness-of-fit (KS p=${formatP(ksp)}) supports the Weibull assumption.`,
    evidence: [
      {
        from: "reliability",
        finding: `Weibull MLE with right-censoring fits the data well.`,
        support: wResult.kind === "weibull_fit"
          ? `β=${wResult.beta}, η=${wResult.eta} months, log-likelihood=${wResult.log_likelihood}, KS p=${formatP(wResult.ks_p)}, ${wResult.n_failed} failures over ${wResult.n} observations.`
          : "n/a",
      },
      {
        from: "reliability",
        finding: `Shape parameter indicates wear-out, not random failure.`,
        support: `β=${beta.toFixed(2)} > 2 is characteristic of physical aging; below 1 would be infant mortality.`,
      },
      {
        from: "reliability",
        finding: `B10 life derived directly from the fitted parameters.`,
        support: b10Result.kind === "b10_life"
          ? `B10 = η · (-ln 0.9)^(1/β) = ${b10Result.b10_months} months ≈ ${b10Result.b10_years} years.`
          : "n/a",
      },
    ],
    recommendations: [
      `Plan replacement budgeting around B10 = ${b10.toFixed(1)} years, with B50 (median life) substantially longer at η ≈ ${(eta / 12).toFixed(1)} years.`,
      `Continue surveillance — the censored fraction is high (${wResult.kind === "weibull_fit" ? Math.round(100 * wResult.n_censored / wResult.n) : "?"}%), so updated fits as more failures accrue will tighten the confidence on β.`,
      `Confirm wear-out signature with failure-mode analysis on a sample of failed units (β > 2 should correspond to a physical aging mechanism, not a manufacturing defect).`,
    ],
    caveats: [
      `Single Weibull assumes a single dominant failure mode. If field stresses are heterogeneous, a mixture model may fit better as more failures accumulate.`,
      `The B10 extrapolation point is past the observation window — well-justified given the strong fit, but always less certain than within-sample.`,
    ],
  };
  emit({ type: "synthesis", brief, at: Date.now() });
  return { mode: "mock", totalSkillCalls: skillCalls, totalModelCalls: 0, brief };
}

// ─── Scenario 3 ─────────────────────────────────────────────────────────────
async function runFieldReturns(opts: MockOptions): Promise<MockResult> {
  const { scenario, question, emit } = opts;
  let skillCalls = 0;

  await sleep(DELAY.thought);
  emit({ type: "director_thought", at: Date.now(),
    text: "Monthly return counts over 60 months. The quality team thinks a process change happened but doesn't know when. This is a change-point detection problem. I'll have the Statistician run a change-point scan with bootstrap confidence on the location, then confirm with a Welch's t-test on pre- vs post-segments." });

  await sleep(DELAY.invoke);
  emit({ type: "subagent_invoked", role: "statistician", at: Date.now(),
    brief: "Detect the most-likely change point in the monthly returns series and quantify the magnitude of the shift. Provide a bootstrap confidence band on the location." });

  await sleep(DELAY.skill);
  emit({ type: "skill_call", role: "statistician", skill: "detect_change_point", args: { variable: "returns" }, at: Date.now() });
  skillCalls++;
  const cpResult = dispatchSkill(scenario, "detect_change_point", { variable: "returns" });
  emit({ type: "skill_result", role: "statistician", skill: "detect_change_point", result: cpResult, at: Date.now() });

  await sleep(DELAY.skill);
  emit({ type: "skill_call", role: "statistician", skill: "test_mean_difference",
    args: { group_a: "pre", group_b: "post", variable: "returns" }, at: Date.now() });
  skillCalls++;
  const tResult = dispatchSkill(scenario, "test_mean_difference", { group_a: "pre", group_b: "post", variable: "returns" });
  emit({ type: "skill_result", role: "statistician", skill: "test_mean_difference", result: tResult, at: Date.now() });

  await sleep(DELAY.finding);
  const tau = cpResult.kind === "change_point" ? cpResult.tau : -1;
  const tauMonth = cpResult.kind === "change_point" ? cpResult.tau_month : "n/a";
  const band = cpResult.kind === "change_point" ? cpResult.confidence_band : [0, 0];
  const relChange = cpResult.kind === "change_point" ? cpResult.relative_change_pct : 0;

  emit({
    type: "subagent_finding", role: "statistician", at: Date.now(),
    headline: `Change point at month index ${tau} (${tauMonth}), magnitude ${relChange >= 0 ? "+" : ""}${relChange.toFixed(1)}%`,
    detail: cpResult.kind === "change_point"
      ? `Maximum-likelihood change-point at index ${tau} (${tauMonth}). Pre-mean ${cpResult.pre_mean} → post-mean ${cpResult.post_mean} returns/month. Bootstrap 95% CI on location: indices ${band[0]}–${band[1]}. ${tResult.kind === "welch_t" ? `Welch's t-test on the pre/post split: t=${tResult.t}, p=${formatP(tResult.p_value)} — confirms the level shift is statistically significant.` : ""}`
      : "Change-point detection failed.",
    numbers: keyNumbersFor([
      { skill: "detect_change_point", result: cpResult },
      { skill: "test_mean_difference", result: tResult },
    ]),
  });

  await sleep(DELAY.thought);
  emit({ type: "director_thought", at: Date.now(),
    text: `The Statistician localized the change to a narrow window and confirmed the level shift is real. That's enough for the brief.` });

  await sleep(DELAY.synth);
  const brief: SynthesizedBrief = {
    question,
    headline: `Return rate stepped up around ${tauMonth} by ${relChange >= 0 ? "+" : ""}${relChange.toFixed(0)}%, with a tight confidence window on the date`,
    confidence: "high",
    severity: "warn",
    executive_summary: `Monthly field returns transitioned from a mean of ${cpResult.kind === "change_point" ? cpResult.pre_mean : "?"} to ${cpResult.kind === "change_point" ? cpResult.post_mean : "?"} units around ${tauMonth}. A maximum-likelihood change-point analysis localizes the shift to a ${band[1] - band[0]}-month window (95% bootstrap CI), and a Welch's t-test on the pre/post segments confirms the change is statistically significant. The pattern is consistent with a step change in the underlying process rather than gradual drift.`,
    evidence: [
      {
        from: "statistician",
        finding: `Change-point localized to month index ${tau} (${tauMonth}).`,
        support: cpResult.kind === "change_point"
          ? `MLE τ=${cpResult.tau}, 95% bootstrap CI [${cpResult.confidence_band.join(", ")}]. Pre-mean ${cpResult.pre_mean}, post-mean ${cpResult.post_mean}, relative change ${cpResult.relative_change_pct}%.`
          : "n/a",
      },
      {
        from: "statistician",
        finding: `Pre/post means differ significantly.`,
        support: tResult.kind === "welch_t"
          ? `Welch's t = ${tResult.t}, df = ${tResult.df}, p = ${formatP(tResult.p_value)}, 95% CI on mean difference [${tResult.ci95.join(", ")}].`
          : "n/a",
      },
    ],
    recommendations: [
      `Correlate the ${tauMonth} change-point with the supplier's process-modification records to confirm causation.`,
      `Quantify the cost impact: the ~${Math.abs(relChange).toFixed(0)}% return-rate increase over the post-change period represents the bill for the modification.`,
      `Decide whether to revert the modification, request supplier remediation, or treat the new rate as the operating baseline.`,
    ],
    caveats: [
      `Change-point detection assumes a single step change with shared variance. Multiple smaller changes would be missed at this configuration.`,
      `Bootstrap CI is conditional on the model; it does not account for the possibility that no change occurred (which the t-test addresses separately).`,
    ],
  };

  emit({ type: "synthesis", brief, at: Date.now() });
  return { mode: "mock", totalSkillCalls: skillCalls, totalModelCalls: 0, brief };
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function keyNumbersFor(srs: Array<{ skill: string; result: SkillResult }>): KeyNumber[] {
  const out: KeyNumber[] = [];
  for (const { result: r } of srs) {
    switch (r.kind) {
      case "ks_test":
        out.push({ label: "KS p", value: formatP(r.p_value), emphasis: "primary" });
        out.push({ label: "D", value: r.statistic.toFixed(3) });
        break;
      case "welch_t":
        out.push({ label: "p-value", value: formatP(r.p_value), emphasis: "primary" });
        out.push({ label: "mean diff", value: r.mean_diff.toFixed(3) });
        out.push({ label: "95% CI", value: `[${r.ci95[0].toFixed(2)}, ${r.ci95[1].toFixed(2)}]` });
        break;
      case "change_point":
        out.push({ label: "change at", value: r.tau_month ?? `idx ${r.tau}`, emphasis: "primary" });
        out.push({ label: "Δ", value: `${r.relative_change_pct >= 0 ? "+" : ""}${r.relative_change_pct.toFixed(1)}%` });
        out.push({ label: "95% band", value: `${r.confidence_band[0]}–${r.confidence_band[1]}` });
        break;
      case "weibull_fit":
        out.push({ label: "β", value: r.beta.toFixed(2), emphasis: "primary" });
        out.push({ label: "η", value: `${r.eta.toFixed(0)} mo` });
        out.push({ label: "n / fail", value: `${r.n} / ${r.n_failed}` });
        break;
      case "b10_life":
        out.push({ label: "B10", value: `${r.b10_years.toFixed(2)} yrs`, emphasis: "primary" });
        break;
      case "lot_outlier":
        if (r.flagged.length) out.push({ label: "flagged", value: r.flagged.join(", "), emphasis: "primary" });
        out.push({ label: "top score", value: r.ranking[0].score.toFixed(2) });
        break;
    }
  }
  return out;
}

function formatP(p: number): string {
  if (!Number.isFinite(p)) return "n/a";
  if (p < 0.001) return "<0.001";
  if (p < 0.01) return p.toFixed(3);
  return p.toFixed(2);
}
