import type { AnalysisReport, DecisionCandidate, TreeEdge, TreeNode } from "../analysis/schema";

const sampleCode = `export async function chooseNextAction(state: AgentState) {
  const candidates = await collectAvailableTools(state);
  const next = await model.generateObject({
    schema: z.enum(["search", "answer", "ask_user", "stop"]),
    prompt: buildRouterPrompt(state, candidates),
  });

  if (next.action === "stop" || state.budgetRemaining <= 0) {
    return { type: "finish", reason: "budget exhausted" };
  }

  return candidates.includes(next.action) ? next.action : "ask_user";
}`;

function candidate(partial: Partial<DecisionCandidate> & Pick<DecisionCandidate, "id" | "title" | "disposition">): DecisionCandidate {
  const defaultQuestions = partial.primitive === "noul"
    ? [{ id: `${partial.id}.gate`, type: "noul" as const, question: "Is this retrieved passage relevant to the current ticket?", criteria: { yes: "The passage materially helps answer the ticket.", no: "The passage is unrelated or too weak to use." } }]
    : partial.primitive === "score"
      ? [{ id: `${partial.id}.degree`, type: "score" as const, question: "How important is this event for review?", criteria: ["low signal", "meaningful signal", "strong signal"] }]
      : [{ id: `${partial.id}.next`, type: "choice" as const, question: "Which permitted action best matches the current agent state?", criteria: { search: "Gather more evidence.", answer: "Respond with available evidence.", ask_user: "Request missing information.", stop: "Stop safely." } }];
  return {
    id: partial.id,
    title: partial.title,
    summary: partial.summary || "A bounded surface found in the repository.",
    location: partial.location || { file: "src/agent/router.ts", function: "chooseNextAction", startLine: 3, endLine: 14 },
    currentBehavior: partial.currentBehavior || "const next = await model.generateObject({ schema: z.enum([...]) });",
    inputs: partial.inputs || ["agent state", "available tools"],
    outputs: partial.outputs || ["search", "answer", "ask_user", "stop"],
    characteristics: partial.characteristics || { semantic: true, deterministic: false, boundedOutputs: true, requiresGeneration: false, requiresMultiStepReasoning: false, frequency: "request path; measure" },
    disposition: partial.disposition,
    primitive: partial.primitive,
    confidence: partial.confidence ?? 0.86,
    confidencePolicy: partial.confidencePolicy || "Auto-use above 0.80; preserve the existing path below the threshold.",
    fallback: partial.fallback || "Keep the current implementation and record the uncertain state.",
    expectedImpact: partial.expectedImpact || { latency: "Measure against current path", cost: "Measure per 10k decisions", reliability: "Compare agreement and fallback rate" },
    evidence: partial.evidence || [{ type: "signal", file: "src/agent/router.ts", startLine: 3, endLine: 14, excerpt: sampleCode, reason: "A model chooses one action from a closed enum, making the output space explicit." }],
    questions: partial.questions || defaultQuestions,
  };
}

function treeFor(candidates: DecisionCandidate[]): { nodes: TreeNode[]; edges: TreeEdge[] } {
  const nodes: TreeNode[] = [
    { id: "repo", label: "Acme support agent", kind: "root" },
    { id: "layer-agent", label: "agent", kind: "layer" },
    { id: "layer-api", label: "api", kind: "layer" },
    { id: "layer-observability", label: "observability", kind: "layer" },
  ];
  const edges: TreeEdge[] = [
    { id: "repo-agent", source: "repo", target: "layer-agent" },
    { id: "repo-api", source: "repo", target: "layer-api" },
    { id: "repo-observability", source: "repo", target: "layer-observability" },
  ];
  for (const item of candidates) {
    const layer = item.location.file.includes("router") || item.location.file.includes("planner") ? "layer-agent" : item.location.file.includes("api") ? "layer-api" : "layer-observability";
    const nodeId = `candidate-${item.id}`;
    const outcomeId = `outcome-${item.id}`;
    nodes.push({ id: nodeId, label: item.title, kind: "candidate", candidateId: item.id, disposition: item.disposition });
    nodes.push({ id: outcomeId, label: item.disposition === "jev" ? `Jev ${item.primitive}` : item.disposition === "llm" ? "LLM / generation" : "Keep code", kind: "outcome", disposition: item.disposition });
    edges.push({ id: `${layer}-${nodeId}`, source: layer, target: nodeId });
    edges.push({ id: `${nodeId}-${outcomeId}`, source: nodeId, target: outcomeId, label: item.disposition === "jev" ? "bounded judgment" : "authority boundary" });
  }
  return { nodes, edges };
}

