"use client";

import type { SynthesizedBrief } from "@/lib/types";

interface Props {
  brief: SynthesizedBrief;
  stats: { skills: number; model: number; mode: "model" | "mock"; elapsed_ms: number } | null;
}

export default function ReportView({ brief, stats }: Props) {
  const conf = brief.confidence;
  return (
    <article className="card p-5 sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto">
      <header className="mb-3">
        <div className="flex items-baseline justify-between mb-2">
          <div className="eyebrow">SYNTHESIZED BRIEF</div>
          <SeverityTag severity={brief.severity} />
        </div>
        <div className="text-[10.5px] font-mono text-mute uppercase tracking-widest mb-3">
          confidence · <span className="text-ink">{conf}</span>
        </div>
      </header>

      <h2 className="display text-[20px] leading-snug mb-3 dropcap">
        {brief.headline}
      </h2>

      <div className="text-[13.5px] text-slate leading-relaxed font-serif mb-4">
        {brief.executive_summary}
      </div>

      {brief.evidence.length > 0 && (
        <section className="mb-4">
          <div className="eyebrow mb-2">EVIDENCE</div>
          <ol className="space-y-2.5 list-none p-0 m-0">
            {brief.evidence.map((e, i) => (
              <li key={i} className="text-[12.5px] leading-snug">
                <div className="flex items-baseline gap-1.5">
                  <span className="tnum text-mute font-mono">[{i + 1}]</span>
                  <span className="font-medium text-ink">{e.finding}</span>
                </div>
                <div className="text-[11.5px] font-mono text-slate pl-5 mt-0.5">
                  via <span className="text-ink">{e.from}</span> · {e.support}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {brief.recommendations.length > 0 && (
        <section className="mb-4">
          <div className="eyebrow mb-2">RECOMMENDATIONS</div>
          <ol className="space-y-1.5 list-none p-0 m-0">
            {brief.recommendations.map((r, i) => (
              <li key={i} className="text-[12.5px] leading-snug flex gap-1.5">
                <span className="tnum text-vermilion font-mono">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-ink">{r}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {brief.caveats.length > 0 && (
        <section className="mb-4 pt-3 border-t hairline">
          <div className="eyebrow mb-2">CAVEATS</div>
          <ul className="space-y-1 list-none p-0 m-0">
            {brief.caveats.map((c, i) => (
              <li key={i} className="text-[11.5px] italic text-slate font-serif leading-snug">
                — {c}
              </li>
            ))}
          </ul>
        </section>
      )}

      {stats && (
        <footer className="pt-3 border-t hairline text-[10.5px] font-mono text-mute tnum">
          {stats.mode} · {stats.model} model calls · {stats.skills} skill calls · {(stats.elapsed_ms/1000).toFixed(1)}s
        </footer>
      )}
    </article>
  );
}

function SeverityTag({ severity }: { severity: SynthesizedBrief["severity"] }) {
  const map = {
    info: { label: "NOMINAL", className: "tag" },
    warn: { label: "ACTION REQ.", className: "tag" },
    hot:  { label: "CRITICAL",   className: "tag tag-hot" },
  } as const;
  const m = map[severity];
  return <span className={m.className}>{m.label}</span>;
}
