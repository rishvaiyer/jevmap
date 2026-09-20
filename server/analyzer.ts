import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, rm } from "node:fs/promises";
import { join, relative, basename, extname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { AnalysisReport, DecisionCandidate, Disposition, Evidence, Primitive, TreeEdge, TreeNode } from "../src/analysis/schema";
import { enrichWithJev } from "./typesafe";

const run = promisify(execFile);
const ignored = new Set([".git", "node_modules", "dist", "build", ".next", "coverage", "vendor", "target", ".venv", "__pycache__"]);
const sourceExtensions: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
  ".mjs": "JavaScript", ".cjs": "JavaScript", ".py": "Python", ".go": "Go", ".rs": "Rust",
  ".java": "Java", ".rb": "Ruby", ".php": "PHP", ".cs": "C#", ".swift": "Swift",
};
const interestingFileNames = new Set(["package.json", "pyproject.toml", "go.mod", "Cargo.toml", "README.md", "tsconfig.json"]);
const semanticWords = /route|router|dispatch|select|choose|classif|intent|triage|rank|priorit|relevance|severity|importance|fallback|eligib|validat|filter|match|score|confidence|handler|tool|action|agent|queue|retry/i;
const generationWords = /llm|openai|anthropic|claude|generate|completion|chat\.complet|invokeModel|generateObject|streamText|prompt/i;
const numericWords = /\b(?:count|length|size|timeout|retryCount|attempts?|statusCode|port|limit|offset|Math\.|Date\.|parseInt|parseFloat)\b|[<>]=?|===?\s*\d/;

type ScannedFile = { path: string; language?: string; content: string; lines: string[] };

export function normalizeGitHubUrl(raw: string): { url: string; owner: string; repo: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error("Enter a valid public GitHub URL, for example https://github.com/owner/repository.");
  }
  if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") {
    throw new Error("JevMap currently accepts public repositories hosted on github.com.");
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("A GitHub URL needs both an owner and a repository name.");
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, "");
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("That GitHub URL contains an unsupported repository name.");
  return { url: `https://github.com/${owner}/${repo}.git`, owner, repo };
}

async function walk(root: string, current = root, output: ScannedFile[] = []): Promise<ScannedFile[]> {
  if (output.length >= 2200) return output;
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    if (ignored.has(entry.name) || entry.name.startsWith(".")) continue;
    const filePath = join(current, entry.name);
    if (entry.isDirectory()) {
      await walk(root, filePath, output);
      continue;
    }
    const extension = extname(entry.name).toLowerCase();
    if (!sourceExtensions[extension] && !interestingFileNames.has(entry.name)) continue;
    try {
      const content = await readFile(filePath, "utf8");
      if (content.length > 350_000) continue;
      output.push({ path: relative(root, filePath).replaceAll("\\", "/"), language: sourceExtensions[extension], content, lines: content.split(/\r?\n/) });
    } catch {
      // A binary or unreadable file should not block the rest of the map.
    }
  }
  return output;
}

