import { z } from "zod";

export const primitiveSchema = z.enum(["noul", "choice", "score"]);
export type Primitive = z.infer<typeof primitiveSchema>;

export const dispositionSchema = z.enum(["jev", "deterministic", "llm"]);
export type Disposition = z.infer<typeof dispositionSchema>;

export const evidenceSchema = z.object({
  type: z.enum(["signal", "context", "dependency", "architecture"]),
  file: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  excerpt: z.string(),
  reason: z.string(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const questionSchema = z.object({
  id: z.string(),
  type: primitiveSchema,
  question: z.string(),
  criteria: z.record(z.string()).or(z.array(z.string())),
});
export type JevQuestion = z.infer<typeof questionSchema>;

export const candidateSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  location: z.object({
    file: z.string(),
    function: z.string().optional(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  }),
  currentBehavior: z.string(),
  inputs: z.array(z.string()),
  outputs: z.array(z.string()),
  characteristics: z.object({
    semantic: z.boolean(),
    deterministic: z.boolean(),
    boundedOutputs: z.boolean(),
    requiresGeneration: z.boolean(),
    requiresMultiStepReasoning: z.boolean(),
    frequency: z.string(),
  }),
  disposition: dispositionSchema,
  primitive: primitiveSchema.optional(),
  confidence: z.number().min(0).max(1),
  confidencePolicy: z.string(),
  fallback: z.string(),
  expectedImpact: z.object({
    latency: z.string(),
    cost: z.string(),
    reliability: z.string(),
  }),
  evidence: z.array(evidenceSchema),
  questions: z.array(questionSchema),
});
export type DecisionCandidate = z.infer<typeof candidateSchema>;

export const treeNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["root", "layer", "candidate", "outcome"]),
  candidateId: z.string().optional(),
  disposition: dispositionSchema.optional(),
});
export type TreeNode = z.infer<typeof treeNodeSchema>;

export const treeEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
});
export type TreeEdge = z.infer<typeof treeEdgeSchema>;

export const analysisSchema = z.object({
  id: z.string(),
  analyzedAt: z.string(),
  source: z.enum(["sample", "github"]),
  mode: z.enum(["static", "typesafe"]),
  repository: z.object({
    name: z.string(),
    url: z.string(),
    description: z.string(),
    branch: z.string(),
    commit: z.string(),
    files: z.number().int().nonnegative(),
    sourceFiles: z.number().int().nonnegative(),
    languageMix: z.array(z.object({ language: z.string(), files: z.number().int().nonnegative(), share: z.number().min(0).max(1) })),
    dependencies: z.array(z.string()),
  }),
  stats: z.object({
    candidates: z.number().int().nonnegative(),
    jevCandidates: z.number().int().nonnegative(),
    deterministic: z.number().int().nonnegative(),
    llm: z.number().int().nonnegative(),
    evidenceLines: z.number().int().nonnegative(),
  }),
  candidates: z.array(candidateSchema),
  architecture: z.object({
    layers: z.array(z.object({ id: z.string(), label: z.string(), files: z.number().int().nonnegative(), note: z.string() })),
    dependencies: z.array(z.object({ from: z.string(), to: z.string(), label: z.string() })),
  }),
  tree: z.object({ nodes: z.array(treeNodeSchema), edges: z.array(treeEdgeSchema) }),
  artifacts: z.object({
    decisionTreeMermaid: z.string(),
    architectureMermaid: z.string(),
    decisionMapMermaid: z.string(),
    manifest: z.record(z.unknown()),
    integrationPlan: z.string(),
    benchmark: z.object({
      status: z.enum(["scaffold", "ready"]),
      fixtures: z.array(z.object({ id: z.string(), candidateId: z.string(), input: z.string(), expected: z.string(), status: z.enum(["needs-fixture", "ready"]) })),
      metrics: z.array(z.string()),
    }),
  }),
});
export type AnalysisReport = z.infer<typeof analysisSchema>;

export const analyzeRequestSchema = z.object({
  url: z.string().url().optional(),
  sample: z.boolean().optional(),
});
