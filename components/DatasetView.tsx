"use client";

import type { Scenario, ScenarioManifestEntry } from "@/lib/types";

interface Props {
  scenario: Scenario | null;
  entry: ScenarioManifestEntry | null;
}

export default function DatasetView({ scenario, entry }: Props) {
  if (!entry) return null;
  return (
    <div className="card p-5 sticky top-6">
      <div className="eyebrow mb-2">DATASET BRIEF</div>
      <div className="font-serif text-[18px] leading-tight mb-3">{entry.title}</div>
      <div className="text-[11.5px] font-mono text-slate mb-4">{entry.component}</div>

      {scenario ? (
        <>
          <Stats scenario={scenario} />
          <div className="my-4 border-t hairline" />
          <Sparkline scenario={scenario} />
          <div className="my-4 border-t hairline" />
          <GroundTruth scenario={scenario} />
        </>
      ) : (
        <div className="text-[12px] text-mute font-mono">Loading scenario…</div>
      )}
    </div>
  );
}

function Stats({ scenario }: { scenario: Scenario }) {
  const items: Array<{ label: string; value: string }> = [];
  if (scenario.id === "lot-divergence") {
    items.push({ label: "lots", value: "5" });
    items.push({ label: "units", value: scenario.units_total.toString() });
    items.push({ label: "measurements", value: scenario.measurements_total.toLocaleString() });
    items.push({ label: "duration", value: "24 mo" });
  } else if (scenario.id === "capacitor-aging") {
    items.push({ label: "units", value: scenario.units_total.toString() });
    items.push({ label: "failures", value: scenario.failures_observed.toString() });
    items.push({ label: "censored", value: scenario.censored_observations.toString() });
    items.push({ label: "follow-up", value: `${scenario.follow_up_months} mo` });
  } else if (scenario.id === "field-returns") {
    items.push({ label: "months", value: scenario.months_observed.toString() });
    items.push({ label: "total returns", value: scenario.returns_total.toString() });
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((it) => (
        <div key={it.label}>
          <div className="eyebrow mb-1">{it.label}</div>
          <div className="metric-num tnum">{it.value}</div>
        </div>
      ))}
    </div>
  );
}

function Sparkline({ scenario }: { scenario: Scenario }) {
  if (scenario.id === "lot-divergence") return <LotSparklines scenario={scenario} />;
  if (scenario.id === "capacitor-aging") return <FailureHistogram scenario={scenario} />;
  if (scenario.id === "field-returns") return <ReturnsSpark scenario={scenario} />;
  return null;
}

function LotSparklines({ scenario }: { scenario: Extract<Scenario, { id: "lot-divergence" }> }) {
  // Group by lot, get mean per month
  const months = Array.from(new Set(scenario.measurements.map((m) => m.month))).sort((a, b) => a - b);
  const lots = Array.from(new Set(scenario.measurements.map((m) => m.lot))).sort();
  const series = lots.map((lot) => {
    const data = months.map((mo) => {
      const vals = scenario.measurements
        .filter((m) => m.lot === lot && m.month === mo)
        .map((m) => m.leakage_uA);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      return mean;
    });
    return { lot, data };
  });
  const all = series.flatMap((s) => s.data);
  const minV = Math.min(...all), maxV = Math.max(...all);
  const W = 240, H = 110, P = 8;
  const xFor = (i: number) => P + (W - 2 * P) * (i / (months.length - 1));
  const yFor = (v: number) => P + (H - 2 * P) * (1 - (v - minV) / (maxV - minV));

  const colors: Record<string, string> = {
    A: "#A8A095", B: "#A8A095", C: "var(--vermilion)", D: "#A8A095", E: "#A8A095",
  };

  return (
    <div>
      <div className="eyebrow mb-2">MEAN LEAKAGE PER LOT (μA)</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full block">
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="var(--rule-2)" strokeWidth="0.5" />
        {series.map((s) => (
          <polyline
            key={s.lot}
            fill="none"
            stroke={colors[s.lot] || "#888"}
            strokeWidth={s.lot === "C" ? 1.8 : 1.0}
            points={s.data.map((v, i) => `${xFor(i)},${yFor(v)}`).join(" ")}
          />
        ))}
        {/* Labels at last point */}
        {series.map((s) => {
          const last = s.data[s.data.length - 1];
          return (
            <text
              key={`l-${s.lot}`}
              x={W - P + 1}
              y={yFor(last) + 3}
              fontSize="8"
              fontFamily="var(--font-mono)"
              fill={colors[s.lot] === "var(--vermilion)" ? "var(--vermilion)" : "var(--slate)"}
            >
              {s.lot}
            </text>
          );
        })}
      </svg>
      <div className="text-[11px] text-mute mt-1">Month 0 → 24. Lot C drawn in vermilion.</div>
    </div>
  );
}

