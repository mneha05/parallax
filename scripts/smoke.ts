// Smoke test for the mock orchestrator. Bypasses HTTP/SSE — invokes the
// orchestrator directly and prints the event stream to stdout.
import { readFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  // Compile via tsx
  const { orchestrateMock } = await import("../lib/agents/mock.ts");

  for (const id of ["lot-divergence", "capacitor-aging", "field-returns"]) {
    console.log(`\n━━━ SCENARIO: ${id} ━━━`);
    const raw = await readFile(path.resolve("public/scenarios", `${id}.json`), "utf8");
    const scenario = JSON.parse(raw);
    const question = scenario.suggested_questions[0];
    console.log(`Q: ${question}\n`);

    const events: any[] = [];
    const t0 = Date.now();
    await orchestrateMock({
      scenario,
      question,
      emit: (e) => {
        events.push(e);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        let line = `[${elapsed.padStart(5, " ")}s] ${e.type}`;
        if ("role" in e) line += ` <${e.role}>`;
        if (e.type === "director_thought" || e.type === "subagent_thought") {
          line += `  »${e.text.slice(0, 70)}${e.text.length > 70 ? "…" : ""}`;
        } else if (e.type === "subagent_invoked") {
          line += `  brief: "${e.brief.slice(0, 65)}…"`;
        } else if (e.type === "skill_call") {
          line += `  ${e.skill}(${Object.entries(e.args).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join(", ")})`;
        } else if (e.type === "skill_result") {
          line += `  ${e.skill} → ${e.result.kind}`;
        } else if (e.type === "subagent_finding") {
          line += `  ${e.headline}`;
        } else if (e.type === "synthesis") {
          line += `  ${e.brief.headline}`;
        }
        console.log(line);
      },
    });
    console.log(`\nTotal events: ${events.length}`);
    const synth = events.find((e) => e.type === "synthesis");
    if (synth) {
      console.log(`Brief headline: ${synth.brief.headline}`);
      console.log(`Confidence:     ${synth.brief.confidence}`);
      console.log(`Severity:       ${synth.brief.severity}`);
      console.log(`Evidence:       ${synth.brief.evidence.length} item(s)`);
      console.log(`Recommendations: ${synth.brief.recommendations.length}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
