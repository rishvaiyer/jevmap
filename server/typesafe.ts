import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";
import type { AnalysisReport } from "../src/analysis/schema";

export async function enrichWithJev(report: AnalysisReport): Promise<void> {
  if (!process.env.TYPESAFE_API_KEY) return;
  const candidates = report.candidates.filter((candidate) => candidate.disposition !== "deterministic").slice(0, 8);
  if (!candidates.length) return;
  const client = new TypeSafeClient();
  try {
    const response = await client.systemOne({
      state: {
        repository: report.repository,
        decisionSurfaces: candidates.map((candidate) => ({ id: candidate.id, title: candidate.title, evidence: candidate.evidence, characteristics: candidate.characteristics })),
      },
      questions: {
        bestBoundary: choice("Which authority boundary best fits these discovered decision surfaces?", { jev: "Bounded semantic judgments with enumerable outcomes and a safe fallback.", deterministic: "Exact rules, arithmetic, validation, permissions, or policy.", llm: "Open-ended generation or multi-step reasoning." }),
        semanticFit: noul("Do at least some of the discovered surfaces require a small semantic judgment rather than exact computation?", { true: "There is a meaningful semantic decision in the evidence.", false: "The evidence is fully deterministic or generative." }),
        opportunityStrength: score("How strong is the overall case for testing Jev at the discovered bounded decision surfaces?", ["weak opportunity", "mixed opportunity", "strong opportunity"]),
      },
    } as any);
    const answers = response.answers as Record<string, any>;
    const boundary = answers?.bestBoundary?.choice as string | undefined;
    const fit = answers?.semanticFit?.noul as number | undefined;
    const strength = answers?.opportunityStrength?.score as number | undefined;
    if (boundary === "jev" && (fit ?? 0) >= 0.55) report.mode = "typesafe";
    if (typeof strength === "number") {
      const adjustment = Math.max(-0.06, Math.min(0.06, (strength - 1) * 0.03));
      for (const candidate of candidates) candidate.confidence = Math.max(0, Math.min(1, candidate.confidence + adjustment));
    }
  } catch {
    // A failed optional enrichment must never make static analysis unavailable.
    report.mode = "static";
  }
}
