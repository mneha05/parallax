"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ScenarioManifestEntry,
  StreamEvent,
  SynthesizedBrief,
  AgentRole,
  SkillResult,
  KeyNumber,
  Scenario,
} from "@/lib/types";
import Masthead from "./Masthead";
import ScenarioPicker from "./ScenarioPicker";
import DatasetView from "./DatasetView";
import QuestionInput from "./QuestionInput";
import InvestigationLog from "./InvestigationLog";
import ReportView from "./ReportView";

export interface AgentTimelineState {
  role: AgentRole;
  status: "idle" | "running" | "done";
  invokedAt?: number;
  briefFromDirector?: string;
  thoughts: string[];
  skillCalls: Array<{ skill: string; args: Record<string, unknown>; result?: SkillResult }>;
  finalHeadline?: string;
  finalDetail?: string;
  numbers?: KeyNumber[];
}

interface Props {
  manifest: ScenarioManifestEntry[];
  initialMode: "model" | "mock";
}

export default function Workbench({ manifest, initialMode }: Props) {
  const [activeId, setActiveId] = useState(manifest[0]?.id ?? "");
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<"model" | "mock">(initialMode);

  // Investigation state
  const [directorThoughts, setDirectorThoughts] = useState<string[]>([]);
  const [agents, setAgents] = useState<Record<AgentRole, AgentTimelineState>>(emptyAgents());
  const [brief, setBrief] = useState<SynthesizedBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ skills: number; model: number; mode: "model" | "mock"; elapsed_ms: number } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const startTsRef = useRef<number>(0);

  const activeManifest = useMemo(
    () => manifest.find((m) => m.id === activeId) ?? null,
    [manifest, activeId],
  );

  // Load scenario data when active changes
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    setScenario(null);
    fetch(`/scenarios/${activeId}.json`)
      .then((r) => r.json())
      .then((data: Scenario) => { if (!cancelled) setScenario(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeId]);

  // Reset investigation state on scenario change
  useEffect(() => {
    setDirectorThoughts([]);
    setAgents(emptyAgents());
    setBrief(null);
    setError(null);
    setStats(null);
    if (activeManifest && !question) {
      setQuestion(activeManifest.suggested_questions[0] ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const onPickQuestion = useCallback((q: string) => {
    setQuestion(q);
  }, []);

  const runInvestigation = useCallback(async () => {
    if (running || !activeId || !question.trim()) return;
    setRunning(true);
    setDirectorThoughts([]);
    setAgents(emptyAgents());
    setBrief(null);
    setError(null);
    setStats(null);
    startTsRef.current = Date.now();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario_id: activeId, question }),
        signal: controller.signal,
      });
      if (!resp.body) throw new Error("No response body");
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE messages are separated by double newlines
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          // Each block can contain multiple "data: ..." lines
          for (const line of block.split("\n")) {
            const trimmed = line.trimStart();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload) continue;
            try {
              const ev = JSON.parse(payload) as StreamEvent;
              applyEvent(ev);
            } catch {
              // ignore malformed
            }
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError((e as Error).message);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [running, activeId, question]);

  function applyEvent(ev: StreamEvent) {
    switch (ev.type) {
      case "investigation_start":
        break;
      case "director_thought":
        setDirectorThoughts((prev) => [...prev, ev.text]);
        break;
      case "subagent_invoked":
        setAgents((prev) => ({
          ...prev,
          [ev.role]: {
            ...prev[ev.role],
            status: "running",
            invokedAt: ev.at,
            briefFromDirector: ev.brief,
            thoughts: [],
            skillCalls: [],
          },
        }));
        break;
      case "subagent_thought":
        setAgents((prev) => ({
          ...prev,
          [ev.role]: {
            ...prev[ev.role],
            thoughts: [...prev[ev.role].thoughts, ev.text],
          },
        }));
        break;
      case "skill_call":
        setAgents((prev) => ({
          ...prev,
          [ev.role]: {
            ...prev[ev.role],
            skillCalls: [...prev[ev.role].skillCalls, { skill: ev.skill, args: ev.args }],
          },
        }));
        break;
      case "skill_result":
        setAgents((prev) => {
          const calls = [...prev[ev.role].skillCalls];
          // Find the last call for this skill without a result
          for (let i = calls.length - 1; i >= 0; i--) {
            if (calls[i].skill === ev.skill && !calls[i].result) {
              calls[i] = { ...calls[i], result: ev.result };
              break;
            }
          }
          return { ...prev, [ev.role]: { ...prev[ev.role], skillCalls: calls } };
        });
        break;
      case "subagent_finding":
        setAgents((prev) => ({
          ...prev,
          [ev.role]: {
            ...prev[ev.role],
            status: "done",
            finalHeadline: ev.headline,
            finalDetail: ev.detail,
            numbers: ev.numbers,
          },
        }));
        break;
      case "synthesis":
        setBrief(ev.brief);
        break;
      case "error":
        setError(ev.message);
        break;
      case "done":
        setStats({
          skills: ev.total_skill_calls,
          model: ev.total_model_calls,
          mode: ev.mode,
          elapsed_ms: Date.now() - startTsRef.current,
        });
        setMode(ev.mode);
        break;
    }
  }

  const hasActivity = directorThoughts.length > 0 ||
    Object.values(agents).some((a) => a.status !== "idle") ||
    brief !== null || error !== null;

  return (
    <div className="min-h-screen flex flex-col">
      <Masthead mode={mode} />

      <main className="flex-1">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8">
          {/* Top — title + scenario picker */}
          <section className="mb-10">
            <div className="eyebrow mb-3">DOSSIER № 02 · INVESTIGATION WORKBENCH</div>
            <h1 className="display text-[44px] md:text-[56px] mb-2">
              Reliability investigations, conducted by a team of agents
            </h1>
            <p className="lede text-[17px] max-w-3xl">
              Select a dataset and pose a question. A director agent will delegate to specialists
              — a statistician, a reliability engineer, a pattern detective — each of whom
              has access to a curated set of analytical skills. The investigation streams to
              you in real time.
            </p>
          </section>

          <ScenarioPicker
            manifest={manifest}
            activeId={activeId}
            onChange={setActiveId}
          />

          {/* Three-pane workbench */}
          <div className="grid grid-cols-12 gap-6 mt-8">
            {/* LEFT — dataset preview */}
            <aside className="col-span-12 lg:col-span-3">
              <DatasetView scenario={scenario} entry={activeManifest} />
            </aside>

            {/* CENTER — investigation log */}
            <section className="col-span-12 lg:col-span-6 space-y-6">
              <QuestionInput
                question={question}
                onChange={setQuestion}
                suggested={activeManifest?.suggested_questions ?? []}
                onPickSuggested={onPickQuestion}
                onRun={runInvestigation}
                running={running}
              />

              {hasActivity ? (
                <InvestigationLog
                  directorThoughts={directorThoughts}
                  agents={agents}
                  brief={brief}
                  error={error}
                  running={running}
                  stats={stats}
                />
              ) : (
                <EmptyState />
              )}
            </section>

            {/* RIGHT — final brief */}
            <aside className="col-span-12 lg:col-span-3">
              {brief ? (
                <ReportView brief={brief} stats={stats} />
              ) : (
                <BriefPlaceholder running={running} />
              )}
            </aside>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

function emptyAgents(): Record<AgentRole, AgentTimelineState> {
  return {
    director: { role: "director", status: "idle", thoughts: [], skillCalls: [] },
    statistician: { role: "statistician", status: "idle", thoughts: [], skillCalls: [] },
    reliability: { role: "reliability", status: "idle", thoughts: [], skillCalls: [] },
    pattern: { role: "pattern", status: "idle", thoughts: [], skillCalls: [] },
    synthesis: { role: "synthesis", status: "idle", thoughts: [], skillCalls: [] },
  };
}

function EmptyState() {
  return (
    <div className="card p-10 text-center">
      <div className="eyebrow mb-4">AWAITING TASKING</div>
      <p className="font-serif italic text-slate text-[17px] max-w-md mx-auto">
        Select or refine a question above and press <span className="snippet">Run investigation</span>.
        The director agent will plan the work and stream findings here as specialists report back.
      </p>
    </div>
  );
}

function BriefPlaceholder({ running }: { running: boolean }) {
  return (
    <div className="card p-6 sticky top-6">
      <div className="eyebrow mb-2">SYNTHESIZED BRIEF</div>
      <div className="font-serif italic text-slate text-[14px] leading-relaxed">
        {running
          ? "Specialists are still reporting. The synthesis agent will compile the brief once the director closes the investigation."
          : "The final brief — headline, evidence, recommendations, caveats — will appear here when the investigation completes."}
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t hairline mt-16 py-8">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10">
        <div className="eyebrow mb-2">COLOPHON</div>
        <p className="text-[13px] text-slate max-w-3xl leading-relaxed">
          PARALLAX is a self-contained demonstration of multi-agent orchestration for reliability data analysis.
          Datasets are synthetic; ground truth is documented in each scenario manifest.
          All statistical computations — Kolmogorov-Smirnov, Welch's t, Mann-Whitney U, change-point MLE,
          Weibull MLE with right-censoring — are implemented from first principles in <span className="snippet">lib/skills</span>.
          The agent layer uses the Anthropic SDK when an API key is configured; otherwise a mock orchestrator
          plays out a scripted investigation while executing the real skills against the real data, so the
          numbers in the brief are always correct.
        </p>
      </div>
    </footer>
  );
}
