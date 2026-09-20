import { describe, expect, it } from "vitest";
import { normalizeGitHubUrl } from "../server/analyzer";
import { createSampleAnalysis } from "../src/demo/sampleData";

describe("GitHub URL normalization", () => {
  it("accepts a public repository URL and strips the optional .git suffix", () => {
    expect(normalizeGitHubUrl("https://github.com/acme/widget.git")).toEqual({
      url: "https://github.com/acme/widget.git",
      owner: "acme",
      repo: "widget",
    });
  });

  it("rejects non-GitHub hosts", () => {
    expect(() => normalizeGitHubUrl("https://gitlab.com/acme/widget")).toThrow(/github.com/);
  });
});

describe("sample analysis contract", () => {
  it("keeps the three authority boundaries visible", () => {
    const report = createSampleAnalysis();
    expect(report.stats.jevCandidates).toBe(3);
    expect(report.candidates.some((candidate) => candidate.disposition === "deterministic")).toBe(true);
    expect(report.candidates.some((candidate) => candidate.disposition === "llm")).toBe(true);
    expect(report.candidates.filter((candidate) => candidate.disposition === "jev").every((candidate) => candidate.primitive)).toBe(true);
    expect(report.artifacts.manifest.candidates).toHaveLength(3);
    expect(report.artifacts.benchmark.status).toBe("scaffold");
  });
});
