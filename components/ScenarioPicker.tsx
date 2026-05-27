"use client";

import type { ScenarioManifestEntry } from "@/lib/types";

interface Props {
  manifest: ScenarioManifestEntry[];
  activeId: string;
  onChange: (id: string) => void;
}

export default function ScenarioPicker({ manifest, activeId, onChange }: Props) {
  return (
    <section>
      <div className="eyebrow mb-3">SELECT DATASET</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {manifest.map((m, idx) => {
          const active = m.id === activeId;
          return (
            <button
              key={m.id}
              onClick={() => onChange(m.id)}
              className={`text-left card p-5 transition-colors hover:bg-paper ${active ? "ring-1 ring-vermilion" : ""}`}
              style={active ? { background: "var(--vermilion-soft)" } : undefined}
            >
              <div className="flex items-baseline justify-between mb-2">
                <span className="eyebrow tnum">CASE {String(idx + 1).padStart(2, "0")}</span>
                {active && <span className="tag tag-hot">SELECTED</span>}
              </div>
              <div className="font-serif text-[18px] leading-tight mb-2">{m.title}</div>
              <div className="text-[12px] text-slate font-mono mb-3">{m.component}</div>
              <div className="text-[13px] text-slate leading-relaxed line-clamp-3">{m.description}</div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
