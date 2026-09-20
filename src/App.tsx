import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Braces,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Code2,
  Copy,
  FileCode2,
  GitBranch,
  GitFork,
  Layers3,
  LoaderCircle,
  Moon,
  Network,
  Play,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  TreePine,
  X,
  Zap,
} from "lucide-react";
import type { LucideProps } from "lucide-react";
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { createSampleAnalysis } from "./demo/sampleData";
import type { AnalysisReport, DecisionCandidate, Disposition, TreeNode } from "./analysis/schema";

type View = "overview" | "tree" | "architecture" | "manifest" | "benchmark";
type Icon = ComponentType<LucideProps>;

const initialReport = createSampleAnalysis();

const navItems: { id: View; label: string; icon: Icon }[] = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "tree", label: "Decision tree", icon: TreePine },
  { id: "architecture", label: "Architecture", icon: Network },
  { id: "manifest", label: "Jev manifest", icon: Braces },
  { id: "benchmark", label: "Benchmark", icon: SlidersHorizontal },
];

function statusLabel(disposition: Disposition) {
  if (disposition === "jev") return "Jev candidate";
  if (disposition === "llm") return "LLM / generation";
  return "Keep deterministic";
}

function StatusBadge({ disposition }: { disposition: Disposition }) {
  return <span className={`status status-${disposition}`}>{statusLabel(disposition)}</span>;
}

function dispositionIcon(disposition: Disposition) {
  if (disposition === "jev") return <Sparkles size={14} strokeWidth={1.8} />;
  if (disposition === "llm") return <Zap size={14} strokeWidth={1.8} />;
  return <ShieldCheck size={14} strokeWidth={1.8} />;
}

function downloadText(filename: string, content: string, type = "text/plain") {
  const blob = new Blob([content], { type });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Clipboard permissions are optional; the visible source remains available.
  }
}