function extractFunction(lines: string[], lineIndex: number): string | undefined {
  for (let i = lineIndex; i >= Math.max(0, lineIndex - 12); i -= 1) {
    const match = lines[i].match(/(?:function|async function)\s+([A-Za-z0-9_$]+)|(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(|class\s+([A-Za-z0-9_$]+)/);
    if (match) return match[1] || match[2] || match[3];
  }
  return undefined;
}

function collectOutputs(window: string): string[] {
  const values = [...window.matchAll(/(?:case|return|route|tool|action|status)\s*[(:=]?\s*["'`]([^"'`\n]{2,32})["'`]/gi)].map((match) => match[1].trim());
  return [...new Set(values)].slice(0, 6);
}

function classifyPrimitive(title: string, window: string): Primitive {
  if (/score|severity|importance|priority|rank|relevance|confidence/i.test(`${title} ${window}`)) return "score";
  if (/^is|^has|valid|eligible|allowed|should|can|determin|enabled|exists|needs/i.test(title) || /\bif\s*\([^)]*(?:is|has|valid|eligible|allowed|enabled)/i.test(window)) return "noul";
  return "choice";
}

function dispositionFor(characteristics: DecisionCandidate["characteristics"]): { disposition: Disposition; primitive?: Primitive; confidence: number } {
  if (characteristics.deterministic && !characteristics.semantic) return { disposition: "deterministic", confidence: 0.94 };
  if (characteristics.requiresGeneration || characteristics.requiresMultiStepReasoning || !characteristics.boundedOutputs) return { disposition: "llm", confidence: 0.72 };
  if (characteristics.semantic && characteristics.boundedOutputs) return { disposition: "jev", primitive: classifyPrimitive("", ""), confidence: 0.84 };
  return { disposition: "deterministic", confidence: 0.76 };
}

function makeQuestions(candidate: Pick<DecisionCandidate, "id" | "title" | "primitive" | "outputs">): DecisionCandidate["questions"] {
  if (!candidate.primitive) return [];
  if (candidate.primitive === "choice") {
    const criteria = Object.fromEntries((candidate.outputs.length ? candidate.outputs : ["first permitted action", "safe fallback", "review"]).map((value) => [value.replace(/\s+/g, "_"), `Choose ${value} only when it matches the current repository state.`]));
    return [{ id: `${candidate.id}.next`, type: "choice", question: `Which permitted outcome best matches the state at ${candidate.title}?`, criteria }];
  }
  if (candidate.primitive === "score") return [{ id: `${candidate.id}.degree`, type: "score", question: `How strongly does this code signal ${candidate.title.toLowerCase()}?`, criteria: ["low signal", "meaningful signal", "strong signal"] }];
  return [{ id: `${candidate.id}.gate`, type: "noul", question: `Does this state satisfy the semantic condition represented by ${candidate.title.toLowerCase()}?`, criteria: { yes: "The condition is present in the current state.", no: "The condition is absent or cannot be supported by the evidence." } }];
}

function detectCandidates(files: ScannedFile[]): DecisionCandidate[] {
  const candidates: DecisionCandidate[] = [];
  for (const file of files.filter((entry) => entry.language)) {
    const lines = file.lines;
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) return;
      const code = trimmed.split("//")[0].trim();
      const isSurface = semanticWords.test(code) || /\b(?:switch|case|if|else if)\b/.test(code) && /["'`]/.test(code);
      if (!isSurface) return;
      const startLine = index + 1;
      const endLine = Math.min(lines.length, startLine + 5);
      const window = lines.slice(Math.max(0, index - 3), Math.min(lines.length, index + 6)).join(" ");
      const titleSource = extractFunction(lines, index) || code.replace(/[{}();].*$/, "").slice(0, 72);
      const title = titleSource.replace(/^(async\s+)?function\s+/, "").replace(/\s+/g, " ").trim() || "Decision surface";
      const hasSwitch = /\bswitch\b|\bcase\b/.test(window);
      const outputs = collectOutputs(window);
      const semantic = semanticWords.test(`${title} ${window}`) && !numericWords.test(code);
      const deterministic = numericWords.test(code) && !semantic;
      const boundedOutputs = hasSwitch || outputs.length >= 2 || /route|router|handler|action|tool|status|mode/i.test(`${title} ${window}`);
      const requiresGeneration = generationWords.test(window);
      const requiresMultiStepReasoning = /\b(?:plan|planner|pipeline|workflow|recursive|while|for\s*\()/i.test(window);
      const characteristics = { semantic, deterministic, boundedOutputs, requiresGeneration, requiresMultiStepReasoning, frequency: /request|event|message|loop|handler/i.test(window) ? "runtime path; measure" : "unknown; measure" };
      const classified = dispositionFor(characteristics);
      const primitive = classified.disposition === "jev" ? classifyPrimitive(title, window) : undefined;
      const id = `DS-${String(candidates.length + 1).padStart(3, "0")}`;
      const excerpt = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 5)).map((value, offset) => `${String(startLine - 2 + offset).padStart(4, " ")}  ${value}`).join("\n");
      const evidence: Evidence[] = [{ type: "signal", file: file.path, startLine, endLine, excerpt, reason: semantic ? "Semantic vocabulary or a bounded route appears at this branch." : "A control-flow branch or exact comparison was found; keep it under deterministic authority." }];
      if (generationWords.test(file.content)) evidence.push({ type: "context", file: file.path, startLine, endLine, excerpt: "A generation or model call is present in this file.", reason: "Nearby model usage changes the replacement boundary." });
      const candidate: DecisionCandidate = {
        id,
        title: title.length > 64 ? `${title.slice(0, 61)}...` : title,
        summary: classified.disposition === "jev" ? "A bounded semantic choice that can be isolated behind a confidence gate." : classified.disposition === "llm" ? "The surface appears to require generation or multi-step reasoning." : "An exact rule or computation that should remain in ordinary code.",
        location: { file: file.path, function: extractFunction(lines, index), startLine, endLine },
        currentBehavior: code,
        inputs: ["local state", /request|message|input/i.test(window) ? "request or message context" : "branch context"],
        outputs: outputs.length ? outputs : boundedOutputs ? ["permitted branch", "fallback"] : ["boolean or numeric result"],
        characteristics,
        disposition: classified.disposition,
        primitive,
        confidence: classified.confidence,
        confidencePolicy: classified.disposition === "jev" ? "Auto-use only above 0.80; route lower-confidence outcomes to the existing implementation or human review." : "Not applicable until a replacement is proposed.",
        fallback: classified.disposition === "jev" ? "Retain the current implementation and record the uncertain case." : classified.disposition === "llm" ? "Keep the existing generation path and validate structured output." : "Keep this branch in deterministic code.",
        expectedImpact: { latency: classified.disposition === "jev" ? "Measure against current path" : "No replacement claim", cost: classified.disposition === "jev" ? "Measure per 10k decisions" : "No replacement claim", reliability: classified.disposition === "jev" ? "Compare agreement and fallback rate" : "Preserve current semantics" },
        evidence,
        questions: [],
      };
      candidate.questions = makeQuestions({ id, title: candidate.title, primitive, outputs: candidate.outputs });
      candidates.push(candidate);
    });
  }
  const unique = new Map<string, DecisionCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.location.file}:${candidate.location.startLine}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()].slice(0, 18);
}

