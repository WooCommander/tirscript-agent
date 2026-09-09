import { createHash } from "node:crypto";
import type { FileIndexEntry, MemoryEngine } from "@corporate-agent/memory-engine";
import { WorkspaceTools } from "@corporate-agent/tools";

const analyzerVersion = "imports-exports-v1";

export interface ContextBudget {
  readonly maxFiles: number;
  readonly maxChars: number;
}

export interface ContextFile {
  readonly path: string;
  readonly sha256: string;
  readonly imports: readonly string[];
  readonly exports: readonly string[];
  readonly summary: string;
  readonly content: string;
}

export interface PreparedContext {
  readonly repositoryMap: readonly string[];
  readonly files: readonly ContextFile[];
}

export interface IndexResult {
  readonly entries: readonly FileIndexEntry[];
  readonly reused: number;
  readonly indexed: number;
}

export class ContextEngine {
  constructor(private readonly tools: WorkspaceTools, private readonly memory: MemoryEngine | null) {}

  async index(): Promise<IndexResult> {
    const paths = await this.tools.listFiles(500);
    const entries: FileIndexEntry[] = [];
    let reused = 0;
    let indexed = 0;
    for (const path of paths) {
      const content = await this.tools.readText(path, 100_000);
      const sha256 = hash(content);
      const cached = this.memory?.getFileIndex(path);
      if (cached?.sha256 === sha256 && cached.analyzerVersion === analyzerVersion) {
        entries.push(cached);
        reused += 1;
        continue;
      }
      const entry: FileIndexEntry = { path, sha256, ...extractSymbols(content), analyzerVersion, updatedAt: new Date().toISOString() };
      this.memory?.upsertFileIndex(entry);
      entries.push(entry);
      indexed += 1;
    }
    return { entries, reused, indexed };
  }

  async select(query: string, budget: ContextBudget): Promise<readonly ContextFile[]> {
    const index = await this.index();
    const terms = query.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length >= 3);
    const ranked = [...index.entries].sort((left, right) => score(right, terms) - score(left, terms) || left.path.localeCompare(right.path));
    const selected: ContextFile[] = [];
    let remainingChars = budget.maxChars;
    for (const entry of ranked) {
      if (selected.length >= budget.maxFiles || remainingChars <= 0) break;
      const content = await this.tools.readText(entry.path, remainingChars);
      selected.push({ path: entry.path, sha256: entry.sha256, imports: entry.imports, exports: entry.exports, summary: this.summaryFor(entry), content });
      remainingChars -= content.length;
    }
    return selected;
  }

  async prepare(query: string, budget: ContextBudget): Promise<PreparedContext> {
    const index = await this.index();
    const files = await this.selectFromIndex(query, budget, index.entries);
    return { repositoryMap: index.entries.map((entry) => this.summaryFor(entry)), files };
  }

  private async selectFromIndex(query: string, budget: ContextBudget, entries: readonly FileIndexEntry[]): Promise<readonly ContextFile[]> {
    const terms = query.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length >= 3);
    const ranked = [...entries].sort((left, right) => score(right, terms) - score(left, terms) || left.path.localeCompare(right.path));
    const selected: ContextFile[] = [];
    let remainingChars = budget.maxChars;
    for (const entry of ranked) {
      if (selected.length >= budget.maxFiles || remainingChars <= 0) break;
      const content = await this.tools.readText(entry.path, remainingChars);
      selected.push({ path: entry.path, sha256: entry.sha256, imports: entry.imports, exports: entry.exports, summary: this.summaryFor(entry), content });
      remainingChars -= content.length;
    }
    return selected;
  }

  private summaryFor(entry: FileIndexEntry): string {
    const cached = this.memory?.getFileSummary(entry.path, entry.sha256);
    if (cached?.analyzerVersion === analyzerVersion) return cached.summary;
    const summary = `${entry.path}: exports [${entry.exports.join(", ") || "none"}], imports [${entry.imports.join(", ") || "none"}]`;
    this.memory?.upsertFileSummary({ path: entry.path, sha256: entry.sha256, summary, analyzerVersion, updatedAt: new Date().toISOString() });
    return summary;
  }
}

function extractSymbols(content: string): { readonly imports: readonly string[]; readonly exports: readonly string[] } {
  const imports = collect(content, /(?:from\s+|require\()['"]([^'"]+)['"]/g);
  const exports = collect(content, /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface)\s+([\w$]+)/g);
  return { imports, exports };
}
function collect(content: string, expression: RegExp): readonly string[] {
  const values = new Set<string>();
  for (const match of content.matchAll(expression)) if (match[1] !== undefined) values.add(match[1]);
  return [...values];
}
function score(entry: FileIndexEntry, terms: readonly string[]): number {
  const searchable = `${entry.path} ${entry.exports.join(" ")} ${entry.imports.join(" ")}`.toLowerCase();
  return terms.reduce((total, term) => total + (searchable.includes(term) ? 1 : 0), 0);
}
function hash(content: string): string { return createHash("sha256").update(content, "utf8").digest("hex"); }
