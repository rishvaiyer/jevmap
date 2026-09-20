import express from "express";
import cors from "cors";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeRequestSchema } from "../src/analysis/schema";
import { analyzeGitHub } from "./analyzer";
import { createSampleAnalysis } from "../src/demo/sampleData";

const app = express();
const port = Number(process.env.PORT || 8787);
const currentDir = fileURLToPath(new URL(".", import.meta.url));

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => response.json({ ok: true, service: "jevmap", typesafe: Boolean(process.env.TYPESAFE_API_KEY) }));
app.get("/api/sample", (_request, response) => response.json(createSampleAnalysis()));
app.post("/api/analyze", async (request, response) => {
  const parsed = analyzeRequestSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "Send a public GitHub URL in the form { url }." });
  if (parsed.data.sample) return response.json(createSampleAnalysis());
  if (!parsed.data.url) return response.status(400).json({ error: "A GitHub URL is required." });
  try {
    const report = await analyzeGitHub(parsed.data.url);
    return response.json(report);
  } catch (error) {
    return response.status(422).json({ error: error instanceof Error ? error.message : "Analysis failed." });
  }
});

const clientDist = join(currentDir, "../client");
app.use(express.static(clientDist));
app.use((_request, response) => response.sendFile(join(clientDist, "index.html")));

app.listen(port, () => console.log(`JevMap server listening on http://localhost:${port}`));
