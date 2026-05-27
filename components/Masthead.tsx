"use client";

interface Props { mode: "model" | "mock" }

export default function Masthead({ mode }: Props) {
  return (
    <header className="border-b hairline-2">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-3 flex items-baseline justify-between">
        <div className="flex items-baseline gap-6">
          <div className="font-serif text-[28px] font-medium tracking-tight">
            PARALLAX
          </div>
          <div className="eyebrow hidden md:block">
            MULTI-AGENT RELIABILITY INVESTIGATION · VOL. I, NO. 01
          </div>
        </div>
        <div className="flex items-center gap-4">
          <ModeBadge mode={mode} />
          <div className="eyebrow hidden md:block">
            {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }).toUpperCase()}
          </div>
        </div>
      </div>
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10 pb-3 flex gap-6 text-[12px] text-mute font-mono">
        <span>STATISTICAL FRAMEWORK</span>
        <span>·</span>
        <span>WEIBULL ANALYSIS</span>
        <span>·</span>
        <span>CHANGE-POINT DETECTION</span>
        <span>·</span>
        <span>CROSS-LOT DIVERGENCE</span>
      </div>
    </header>
  );
}

function ModeBadge({ mode }: Props) {
  const live = mode === "model";
  return (
    <span className={`tag ${live ? "tag-hot" : ""}`}>
      <span
        className="dot-agent"
        style={{ background: live ? "var(--vermilion)" : "var(--slate)", margin: 0, marginRight: 4 }}
      />
      {live ? "LIVE · MODEL" : "DEMO · MOCK"}
    </span>
  );
}