function Metric({ label, value, detail, icon: IconComponent }: { label: string; value: string | number; detail: string; icon: Icon }) {
  return (
    <div className="metric">
      <div className="metric-label"><IconComponent size={15} /> {label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-detail">{detail}</div>
    </div>
  );
}

function CandidateList({ report, selectedId, onSelect }: { report: AnalysisReport; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <div className="candidate-list" aria-label="Decision surfaces">
      {report.candidates.map((candidate) => (
        <button className={`candidate-row ${candidate.id === selectedId ? "selected" : ""}`} key={candidate.id} onClick={() => onSelect(candidate.id)}>
          <div className={`candidate-icon icon-${candidate.disposition}`}>{dispositionIcon(candidate.disposition)}</div>
          <div className="candidate-copy">
            <div className="candidate-title">{candidate.title}</div>
            <div className="candidate-location">{candidate.location.file}:{candidate.location.startLine}</div>
          </div>
          <ChevronRight size={16} className="candidate-arrow" />
        </button>
      ))}
    </div>
  );
}

function CodeEvidence({ candidate }: { candidate: DecisionCandidate }) {
  const evidence = candidate.evidence[0];
  return (
    <section className="evidence-section">
      <div className="section-heading">
        <div>
          <h3>Evidence</h3>
          <p>Static signal from the checked-out source.</p>
        </div>
        <button className="icon-button" title="Copy evidence" aria-label="Copy evidence" onClick={() => copyText(evidence.excerpt)}><Copy size={16} /></button>
      </div>
      <div className="code-frame">
        <div className="code-toolbar"><FileCode2 size={14} /> {evidence.file}<span>{evidence.startLine}-{evidence.endLine}</span></div>
        <pre>{evidence.excerpt}</pre>
      </div>
      <p className="evidence-reason"><CircleCheck size={15} /> {evidence.reason}</p>
      {candidate.evidence.slice(1).map((item) => <div className="secondary-evidence" key={`${item.file}-${item.startLine}`}><GitFork size={14} /><span>{item.reason}</span><code>{item.file}:{item.startLine}</code></div>)}
    </section>
  );
}

function CandidateInspector({ candidate }: { candidate: DecisionCandidate }) {
  return (
    <div className="inspector-content">
      <div className="inspector-topline"><StatusBadge disposition={candidate.disposition} /><span className="confidence">{Math.round(candidate.confidence * 100)}% confidence</span></div>
      <h2>{candidate.title}</h2>
      <p className="inspector-summary">{candidate.summary}</p>
      <div className="location-line"><Code2 size={15} /> <code>{candidate.location.file}:{candidate.location.startLine}-{candidate.location.endLine}</code>{candidate.location.function && <span>· {candidate.location.function}()</span>}</div>

      <div className="boundary-box">
        <div className="boundary-heading"><ShieldCheck size={16} /> Authority boundary</div>
        <p>{candidate.disposition === "jev" ? "Jev may return the judgment. Application code still validates the output and owns any side effect." : candidate.disposition === "llm" ? "Keep generation and multi-step reasoning with the existing model or workflow." : "This is exact policy or computation. Keep it in ordinary code."}</p>
      </div>

      <div className="inspector-grid">
        <div><dt>Primitive</dt><dd>{candidate.primitive || "—"}</dd></div>
        <div><dt>Output shape</dt><dd>{candidate.outputs.join(" · ")}</dd></div>
        <div><dt>Inputs</dt><dd>{candidate.inputs.join(" · ")}</dd></div>
        <div><dt>Runtime</dt><dd>{candidate.characteristics.frequency}</dd></div>
      </div>

      {candidate.disposition === "jev" && <div className="question-block"><div className="section-label">Proposed question</div><p>{candidate.questions[0]?.question}</p><div className="criteria-list">{candidate.questions[0] && (Array.isArray(candidate.questions[0].criteria) ? candidate.questions[0].criteria.map((item) => <div key={item}><span>·</span>{item}</div>) : Object.entries(candidate.questions[0].criteria).map(([key, value]) => <div key={key}><span>{key}</span>{value}</div>))}</div></div>}

      <div className="policy-row"><div><span className="section-label">Confidence policy</span><p>{candidate.confidencePolicy}</p></div><div><span className="section-label">Fallback</span><p>{candidate.fallback}</p></div></div>
      <CodeEvidence candidate={candidate} />
    </div>
  );
}

function TreeNodeCard({ data }: NodeProps) {
  const node = data as TreeNode & { onSelect?: (id: string) => void };
  return (
    <div className={`flow-node flow-${node.kind} ${node.disposition ? `flow-${node.disposition}` : ""}`} onClick={() => node.candidateId && node.onSelect?.(node.candidateId)}>
      {node.kind !== "root" && <Handle type="target" position={Position.Left} />}
      <div className="flow-node-kicker">{node.kind === "root" ? "Repository" : node.kind === "layer" ? "Area" : node.kind === "candidate" ? "Decision surface" : "Recommendation"}</div>
      <div className="flow-node-label">{node.label}</div>
      {node.kind === "candidate" && node.disposition && <div className="flow-node-status">{statusLabel(node.disposition)}</div>}
      {node.kind !== "outcome" && <Handle type="source" position={Position.Right} />}
    </div>
  );
}

const nodeTypes = { decision: TreeNodeCard };

function DecisionCanvas({ report, selectedId, onSelect }: { report: AnalysisReport; selectedId: string; onSelect: (id: string) => void }) {
  const nodes = useMemo<Node[]>(() => {
    const counts: Record<string, number> = {};
    return report.tree.nodes.map((node) => {
      const column = node.kind === "root" ? 0 : node.kind === "layer" ? 1 : node.kind === "candidate" ? 2 : 3;
      const key = `${node.kind}-${column}`;
      const row = counts[key] || 0;
      counts[key] = row + 1;
      return { id: node.id, type: "decision", position: { x: column * 270 + 20, y: row * 125 + (column === 0 ? 200 : 30) }, data: { ...node, onSelect } };
    });
  }, [report.tree.nodes, onSelect]);
  const edges = useMemo<Edge[]>(() => report.tree.edges.map((edge) => ({ ...edge, animated: edge.target === `candidate-${selectedId}`, style: { stroke: edge.target === `candidate-${selectedId}` ? "var(--accent)" : "var(--line-strong)", strokeWidth: edge.target === `candidate-${selectedId}` ? 2 : 1.3 }, labelStyle: { fill: "var(--muted)", fontSize: 10 }, labelBgStyle: { fill: "var(--surface)" } })), [report.tree.edges, selectedId]);
  return <div className="flow-wrap"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.2 }} proOptions={{ hideAttribution: true }}><Background color="var(--line)" gap={28} size={1} /><Controls showInteractive={false} /><MiniMap nodeColor={(node) => node.id.includes("outcome") ? "#d98a63" : "#7c776f"} maskColor="rgba(0, 0, 0, 0.08)" /></ReactFlow><div className="flow-key"><span><i className="key-dot key-jev" />Jev candidate</span><span><i className="key-dot key-deterministic" />Keep code</span><span><i className="key-dot key-llm" />LLM / generation</span></div></div>;
}