export function createSampleAnalysis(): AnalysisReport {
  const candidates = [
    candidate({ id: "DS-001", title: "chooseNextAction", disposition: "jev", primitive: "choice", summary: "The agent asks a generative model to select one action from four permitted outcomes.", location: { file: "src/agent/router.ts", function: "chooseNextAction", startLine: 3, endLine: 14 }, currentBehavior: "const next = await model.generateObject({ schema: z.enum([...]) });", outputs: ["search", "answer", "ask_user", "stop"], evidence: [{ type: "signal", file: "src/agent/router.ts", startLine: 3, endLine: 14, excerpt: sampleCode, reason: "A model chooses one action from a closed enum, making the output space explicit." }, { type: "dependency", file: "package.json", startLine: 22, endLine: 25, excerpt: '"ai": "^4.2.0",\n"zod": "^3.23.0"', reason: "The current path already pays for a structured model call and schema parsing." }] }),
    candidate({ id: "DS-002", title: "isRelevantToTicket", disposition: "jev", primitive: "noul", summary: "A relevance gate decides whether retrieved context should reach the answer composer.", location: { file: "src/retrieval/relevance.ts", function: "isRelevantToTicket", startLine: 18, endLine: 31 }, currentBehavior: "return similarity > 0.58 || looksLikePolicy(text);", inputs: ["ticket text", "retrieved passage"], outputs: ["keep context", "drop context"], evidence: [{ type: "signal", file: "src/retrieval/relevance.ts", startLine: 18, endLine: 31, excerpt: "export function isRelevantToTicket(ticket: string, text: string) {\n  const similarity = cosine(ticket, text);\n  return similarity > 0.58 || looksLikePolicy(text);\n}", reason: "A heuristic threshold is standing in for a semantic relevance judgment." }] }),
    candidate({ id: "DS-003", title: "scoreLogImportance", disposition: "jev", primitive: "score", summary: "A hand-authored severity score ranks which events deserve review.", location: { file: "src/observability/importance.ts", function: "scoreLogImportance", startLine: 7, endLine: 20 }, currentBehavior: "return error ? 3 : warning ? 2 : info ? 1 : 0;", inputs: ["log event", "request context"], outputs: ["low", "medium", "high", "critical"], evidence: [{ type: "signal", file: "src/observability/importance.ts", startLine: 7, endLine: 20, excerpt: "export function scoreLogImportance(event: LogEvent) {\n  const { error, warning, info } = event;\n  return error ? 3 : warning ? 2 : info ? 1 : 0;\n}", reason: "The ordered output is a candidate for a bounded semantic score, but must be benchmarked against labeled events." }] }),
    candidate({ id: "DS-004", title: "retryBudget", disposition: "deterministic", summary: "A numeric budget check should remain exact and policy-controlled.", location: { file: "src/agent/retry.ts", function: "retryBudget", startLine: 9, endLine: 13 }, currentBehavior: "return attempts < MAX_ATTEMPTS && elapsedMs < TIMEOUT_MS;", inputs: ["attempt count", "elapsed time"], outputs: ["retry", "stop"], characteristics: { semantic: false, deterministic: true, boundedOutputs: true, requiresGeneration: false, requiresMultiStepReasoning: false, frequency: "runtime path; measure" }, confidence: 0.96, evidence: [{ type: "signal", file: "src/agent/retry.ts", startLine: 9, endLine: 13, excerpt: "return attempts < MAX_ATTEMPTS && elapsedMs < TIMEOUT_MS;", reason: "Exact arithmetic and policy thresholds are deterministic authority." }] }),
    candidate({ id: "DS-005", title: "planResolution", disposition: "llm", summary: "The planner emits multi-step work and should not be collapsed into a single Jev question.", location: { file: "src/agent/planner.ts", function: "planResolution", startLine: 11, endLine: 29 }, currentBehavior: "return model.generate({ prompt: buildPlanPrompt(ticket) });", inputs: ["ticket", "available tools", "history"], outputs: ["generated plan"], characteristics: { semantic: true, deterministic: false, boundedOutputs: false, requiresGeneration: true, requiresMultiStepReasoning: true, frequency: "request path; measure" }, confidence: 0.78, evidence: [{ type: "signal", file: "src/agent/planner.ts", startLine: 11, endLine: 29, excerpt: "return model.generate({ prompt: buildPlanPrompt(ticket) });", reason: "Open-ended generation and multi-step planning are outside Jev's bounded judgment role." }] }),
  ];
  const tree = treeFor(candidates);
  const analyzedAt = new Date().toISOString();
  return {
    id: "sample-jevmap",
    analyzedAt,
    source: "sample",
    mode: "static",
    repository: { name: "acme-support-agent", url: "sample://acme-support-agent", description: "A deliberately small demo repo with routing, retrieval, observability, retry policy, and planning surfaces.", branch: "main", commit: "sample-commit", files: 42, sourceFiles: 31, languageMix: [{ language: "TypeScript", files: 24, share: 0.77 }, { language: "JavaScript", files: 4, share: 0.13 }, { language: "JSON", files: 3, share: 0.1 }], dependencies: ["ai", "zod", "express", "pino"] },
    stats: { candidates: candidates.length, jevCandidates: 3, deterministic: 1, llm: 1, evidenceLines: 32 },
    candidates,
    architecture: { layers: [{ id: "agent", label: "agent", files: 14, note: "Routing, retry policy, and planning surfaces" }, { id: "api", label: "api", files: 9, note: "Request boundary and validation" }, { id: "observability", label: "observability", files: 5, note: "Event severity and review routing" }, { id: "tests", label: "tests", files: 8, note: "Fixture source for future benchmarks" }], dependencies: [{ from: "agent", to: "semantic decision", label: "DS-001" }, { from: "observability", to: "semantic decision", label: "DS-003" }, { from: "agent", to: "deterministic rule", label: "DS-004" }, { from: "agent", to: "generation / planning", label: "DS-005" }] },
    tree,
    artifacts: {
      decisionTreeMermaid: "flowchart LR\n  repo[\"Acme support agent\"] --> agent[\"agent\"]\n  repo --> api[\"api\"]\n  repo --> observability[\"observability\"]\n  agent --> DS_001[\"chooseNextAction\"]\n  DS_001 -->|bounded judgment| outcome_1[\"Jev choice\"]\n  agent --> DS_004[\"retryBudget\"]\n  DS_004 -->|authority boundary| outcome_4[\"Keep code\"]\n  observability --> DS_003[\"scoreLogImportance\"]\n  DS_003 -->|bounded judgment| outcome_3[\"Jev score\"]",
      architectureMermaid: "flowchart TD\n  repo[\"Acme support agent\"]\n  repo --> agent[\"agent · 14 files\"]\n  repo --> api[\"api · 9 files\"]\n  repo --> observability[\"observability · 5 files\"]\n  repo --> tests[\"tests · 8 files\"]\n  agent -->|DS-001| semantic[\"semantic decision\"]\n  agent -->|DS-004| deterministic[\"deterministic rule\"]\n  agent -->|DS-005| generation[\"generation / planning\"]",
      decisionMapMermaid: "flowchart TD\n  root[\"Decision surface\"] --> deterministic[\"Deterministic?\"]\n  deterministic -->|yes| keep[\"Keep code\"]\n  deterministic -->|no| bounded[\"Closed output set?\"]\n  bounded -->|yes| jev[\"Jev candidate\"]\n  bounded -->|no| llm[\"LLM / generation\"]\n  jev --> noul[\"noul · binary\"]\n  jev --> choice[\"choice · one of N\"]\n  jev --> score[\"score · ordered degree\"]",
      manifest: { version: 1, source: "sample://acme-support-agent", mode: "static", generatedAt: analyzedAt, candidates: candidates.filter((item) => item.disposition === "jev").map((item) => ({ id: item.id, location: item.location, primitive: item.primitive, state: item.inputs, questions: item.questions, confidencePolicy: item.confidencePolicy, fallback: item.fallback, authorityBoundary: "Jev returns a judgment; application code validates and executes." })) },
      integrationPlan: "# JevMap integration plan\n\nThis sample is ready for a review pass. Keep deterministic policy and generation outside Jev.\n\n## DS-001 · chooseNextAction\n\n- Location: `src/agent/router.ts:3-14`\n- Primitive: `choice`\n- Fallback: Keep the current implementation and record the uncertain state.\n- Test: replay labeled agent states and compare agreement, latency, cost, and fallback rate.\n\n## DS-002 · isRelevantToTicket\n\n- Location: `src/retrieval/relevance.ts:18-31`\n- Primitive: `noul`\n- Fallback: Keep the heuristic and route uncertainty to review.\n\n## DS-003 · scoreLogImportance\n\n- Location: `src/observability/importance.ts:7-20`\n- Primitive: `score`\n- Fallback: Preserve the existing severity score until agreement is measured.\n",
      benchmark: { status: "scaffold", fixtures: candidates.filter((item) => item.disposition === "jev").map((item) => ({ id: `FIX-${item.id}`, candidateId: item.id, input: "Add a representative state fixture from tests, traces, or production-safe logs.", expected: item.outputs[0], status: "needs-fixture" })), metrics: ["agreement", "p50 latency", "p95 latency", "cost per 10k decisions", "fallback rate"] },
    },
  };
}
