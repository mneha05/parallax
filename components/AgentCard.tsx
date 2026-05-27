"use client";

import type { AgentRole, SkillResult } from "@/lib/types";
import type { AgentTimelineState } from "./Workbench";

interface Props {
  agent: AgentTimelineState;
  directorThoughts?: string[];
  running: boolean;
}

const ROLE_META: Record<AgentRole, { name: string; mandate: string; color: string }> = {
  director:     { name: "Director",            mandate: "Plans, delegates, decides when to stop.", color: "var(--director)" },
  statistician: { name: "Statistician",        mandate: "Hypothesis tests, distributions, change-points.", color: "var(--statistician)" },
  reliability:  { name: "Reliability Engineer",mandate: "Survival modeling, life projections.",      color: "var(--reliability)" },
  pattern:      { name: "Pattern Detective",   mandate: "Cross-group divergence scoring.",           color: "var(--pattern)" },
  synthesis:    { name: "Synthesis",           mandate: "Compiles the final stakeholder brief.",    color: "var(--synthesis)" },
};

export default function AgentCard({ agent, directorThoughts, running }: Props) {
  const meta = ROLE_META[agent.role];
  const isDirector = agent.role === "director";
  const directorActive = isDirector && (directorThoughts?.length ?? 0) > 0;
  const stateLabel =
    isDirector
      ? (directorActive ? (running ? "ORCHESTRATING" : "CLOSED") : "STANDING BY")
      : agent.status === "running"
      ? "WORKING"
      : agent.status === "done"
      ? "REPORTED"
      : "IDLE";

  return (
    <article className="card p-5">
      <header className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className={`dot-agent ${agent.status === "running" ? "working" : ""}`}
            style={{ background: meta.color }}
          />
          <div>
            <div className="font-serif text-[19px] leading-tight">{meta.name}</div>
            <div className="text-[11.5px] font-mono text-mute">{meta.mandate}</div>
          </div>
        </div>
        <span className={`tag ${stateLabel === "WORKING" || stateLabel === "ORCHESTRATING" ? "tag-hot" : ""}`}>
          {stateLabel}
        </span>
      </header>

      {/* Director-only: the brief from the director to the specialist */}
      {!isDirector && agent.briefFromDirector && (
        <div className="mb-3">
          <div className="eyebrow mb-1">TASKING FROM DIRECTOR</div>
          <div className="text-[13px] text-slate italic font-serif leading-snug pl-3 border-l-2 hairline-2">
            “{agent.briefFromDirector}”
          </div>
        </div>
      )}

      {/* Director thoughts — accumulated narration */}
      {isDirector && directorThoughts && directorThoughts.length > 0 && (
        <div className="space-y-2">
          {directorThoughts.map((t, i) => (
            <p key={i} className="text-[14px] text-ink leading-relaxed font-serif">{t}</p>
          ))}
          {running && <span className="caret text-[14px]" aria-hidden />}
        </div>
      )}

      {/* Specialist thoughts (pre-skill narration) */}
      {!isDirector && agent.thoughts.length > 0 && (
        <div className="space-y-2 mb-3">
          {agent.thoughts.map((t, i) => (
            <p key={i} className="text-[13.5px] text-slate leading-relaxed italic font-serif">{t}</p>
          ))}
        </div>
      )}

      {/* Skill calls */}
      {!isDirector && agent.skillCalls.length > 0 && (
        <div className="space-y-2 mb-3">
          {agent.skillCalls.map((sc, i) => (
            <SkillCallBlock key={i} skill={sc.skill} args={sc.args} result={sc.result} color={meta.color} />
          ))}
        </div>
      )}

      {/* Specialist finding */}
      {!isDirector && agent.status === "done" && agent.finalHeadline && (
        <div className="mt-3 pt-3 border-t hairline">
          <div className="eyebrow mb-1" style={{ color: meta.color }}>FINDING</div>
          <div className="font-serif text-[16px] leading-snug mb-2">{agent.finalHeadline}</div>
          {agent.finalDetail && (
            <div className="text-[13px] text-slate leading-relaxed">{agent.finalDetail}</div>
          )}
          {agent.numbers && agent.numbers.length > 0 && (
            <div className="grid grid-cols-3 gap-3 mt-3">
              {agent.numbers.map((n, i) => (
                <div key={i}>
                  <div className="eyebrow mb-0.5">{n.label}</div>
                  <div
                    className={`tnum font-mono ${n.emphasis === "primary" ? "text-[16px] text-ink font-medium" : "text-[13px] text-slate"}`}
                  >
                    {n.value}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function SkillCallBlock({
  skill, args, result, color,
}: {
  skill: string;
  args: Record<string, unknown>;
  result?: SkillResult;
  color: string;
}) {
  return (
    <div className="text-[11.5px] font-mono leading-relaxed border-l-2 pl-3" style={{ borderColor: color }}>
      <div className="text-ink">
        <span style={{ color }}>›</span> <span className="text-vermilion">{skill}</span>
        <span className="text-mute">(</span>
        {Object.entries(args).map(([k, v], i, arr) => (
          <span key={k}>
            <span className="text-slate">{k}=</span>
            <span className="text-ink">{typeof v === "string" ? `"${v}"` : String(v)}</span>
            {i < arr.length - 1 && <span className="text-mute">, </span>}
          </span>
        ))}
        <span className="text-mute">)</span>
      </div>
      {result ? (
        <div className="text-slate mt-0.5 pl-3">
          {renderResultLine(result)}
        </div>
      ) : (
        <div className="text-mute mt-0.5 pl-3 working">computing…</div>
      )}
    </div>
  );
}

function renderResultLine(r: SkillResult): string {
  switch (r.kind) {
    case "ks_test":      return `D=${r.statistic.toFixed(3)}, p=${fp(r.p_value)}, reject=${r.reject_null}`;
    case "welch_t":      return `t=${r.t}, df=${r.df}, p=${fp(r.p_value)}, Δμ=${r.mean_diff}, CI=[${r.ci95.join(", ")}]`;
    case "mann_whitney": return `U=${r.u}, p=${fp(r.p_value)}, r=${r.effect_size}`;
    case "correlate":    return `r=${r.pearson_r}, p=${fp(r.pearson_p)}, ρ=${r.spearman_rho}`;
    case "change_point": return `τ=${r.tau}${r.tau_month ? ` (${r.tau_month})` : ""}, Δ=${r.relative_change_pct.toFixed(1)}%, CI=[${r.confidence_band.join(", ")}]`;
    case "weibull_fit":  return `β=${r.beta}, η=${r.eta}, n=${r.n} (${r.n_failed} fail), KSp=${fp(r.ks_p)}`;
    case "b10_life":     return `B10=${r.b10_months}mo = ${r.b10_years}y`;
    case "lot_outlier":  return `${r.ranking.map((x) => `${x.lot}=${x.score.toFixed(2)}`).join(", ")}${r.flagged.length ? ` · flag: ${r.flagged.join(", ")}` : ""}`;
    case "error":        return `ERROR: ${r.message}`;
  }
}
function fp(p: number): string {
  if (!Number.isFinite(p)) return "n/a";
  if (p < 0.001) return "<0.001";
  if (p < 0.01) return p.toFixed(3);
  return p.toFixed(2);
}
