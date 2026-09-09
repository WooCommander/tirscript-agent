import { DatabaseSync } from "node:sqlite";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { AgentMode, TaskStatus } from "@corporate-agent/protocol";

export interface StoredTask {
  readonly id: string;
  readonly mode: AgentMode;
  readonly prompt: string;
  readonly status: TaskStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly summary: string | null;
}

export interface Checkpoint {
  readonly taskId: string;
  readonly plan: unknown;
  readonly state: unknown;
  readonly createdAt: string;
}

export interface FileIndexEntry {
  readonly path: string;
  readonly sha256: string;
  readonly imports: readonly string[];
  readonly exports: readonly string[];
  readonly analyzerVersion: string;
  readonly updatedAt: string;
}

export interface FileSummary {
  readonly path: string;
  readonly sha256: string;
  readonly summary: string;
  readonly analyzerVersion: string;
  readonly updatedAt: string;
}

export class MemoryEngine {
  private constructor(private readonly database: DatabaseSync) {}

  static async open(workspace: string, dataRoot = defaultDataRoot()): Promise<MemoryEngine> {
    const directory = join(dataRoot, "projects", projectId(workspace));
    await mkdir(directory, { recursive: true });
    const databasePath = join(directory, "agent.sqlite");
    await migrateLegacyDatabase(workspace, databasePath);
    const engine = new MemoryEngine(new DatabaseSync(databasePath));
    engine.migrate();
    return engine;
  }

