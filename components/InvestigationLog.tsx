"use client";

import type { AgentRole, SkillResult, KeyNumber, SynthesizedBrief } from "@/lib/types";
import type { AgentTimelineState } from "./Workbench";
import AgentCard from "./AgentCard";

interface Props {
  directorThoughts: string[];
  agents: Record<AgentRole, AgentTimelineState>;
  brief: SynthesizedBrief | null;
  error: string | null;
  running: boolean;
  stats: { skills: number; model: number; mode: "model" | "mock"; elapsed_ms: number } | null;
}

const TIMELINE_ROLES: AgentRole[] = ["director", "statistician", "reliability", "pattern"];

export default function InvestigationLog({
  directorThoughts, agents, brief, error, running, stats,
}: Props) {
  // Only show agents that have been activated (or director, always)
  const visibleRoles = TIMELINE_ROLES.filter(
    (r) => r === "director" || agents[r].status !== "idle",
  );

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div className="eyebrow">INVESTIGATION LOG</div>
        {stats && (
          <div className="text-[11px] font-mono text-slate tnum">
            {stats.mode === "model" ? "model" : "mock"} ·{" "}
            {stats.model} model call{stats.model === 1 ? "" : "s"} ·{" "}
            {stats.skills} skill call{stats.skills === 1 ? "" : "s"} ·{" "}
            {(stats.elapsed_ms / 1000).toFixed(1)}s
          </div>
        )}
      </div>

      {error && (
        <div className="card p-4 text-[13px] text-vermilion bg-vermilion-soft" style={{ background: "var(--vermilion-soft)" }}>
          <div className="eyebrow mb-1" style={{ color: "var(--vermilion)" }}>ERROR</div>
          <div className="font-mono">{error}</div>
        </div>
      )}

      {visibleRoles.map((role) => (
        <AgentCard
          key={role}
          agent={agents[role]}
          directorThoughts={role === "director" ? directorThoughts : undefined}
          running={running}
        />
      ))}

      {brief && (
        <div className="card p-5" style={{ background: "var(--vermilion-soft)" }}>
          <div className="flex items-baseline gap-3 mb-2">
            <span className="dot-agent" style={{ background: "var(--synthesis)" }} />
            <span className="eyebrow" style={{ color: "var(--vermilion)" }}>SYNTHESIS COMPLETE</span>
          </div>
          <div className="font-serif text-[16px] italic text-slate leading-relaxed pl-4 border-l-2" style={{ borderColor: "var(--vermilion)" }}>
            The investigation has closed. The compiled brief is in the right column.
          </div>
        </div>
      )}
    </div>
  );
}
