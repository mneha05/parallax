// app/api/investigate/route.ts
// Server-Sent Events endpoint that streams a multi-agent investigation event by event.
//
// Contract:
//   POST { scenario_id: string, question: string }
//   Response: text/event-stream of `data: <JSON StreamEvent>\n\n`
//
// If ANTHROPIC_API_KEY is present, the live orchestrator runs against the Anthropic
// SDK. Otherwise the mock orchestrator runs, which executes the real skill
// functions against the actual scenario data and scripts the agent narration.

import { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Scenario, StreamEvent } from "@/lib/types";
import { orchestrate } from "@/lib/agents/orchestrator";
import { orchestrateMock } from "@/lib/agents/mock";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: { scenario_id?: string; question?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  const scenarioId = (body.scenario_id ?? "").trim();
  const question = (body.question ?? "").trim();
  if (!scenarioId || !question) {
    return new Response("scenario_id and question are required", { status: 400 });
  }

  // Load scenario from disk
  let scenario: Scenario;
  try {
    const fp = path.join(process.cwd(), "public", "scenarios", `${scenarioId}.json`);
    const raw = await readFile(fp, "utf8");
    scenario = JSON.parse(raw) as Scenario;
  } catch (err) {
    return new Response(`Scenario not found: ${scenarioId}`, { status: 404 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const useModel = !!apiKey;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // controller may be closed if the client disconnected
        }
      };

      send({
        type: "investigation_start",
        question,
        scenario: scenario.title,
        at: Date.now(),
      });

      try {
        if (useModel) {
          const result = await orchestrate({
            apiKey: apiKey!,
            scenario,
            question,
            emit: send,
          });
          send({
            type: "done",
            total_skill_calls: result.totalSkillCalls,
            total_model_calls: result.totalModelCalls,
            mode: "model",
            at: Date.now(),
          });
        } else {
          const result = await orchestrateMock({ scenario, question, emit: send });
          send({
            type: "done",
            total_skill_calls: result.totalSkillCalls,
            total_model_calls: result.totalModelCalls,
            mode: "mock",
            at: Date.now(),
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", message, at: Date.now() });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