function MermaidBlock({ title, value, filename }: { title: string; value: string; filename: string }) {
  return <section className="mermaid-block"><div className="section-heading"><div><h3>{title}</h3><p>Exportable Mermaid source.</p></div><div className="button-group"><button className="text-button" onClick={() => copyText(value)}><Copy size={14} /> Copy</button><button className="text-button" onClick={() => downloadText(filename, value)}><ArrowDownToLine size={14} /> Download</button></div></div><pre className="mermaid-code">{value}</pre></section>;
}

function Overview({ report, selectedId, onSelect }: { report: AnalysisReport; selectedId: string; onSelect: (id: string) => void }) {
  const selected = report.candidates.find((candidate) => candidate.id === selectedId) || report.candidates[0];
  return <div className="overview-grid"><section className="overview-main"><div className="section-heading section-heading-large"><div><h2>Decision surfaces</h2><p>Every recommendation is tied to a file, a line, and a boundary.</p></div><span className="result-count">{report.candidates.length} found</span></div><CandidateList report={report} selectedId={selected?.id || ""} onSelect={onSelect} /><div className="method-note"><ShieldCheck size={17} /><div><strong>Authority stays in code</strong><p>JevMap uses static evidence to locate bounded judgments. It does not recommend Jev for exact thresholds or open-ended planning.</p></div></div></section><aside className="inspector"><CandidateInspector candidate={selected} /></aside></div>;
}

function ArchitectureView({ report }: { report: AnalysisReport }) {
  return <div className="architecture-view"><div className="section-heading section-heading-large"><div><h2>Repository architecture</h2><p>A compact map of where decision surfaces sit in the source tree.</p></div><button className="text-button" onClick={() => downloadText("architecture.mmd", report.artifacts.architectureMermaid)}><ArrowDownToLine size={14} /> Mermaid</button></div><div className="architecture-grid"><div className="layer-list">{report.architecture.layers.map((layer) => <div className="layer-row" key={layer.id}><div className="layer-icon"><Layers3 size={16} /></div><div><strong>{layer.label}</strong><p>{layer.note}</p></div><span>{layer.files} files</span></div>)}</div><div className="dependency-list"><div className="section-label">Observed edges</div>{report.architecture.dependencies.map((dependency) => <div className="dependency-row" key={`${dependency.from}-${dependency.to}-${dependency.label}`}><code>{dependency.from}</code><ArrowUpRight size={14} /><span>{dependency.to}</span><small>{dependency.label}</small></div>)}</div></div><MermaidBlock title="Architecture diagram" value={report.artifacts.architectureMermaid} filename="architecture.mmd" /></div>;
}