function FailureHistogram({ scenario }: { scenario: Extract<Scenario, { id: "capacitor-aging" }> }) {
  // Bin failure times into 8 bins
  const fails = scenario.records.filter((r) => r.event === "failure").map((r) => r.observed_months);
  const BINS = 12;
  const maxT = scenario.follow_up_months;
  const counts = new Array(BINS).fill(0);
  for (const t of fails) {
    const b = Math.min(BINS - 1, Math.floor((t / maxT) * BINS));
    counts[b]++;
  }
  const maxC = Math.max(...counts);
  const W = 240, H = 110, P = 8;
  const barW = (W - 2 * P) / BINS - 1.5;

  return (
    <div>
      <div className="eyebrow mb-2">FAILURE TIMES (HIST., MO)</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full block">
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="var(--rule-2)" strokeWidth="0.5" />
        {counts.map((c, i) => {
          const h = ((H - 2 * P) * c) / maxC;
          return (
            <rect
              key={i}
              x={P + i * ((W - 2 * P) / BINS) + 0.75}
              y={H - P - h}
              width={barW}
              height={h}
              fill="var(--reliability)"
              opacity="0.85"
            />
          );
        })}
      </svg>
      <div className="text-[11px] text-mute mt-1 tnum">
        n={fails.length} failures of {scenario.units_total} ({((100 * fails.length) / scenario.units_total).toFixed(1)}%)
      </div>
    </div>
  );
}

function ReturnsSpark({ scenario }: { scenario: Extract<Scenario, { id: "field-returns" }> }) {
  const data = scenario.returns.map((r) => r.returns);
  const maxV = Math.max(...data);
  const W = 240, H = 110, P = 8;
  const xFor = (i: number) => P + (W - 2 * P) * (i / (data.length - 1));
  const yFor = (v: number) => P + (H - 2 * P) * (1 - v / maxV);
  return (
    <div>
      <div className="eyebrow mb-2">MONTHLY RETURNS</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full block">
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="var(--rule-2)" strokeWidth="0.5" />
        {data.map((v, i) => (
          <line
            key={i}
            x1={xFor(i)} y1={H - P}
            x2={xFor(i)} y2={yFor(v)}
            stroke="var(--statistician)"
            strokeWidth="1"
          />
        ))}
      </svg>
      <div className="text-[11px] text-mute mt-1 tnum">
        n={scenario.months_observed} months · total {scenario.returns_total}
      </div>
    </div>
  );
}

function GroundTruth({ scenario }: { scenario: Scenario }) {
  return (
    <details>
      <summary className="cursor-pointer eyebrow eyebrow-ink select-none">REVEAL GROUND TRUTH</summary>
      <div className="mt-2 text-[11.5px] font-mono text-slate space-y-1 leading-relaxed">
        {Object.entries(scenario.ground_truth).map(([k, v]) => (
          <div key={k}>
            <span className="text-mute">{k}</span> = <span className="text-ink">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