  startTask(task: StoredTask): void {
    this.database.prepare("INSERT INTO tasks (id, mode, prompt, status, created_at, updated_at, summary) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(task.id, task.mode, task.prompt, task.status, task.createdAt, task.updatedAt, task.summary);
  }

  completeTask(taskId: string, status: Extract<TaskStatus, "completed" | "failed" | "stopped">, summary: string): void {
    this.database.prepare("UPDATE tasks SET status = ?, summary = ?, updated_at = ? WHERE id = ?")
      .run(status, summary, timestamp(), taskId);
  }

  saveCheckpoint(checkpoint: Checkpoint): void {
    this.database.prepare("INSERT INTO checkpoints (task_id, plan_json, state_json, created_at) VALUES (?, ?, ?, ?)")
      .run(checkpoint.taskId, JSON.stringify(checkpoint.plan), JSON.stringify(checkpoint.state), checkpoint.createdAt);
  }

  latestCheckpoint(taskId?: string): Checkpoint | null {
    const row = taskId === undefined
      ? this.database.prepare("SELECT task_id, plan_json, state_json, created_at FROM checkpoints ORDER BY id DESC LIMIT 1").get()
      : this.database.prepare("SELECT task_id, plan_json, state_json, created_at FROM checkpoints WHERE task_id = ? ORDER BY id DESC LIMIT 1").get(taskId);
    return isCheckpointRow(row) ? { taskId: row.task_id, plan: JSON.parse(row.plan_json), state: JSON.parse(row.state_json), createdAt: row.created_at } : null;
  }

  listTasks(limit = 20): readonly StoredTask[] {
    const rows = this.database.prepare("SELECT id, mode, prompt, status, created_at, updated_at, summary FROM tasks ORDER BY updated_at DESC LIMIT ?").all(limit);
    return rows.filter(isTaskRow).map((row) => ({ id: row.id, mode: row.mode, prompt: row.prompt, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, summary: row.summary }));
  }

  getFileIndex(path: string): FileIndexEntry | null {
    const row = this.database.prepare("SELECT path, sha256, imports_json, exports_json, analyzer_version, updated_at FROM file_index WHERE path = ?").get(path);
    return isFileIndexRow(row) ? {
      path: row.path,
      sha256: row.sha256,
      imports: JSON.parse(row.imports_json),
      exports: JSON.parse(row.exports_json),
      analyzerVersion: row.analyzer_version,
      updatedAt: row.updated_at
    } : null;
  }

  upsertFileIndex(entry: FileIndexEntry): void {
    this.database.prepare(`INSERT INTO file_index (path, sha256, imports_json, exports_json, analyzer_version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET sha256 = excluded.sha256, imports_json = excluded.imports_json,
      exports_json = excluded.exports_json, analyzer_version = excluded.analyzer_version, updated_at = excluded.updated_at`)
      .run(entry.path, entry.sha256, JSON.stringify(entry.imports), JSON.stringify(entry.exports), entry.analyzerVersion, entry.updatedAt);
  }

  getFileSummary(path: string, sha256: string): FileSummary | null {
    const row = this.database.prepare("SELECT path, sha256, summary, analyzer_version, updated_at FROM file_summaries WHERE path = ? AND sha256 = ?").get(path, sha256);
    return isFileSummaryRow(row) ? { path: row.path, sha256: row.sha256, summary: row.summary, analyzerVersion: row.analyzer_version, updatedAt: row.updated_at } : null;
  }

  upsertFileSummary(summary: FileSummary): void {
    this.database.prepare(`INSERT INTO file_summaries (path, sha256, summary, analyzer_version, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET sha256 = excluded.sha256, summary = excluded.summary,
      analyzer_version = excluded.analyzer_version, updated_at = excluded.updated_at`)
      .run(summary.path, summary.sha256, summary.summary, summary.analyzerVersion, summary.updatedAt);
  }

  close(): void { this.database.close(); }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, mode TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, summary TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS checkpoints (
        id INTEGER PRIMARY KEY, task_id TEXT NOT NULL, plan_json TEXT NOT NULL,
        state_json TEXT NOT NULL, created_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS file_index (
        path TEXT PRIMARY KEY, sha256 TEXT NOT NULL, imports_json TEXT NOT NULL,
        exports_json TEXT NOT NULL, analyzer_version TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS file_summaries (
        path TEXT PRIMARY KEY, sha256 TEXT NOT NULL, summary TEXT NOT NULL,
        analyzer_version TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
    `);
  }
}

function timestamp(): string { return new Date().toISOString(); }
function projectId(workspace: string): string { return createHash("sha256").update(resolve(workspace).toLowerCase(), "utf8").digest("hex"); }
function defaultDataRoot(): string {
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "CorporateAgent");
  return join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "corporate-agent");
}
async function migrateLegacyDatabase(workspace: string, target: string): Promise<void> {
  const legacy = join(workspace, ".agent", "agent.sqlite");
  if (await exists(target) || !await exists(legacy)) return;
  await copyFile(legacy, target);
  await rm(legacy);
}
async function exists(path: string): Promise<boolean> { try { await stat(path); return true; } catch { return false; } }
function isTaskRow(value: unknown): value is { id: string; mode: AgentMode; prompt: string; status: TaskStatus; created_at: string; updated_at: string; summary: string | null } {
  return isRecord(value) && typeof value.id === "string" && typeof value.mode === "string" && typeof value.prompt === "string" && typeof value.status === "string" && typeof value.created_at === "string" && typeof value.updated_at === "string" && (typeof value.summary === "string" || value.summary === null);
}
function isCheckpointRow(value: unknown): value is { task_id: string; plan_json: string; state_json: string; created_at: string } {
  return isRecord(value) && typeof value.task_id === "string" && typeof value.plan_json === "string" && typeof value.state_json === "string" && typeof value.created_at === "string";
}
function isFileIndexRow(value: unknown): value is { path: string; sha256: string; imports_json: string; exports_json: string; analyzer_version: string; updated_at: string } {
  return isRecord(value) && typeof value.path === "string" && typeof value.sha256 === "string" && typeof value.imports_json === "string" && typeof value.exports_json === "string" && typeof value.analyzer_version === "string" && typeof value.updated_at === "string";
}
function isFileSummaryRow(value: unknown): value is { path: string; sha256: string; summary: string; analyzer_version: string; updated_at: string } {
  return isRecord(value) && typeof value.path === "string" && typeof value.sha256 === "string" && typeof value.summary === "string" && typeof value.analyzer_version === "string" && typeof value.updated_at === "string";
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