function ManifestView({ report }: { report: AnalysisReport }) {
  const value = JSON.stringify(report.artifacts.manifest, null, 2);
  return <div className="artifact-view"><div className="section-heading section-heading-large"><div><h2>Jev manifest</h2><p>A typed handoff for a human-reviewed integration.</p></div><div className="button-group"><button className="text-button" onClick={() => copyText(value)}><Copy size={14} /> Copy JSON</button><button className="text-button" onClick={() => downloadText("jev-manifest.json", value, "application/json")}><ArrowDownToLine size={14} /> Download</button></div></div><div className="manifest-callout"><CircleAlert size={17} /><p>The manifest describes candidate questions and fallbacks. It intentionally grants Jev no authority over validation, permissions, persistence, or side effects.</p></div><pre className="artifact-code">{value}</pre><MermaidBlock title="Decision map" value={report.artifacts.decisionMapMermaid} filename="decision-map.mmd" /></div>;
}

function BenchmarkView({ report }: { report: AnalysisReport }) {
  return <div className="benchmark-view"><div className="section-heading section-heading-large"><div><h2>Benchmark scaffold</h2><p>Measure the replacement against the repository's actual behavior.</p></div><span className="status status-neutral">Needs fixtures</span></div><div className="benchmark-intro"><div className="benchmark-number">{report.artifacts.benchmark.fixtures.length}</div><div><strong>candidate fixtures to define</strong><p>JevMap will not invent accuracy, latency, cost, or fallback numbers. Add representative states from tests, traces, or redacted logs before running a comparison.</p></div></div><div className="table-wrap"><table><thead><tr><th>Fixture</th><th>Surface</th><th>Expected outcome</th><th>State</th></tr></thead><tbody>{report.artifacts.benchmark.fixtures.map((fixture) => <tr key={fixture.id}><td><code>{fixture.id}</code></td><td>{fixture.candidateId}</td><td>{fixture.expected}</td><td><span className="table-state"><CircleAlert size={13} /> {fixture.status}</span></td></tr>)}</tbody></table></div><div className="metrics-row">{report.artifacts.benchmark.metrics.map((metric) => <div key={metric}><SlidersHorizontal size={14} />{metric}</div>)}</div></div>;
}

