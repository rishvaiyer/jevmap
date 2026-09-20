# JevMap

JevMap analyzes a public GitHub repository and turns its meaningful decision points into an evidence-backed Jev transformation map.

It is deliberately not a repo-chat wrapper. The analyzer keeps deterministic code in charge of exact rules, arithmetic, policy, validation, permissions, and irreversible actions. Jev is considered only for bounded semantic judgments with an enumerable output space. Open-ended generation and multi-step planning remain LLM territory.

## What works

- Public GitHub URL ingestion with a shallow clone.
- Source inventory, language mix, dependency hints, and architecture grouping.
- Heuristic decision-surface detection with real file and line citations.
- Explicit recommendation: `Jev`, `keep deterministic`, or `LLM / generation`.
- Primitive classification: `noul`, `choice`, or `score`.
- Interactive decision tree, architecture view, evidence inspector, Mermaid exports, Jev manifest, integration plan, and benchmark scaffolding.
- Optional TypeSafe `jev-latest` enrichment through `@typesafe-ai/sdk`; static mode remains fully usable without a key.
- Sample repository mode for a fast demo.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`.

To enable the optional Jev pass, set `TYPESAFE_API_KEY` in `.env`. The key is read server-side only. The app does not persist repository contents or API credentials.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## CLI-style HTTP API

`POST /api/analyze` with `{ "url": "https://github.com/owner/repo" }` returns the complete report object. `GET /api/sample` returns the built-in demo analysis.

## Product boundary

Analysis is evidence, not an automatic patch. JevMap proposes a bounded question and a fallback policy. The repository owner still decides whether to integrate it, and the generated benchmark is intentionally a scaffold until measured against the target system.