function languageMix(files: ScannedFile[]) {
  const counts = new Map<string, number>();
  for (const file of files) if (file.language) counts.set(file.language, (counts.get(file.language) || 0) + 1);
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0) || 1;
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([language, files]) => ({ language, files, share: Number((files / total).toFixed(2)) }));
}

function dependencies(files: ScannedFile[]): string[] {
  const found = new Set<string>();
  for (const file of files) {
    if (["package.json", "pyproject.toml", "go.mod", "Cargo.toml"].includes(basename(file.path))) {
      for (const match of file.content.matchAll(/(?:"|from\s+|require\(|^\s*)(@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|[A-Za-z][A-Za-z0-9_.-]{2,})/gm)) {
        if (!new Set(["name", "version", "description", "dependencies", "devDependencies", "module", "go", "require", "python", "project"]).has(match[1])) found.add(match[1]);
      }
    }
    for (const match of file.content.matchAll(/(?:from|require\()\s*["']([^"']+)["']/g)) if (!match[1].startsWith(".")) found.add(match[1].split("/").slice(0, match[1].startsWith("@") ? 2 : 1).join("/"));
  }
  return [...found].slice(0, 18);
}

function architecture(files: ScannedFile[], candidates: DecisionCandidate[]) {
  const folders = new Map<string, number>();
  for (const file of files) {
    const top = file.path.includes("/") ? file.path.split("/")[0] : "root";
    folders.set(top, (folders.get(top) || 0) + 1);
  }
  const layers = [...folders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, count]) => ({ id, label: id === "root" ? "Repository root" : id, files: count, note: candidates.some((candidate) => candidate.location.file === id || candidate.location.file.startsWith(`${id}/`)) ? "Decision surfaces detected" : "No semantic surface ranked yet" }));
  const deps: { from: string; to: string; label: string }[] = [];
  for (const candidate of candidates.slice(0, 8)) {
    const from = candidate.location.file.includes("/") ? candidate.location.file.split("/")[0] : "root";
    const to = candidate.disposition === "jev" ? "semantic decision" : candidate.disposition === "llm" ? "generation / planning" : "deterministic rule";
    if (!deps.some((dep) => dep.from === from && dep.to === to)) deps.push({ from, to, label: candidate.id });
  }
  return { layers, dependencies: deps };
}

function buildTree(candidates: DecisionCandidate[], layers: ReturnType<typeof architecture>["layers"]): { nodes: TreeNode[]; edges: TreeEdge[] } {
  const nodes: TreeNode[] = [{ id: "repo", label: "Repository", kind: "root" }];
  const edges: TreeEdge[] = [];
  const usedLayers = new Set<string>();
  candidates.forEach((candidate) => {
    const layer = candidate.location.file.includes("/") ? candidate.location.file.split("/")[0] : "root";
    const layerId = `layer-${layer}`;
    if (!usedLayers.has(layerId)) {
      usedLayers.add(layerId);
      nodes.push({ id: layerId, label: layers.find((item) => item.id === layer)?.label || layer, kind: "layer" });
      edges.push({ id: `repo-${layerId}`, source: "repo", target: layerId });
    }
    const candidateId = `candidate-${candidate.id}`;
    nodes.push({ id: candidateId, label: candidate.title, kind: "candidate", candidateId: candidate.id, disposition: candidate.disposition });
    edges.push({ id: `${layerId}-${candidateId}`, source: layerId, target: candidateId });
    const outcomeId = `outcome-${candidate.id}`;
    const label = candidate.disposition === "jev" ? `Jev ${candidate.primitive}` : candidate.disposition === "llm" ? "LLM / generation" : "Keep code";
    nodes.push({ id: outcomeId, label, kind: "outcome", disposition: candidate.disposition });
    edges.push({ id: `${candidateId}-${outcomeId}`, source: candidateId, target: outcomeId, label: candidate.disposition === "jev" ? "bounded + semantic" : "classification" });
  });
  return { nodes, edges };
}

function mermaidTree(tree: { nodes: TreeNode[]; edges: TreeEdge[] }) {
  const lines = ["flowchart LR"];
  for (const node of tree.nodes) lines.push(`  ${node.id.replace(/-/g, "_")}["${node.label.replace(/["<>]/g, "")}"]`);
  for (const edge of tree.edges) lines.push(`  ${edge.source.replace(/-/g, "_")} -->${edge.label ? `|${edge.label}|` : ""} ${edge.target.replace(/-/g, "_")}`);
  return lines.join("\n");
}

function mermaidArchitecture(value: ReturnType<typeof architecture>) {
  const lines = ["flowchart TD", '  repo["Repository"]'];
  for (const layer of value.layers) lines.push(`  repo --> ${layer.id.replace(/[^A-Za-z0-9_]/g, "_")}["${layer.label} · ${layer.files} files"]`);
  for (const dep of value.dependencies) lines.push(`  ${dep.from.replace(/[^A-Za-z0-9_]/g, "_")} -->|${dep.label}| ${dep.to.replace(/[^A-Za-z0-9_]/g, "_")}`);
  return lines.join("\n");
}

function integrationPlan(candidates: DecisionCandidate[]) {
  const jev = candidates.filter((candidate) => candidate.disposition === "jev");
  const lines = ["# JevMap integration plan", "", "This is a review-ready plan generated from static evidence. It is not a patch and it does not grant Jev authority over deterministic policy.", "", "## Authority boundary", "", "Keep validation, permissions, arithmetic, persistence, side effects, and irreversible actions in ordinary code. Use Jev only to return a bounded judgment; gate low-confidence results and retain the existing implementation as fallback.", ""];
  if (!jev.length) lines.push("No Jev candidates were ranked in this repository. Revisit the LLM/generation surfaces separately and add labeled fixtures before changing the boundary.");
  for (const candidate of jev) lines.push(`## ${candidate.id} · ${candidate.title}\n\n- Location: \`${candidate.location.file}:${candidate.location.startLine}-${candidate.location.endLine}\`\n- Primitive: \`${candidate.primitive}\`\n- State: ${candidate.inputs.join(", ")}\n- Question: ${candidate.questions[0]?.question || "Define one narrow bounded question."}\n- Fallback: ${candidate.fallback}\n- Test: replay representative fixtures, compare agreement, latency, cost, and fallback rate.\n`);
  return lines.join("\n");
}

export function makeReport(params: { root: string; source: "sample" | "github"; url: string; name: string; description?: string; branch?: string; commit?: string; mode?: "static" | "typesafe" }): AnalysisReport {
  return { id: randomUUID(), analyzedAt: new Date().toISOString(), source: params.source, mode: params.mode || "static", repository: { name: params.name, url: params.url, description: params.description || "Public repository analyzed from a shallow checkout.", branch: params.branch || "main", commit: params.commit || "local-scan", files: 0, sourceFiles: 0, languageMix: [], dependencies: [] }, stats: { candidates: 0, jevCandidates: 0, deterministic: 0, llm: 0, evidenceLines: 0 }, candidates: [], architecture: { layers: [], dependencies: [] }, tree: { nodes: [], edges: [] }, artifacts: { decisionTreeMermaid: "", architectureMermaid: "", decisionMapMermaid: "", manifest: {}, integrationPlan: "", benchmark: { status: "scaffold", fixtures: [], metrics: ["agreement", "p50 latency", "p95 latency", "cost per 10k decisions", "fallback rate"] } } };
}

export async function analyzeRoot(params: { root: string; source: "sample" | "github"; url: string; name: string; description?: string; branch?: string; commit?: string; mode?: "static" | "typesafe" }): Promise<AnalysisReport> {
  const files = await walk(params.root);
  const candidates = detectCandidates(files);
  const arch = architecture(files, candidates);
  const tree = buildTree(candidates, arch.layers);
  const report = makeReport(params);
  report.repository = { ...report.repository, files: files.length, sourceFiles: files.filter((file) => file.language).length, languageMix: languageMix(files), dependencies: dependencies(files) };
  report.candidates = candidates;
  report.stats = { candidates: candidates.length, jevCandidates: candidates.filter((candidate) => candidate.disposition === "jev").length, deterministic: candidates.filter((candidate) => candidate.disposition === "deterministic").length, llm: candidates.filter((candidate) => candidate.disposition === "llm").length, evidenceLines: candidates.reduce((sum, candidate) => sum + candidate.evidence.reduce((inner, evidence) => inner + evidence.endLine - evidence.startLine + 1, 0), 0) };
  report.architecture = arch;
  report.tree = tree;
  report.artifacts = { decisionTreeMermaid: mermaidTree(tree), architectureMermaid: mermaidArchitecture(arch), decisionMapMermaid: mermaidTree(tree), manifest: { version: 1, source: params.url, mode: report.mode, generatedAt: report.analyzedAt, candidates: candidates.filter((candidate) => candidate.disposition === "jev").map((candidate) => ({ id: candidate.id, location: candidate.location, primitive: candidate.primitive, state: candidate.inputs, questions: candidate.questions, confidencePolicy: candidate.confidencePolicy, fallback: candidate.fallback, authorityBoundary: "Jev returns a judgment; application code validates and executes." })) }, integrationPlan: integrationPlan(candidates), benchmark: { status: "scaffold", fixtures: candidates.filter((candidate) => candidate.disposition === "jev").slice(0, 8).map((candidate) => ({ id: `FIX-${candidate.id}`, candidateId: candidate.id, input: "Add a representative state fixture from tests, traces, or production-safe logs.", expected: candidate.outputs[0] || "expected bounded outcome", status: "needs-fixture" })), metrics: ["agreement", "p50 latency", "p95 latency", "cost per 10k decisions", "fallback rate"] } };
  if (report.mode === "typesafe") await enrichWithJev(report);
  return report;
}

export async function analyzeGitHub(rawUrl: string): Promise<AnalysisReport> {
  const normalized = normalizeGitHubUrl(rawUrl);
  const checkout = join(tmpdir(), `jevmap-${randomUUID()}`);
  try {
    await run("git", ["clone", "--depth", "1", "--quiet", normalized.url, checkout], { timeout: 150_000, maxBuffer: 4_000_000 });
    const metadata = await run("git", ["-C", checkout, "rev-parse", "HEAD"], { timeout: 10_000 });
    let description = "Public repository analyzed from a shallow checkout.";
    try {
      const response = await fetch(`https://api.github.com/repos/${normalized.owner}/${normalized.repo}`, { headers: { "User-Agent": "jevmap" }, signal: AbortSignal.timeout(7000) });
      if (response.ok) {
        const value = await response.json() as { description?: string; default_branch?: string };
        description = value.description || description;
        return await analyzeRoot({ root: checkout, source: "github", url: `https://github.com/${normalized.owner}/${normalized.repo}`, name: normalized.repo, description, branch: value.default_branch || "main", commit: metadata.stdout.trim(), mode: process.env.TYPESAFE_API_KEY ? "typesafe" : "static" });
      }
    } catch {
      // Git content is enough to produce a useful map when GitHub metadata is unavailable.
    }
    return await analyzeRoot({ root: checkout, source: "github", url: `https://github.com/${normalized.owner}/${normalized.repo}`, name: normalized.repo, description, commit: metadata.stdout.trim(), mode: process.env.TYPESAFE_API_KEY ? "typesafe" : "static" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "clone failed";
    throw new Error(`Could not read that public repository. ${detail}`);
  } finally {
    await rm(checkout, { recursive: true, force: true }).catch(() => undefined);
  }
}