function App() {
  const [report, setReport] = useState<AnalysisReport>(initialReport);
  const [selectedId, setSelectedId] = useState(initialReport.candidates[0].id);
  const [view, setView] = useState<View>("overview");
  const [url, setUrl] = useState("https://github.com/expressjs/express");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dark, setDark] = useState(() => localStorage.getItem("jevmap-theme") !== "light");

  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; localStorage.setItem("jevmap-theme", dark ? "dark" : "light"); }, [dark]);

  async function analyze(target?: string) {
    const value = target || url;
    if (!value.trim()) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: value.trim() }) });
      const body = await response.json() as AnalysisReport & { error?: string };
      if (!response.ok) throw new Error(body.error || "Analysis failed.");
      setReport(body);
      setSelectedId(body.candidates[0]?.id || "");
      setView("overview");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Analysis failed. The sample mode is still available.");
    } finally {
      setLoading(false);
    }
  }

  function loadSample() {
    const sample = createSampleAnalysis();
    setReport(sample);
    setSelectedId(sample.candidates[0].id);
    setError("");
    setView("overview");
  }

  const selected = report.candidates.find((candidate) => candidate.id === selectedId) || report.candidates[0];

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><GitBranch size={19} /></div><div><strong>JevMap</strong><span>Decision surfaces</span></div></div>
      <div className="sidebar-section"><div className="sidebar-label">Workspace</div><nav>{navItems.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><item.icon size={17} />{item.label}{item.id === "overview" && <span className="nav-count">{report.candidates.length}</span>}</button>)}</nav></div>
      <div className="sidebar-bottom"><div className="mode-note"><div className="mode-note-icon"><ShieldCheck size={16} /></div><div><strong>{report.mode === "typesafe" ? "Jev enriched" : "Static mode"}</strong><p>{report.mode === "typesafe" ? "TypeSafe response included" : "No API key required"}</p></div></div><button className="theme-toggle" onClick={() => setDark((value) => !value)}>{dark ? <Sun size={16} /> : <Moon size={16} />}{dark ? "Use light mode" : "Use dark mode"}</button></div>
    </aside>
    <main className="main-shell">
      <header className="topbar"><div className="breadcrumb"><span>JevMap</span><ChevronRight size={14} /><strong>{report.repository.name}</strong></div><div className="topbar-actions"><span className={`connection ${report.source === "github" ? "connection-live" : ""}`}><i />{report.source === "github" ? "GitHub snapshot" : "Sample repository"}</span><button className="icon-button" onClick={() => setDark((value) => !value)} aria-label="Toggle color mode" title="Toggle color mode">{dark ? <Sun size={17} /> : <Moon size={17} />}</button></div></header>
      <section className="command-area"><div><h1>Map the judgment layer</h1><p>Find the moments where a codebase interprets, routes, ranks, or decides.</p></div><button className="sample-button" onClick={loadSample}><Play size={15} /> Open sample</button><form className="repo-form" onSubmit={(event) => { event.preventDefault(); void analyze(); }}><Search size={17} /><input value={url} onChange={(event) => setUrl(event.target.value)} aria-label="Public GitHub repository URL" placeholder="https://github.com/owner/repository" /><button type="submit" disabled={loading}>{loading ? <LoaderCircle size={16} className="spin" /> : <ArrowUpRight size={16} />}<span>{loading ? "Analyzing" : "Analyze repo"}</span></button></form></section>
      {error && <div className="error-banner"><CircleAlert size={17} /><div><strong>Analysis could not finish</strong><p>{error}</p></div><button className="icon-button" onClick={() => setError("")} aria-label="Dismiss error"><X size={16} /></button></div>}
      <section className="repo-strip"><div className="repo-identity"><div className="repo-avatar"><GitBranch size={18} /></div><div><strong>{report.repository.name}</strong><a href={report.repository.url.startsWith("http") ? report.repository.url : undefined} target="_blank" rel="noreferrer">{report.repository.url} <ArrowUpRight size={12} /></a></div></div><div className="repo-meta"><span><GitFork size={14} /> {report.repository.branch}</span><span><Code2 size={14} /> {report.repository.commit.slice(0, 8)}</span><span className="mode-state"><i /> {report.mode === "typesafe" ? "Jev enriched" : "Static analysis"}</span></div></section>
      <div className="content-area">
        {view === "overview" && <><div className="metrics-row metrics-top"><Metric label="Decision surfaces" value={report.stats.candidates} detail={`${report.stats.evidenceLines} cited lines`} icon={Activity} /><Metric label="Jev candidates" value={report.stats.jevCandidates} detail="bounded semantic" icon={Sparkles} /><Metric label="Keep in code" value={report.stats.deterministic} detail="exact authority" icon={ShieldCheck} /><Metric label="Generation" value={report.stats.llm} detail="multi-step / open" icon={Zap} /></div><Overview report={report} selectedId={selected?.id || ""} onSelect={setSelectedId} /></>}
        {view === "tree" && <div className="tree-view"><div className="section-heading section-heading-large"><div><h2>Explore the decision tree</h2><p>Follow each surface to the recommended authority boundary.</p></div><span className="result-count">Click a surface to inspect evidence</span></div><div className="tree-layout"><DecisionCanvas report={report} selectedId={selected?.id || ""} onSelect={setSelectedId} /><aside className="tree-inspector"><CandidateInspector candidate={selected} /></aside></div></div>}
        {view === "architecture" && <ArchitectureView report={report} />}
        {view === "manifest" && <ManifestView report={report} />}
        {view === "benchmark" && <BenchmarkView report={report} />}
      </div>
      <footer className="footer"><span>Evidence-first analysis · {new Date(report.analyzedAt).toLocaleString()}</span><span>JevMap keeps authority explicit.</span></footer>
    </main>
  </div>;
}

export default App;
