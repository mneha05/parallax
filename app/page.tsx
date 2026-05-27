import { readFile } from "node:fs/promises";
import path from "node:path";
import Workbench from "@/components/Workbench";
import type { ScenarioManifestEntry } from "@/lib/types";

async function loadManifest(): Promise<ScenarioManifestEntry[]> {
  const fp = path.join(process.cwd(), "public", "scenarios", "manifest.json");
  const raw = await readFile(fp, "utf8");
  return JSON.parse(raw) as ScenarioManifestEntry[];
}

export default async function Page() {
  const manifest = await loadManifest();
  const hasKey = !!process.env.ANTHROPIC_API_KEY?.trim();
  return <Workbench manifest={manifest} initialMode={hasKey ? "model" : "mock"} />;
}
