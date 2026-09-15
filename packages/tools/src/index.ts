import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { spawn } from "node:child_process";
import { PolicyEngine } from "@corporate-agent/policy-engine";

const ignoredDirectories = new Set([".git", "node_modules", "dist", "coverage", ".agent"]);

export interface SearchMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface PatchOperation {
  readonly path: string;
  readonly expectedSha256: string | null;
  readonly content: string;
}

export interface AppliedPatch {
  readonly path: string;
  readonly previousSha256: string | null;
  readonly nextSha256: string;
}

export interface CommandSpec {
  readonly executable: "pnpm" | "npm" | "git" | "tsc";
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly output: string;
  readonly timedOut: boolean;
}

export class WorkspaceTools {
  constructor(private readonly workspace: string, private readonly policy: PolicyEngine) {}

  async listFiles(limit = 200): Promise<readonly string[]> {
    const files: string[] = [];
    await this.collect(this.workspace, files, limit);
    return files;
  }

  async readText(path: string, maxBytes = 24_000): Promise<string> {
    const absolutePath = this.policy.assertReadable(path);
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) throw new Error("Symbolic links are not readable by the agent");
    const content = await readFile(absolutePath, "utf8");
    return content.slice(0, maxBytes);
  }

  async searchText(query: string, limit = 40): Promise<readonly SearchMatch[]> {
    if (!query.trim()) return [];
    const files = await this.listFiles(500);
    const matches: SearchMatch[] = [];
    for (const path of files) {
      if (matches.length >= limit) break;
      let content: string;
      try { content = await this.readText(path, 100_000); } catch { continue; }
      for (const [offset, line] of content.split(/\r?\n/).entries()) {
        if (line.includes(query)) matches.push({ path, line: offset + 1, text: line.slice(0, 300) });
        if (matches.length >= limit) break;
      }
    }
    return matches;
  }

  async applyPatches(operations: readonly PatchOperation[]): Promise<readonly AppliedPatch[]> {
    if (operations.length === 0) return [];
    if (operations.length > 30) throw new Error("Patch operation limit exceeded");
    const paths = new Set<string>();
    for (const operation of operations) {
      if (paths.has(operation.path)) throw new Error(`Duplicate patch target: ${operation.path}`);
      paths.add(operation.path);
    }
    const validated = await Promise.all(operations.map((operation) => this.validatePatch(operation)));
    const staged = await Promise.all(validated.map(async (operation) => {
      const temporaryPath = join(dirname(operation.absolutePath), `.${basename(operation.absolutePath)}.agent-${randomUUID()}.tmp`);
      await writeFile(temporaryPath, operation.content, "utf8");
      return { ...operation, temporaryPath };
    }));
    const replaced: typeof staged = [];
    try {
      for (const operation of staged) {
        await rename(operation.temporaryPath, operation.absolutePath);
        replaced.push(operation);
      }
    } catch (error: unknown) {
      const rollbackErrors: string[] = [];
      for (const operation of replaced.reverse()) {
        try {
          if (operation.currentHash === null) await rm(operation.absolutePath, { force: true });
          else {
            if (operation.previousContent === null) throw new Error("Missing backup content for rollback");
            await writeFile(operation.absolutePath, operation.previousContent, "utf8");
          }
        } catch (rollbackError: unknown) { rollbackErrors.push(`${operation.path}: ${errorMessage(rollbackError)}`); }
      }
      if (rollbackErrors.length > 0) throw new Error(`Patch application failed and rollback was incomplete: ${rollbackErrors.join(", ")}`, { cause: error });
      throw new Error("Patch application failed; all applied changes were rolled back", { cause: error });
    } finally {
      await Promise.all(staged.map(async ({ temporaryPath }) => { await rm(temporaryPath, { force: true }); }));
    }
    return staged.map((operation) => ({ path: operation.path, previousSha256: operation.currentHash, nextSha256: hash(operation.content) }));
  }

  async runCommand(spec: CommandSpec): Promise<CommandResult> {
    this.assertAllowedCommand(spec);
    this.policy.assertCommand([spec.executable, ...spec.args].join(" "));
    return new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(spec.executable, [...spec.args], { cwd: this.workspace, shell: false, windowsHide: true });
      let output = "";
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, spec.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => { output = appendOutput(output, chunk.toString("utf8")); });
      child.stderr.on("data", (chunk: Buffer) => { output = appendOutput(output, chunk.toString("utf8")); });
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("close", (code) => { clearTimeout(timer); resolve({ exitCode: code ?? 1, output, timedOut }); });
    });
  }

  private async validatePatch(operation: PatchOperation): Promise<{ readonly path: string; readonly absolutePath: string; readonly currentHash: string | null; readonly previousContent: string | null; readonly content: string }> {
    if (!operation.path || operation.content.length > 1_000_000) throw new Error("Invalid patch operation");
    const absolutePath = this.policy.assertWritable(operation.path);
    let currentHash: string | null = null;
    let previousContent: string | null = null;
    try {
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("Patch target must be a regular file");
      previousContent = await readFile(absolutePath, "utf8");
      currentHash = hash(previousContent);
    } catch (error: unknown) {
      if (!isMissingFileError(error)) throw error;
      await mkdir(dirname(absolutePath), { recursive: true });
    }
    if (currentHash !== operation.expectedSha256) throw new Error(`Patch source hash mismatch: ${operation.path}`);
    return { path: operation.path, absolutePath, currentHash, previousContent, content: operation.content };
  }

  private assertAllowedCommand(spec: CommandSpec): void {
    if (!Number.isSafeInteger(spec.timeoutMs) || spec.timeoutMs < 1 || spec.timeoutMs > 15 * 60_000) throw new Error("Invalid command timeout");
    const [first] = spec.args;
    const allowed = (spec.executable === "git" && (first === "status" || first === "diff"))
      || ((spec.executable === "pnpm" || spec.executable === "npm") && (first === "test" || first === "run") && this.allowedScript(spec.args))
      || (spec.executable === "tsc" && spec.args.includes("--noEmit"));
    if (!allowed) throw new Error(`Command is not allowlisted: ${spec.executable} ${spec.args.join(" ")}`);
  }

  private allowedScript(args: readonly string[]): boolean {
    if (args[0] === "test") return true;
    if (args[0] !== "run") return false;
    return args[1] === "build" || args[1] === "check" || args[1] === "lint" || args[1] === "typecheck" || args[1] === "test";
  }

  private async collect(directory: string, files: string[], limit: number): Promise<void> {
    if (files.length >= limit) return;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= limit || (entry.isDirectory() && ignoredDirectories.has(entry.name))) continue;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) await this.collect(absolutePath, files, limit);
      else if (entry.isFile()) {
        const path = relative(this.workspace, absolutePath);
        try { this.policy.assertReadable(path); files.push(path); } catch { /* excluded by policy */ }
      }
    }
  }
}

function hash(content: string): string { return createHash("sha256").update(content, "utf8").digest("hex"); }
function appendOutput(current: string, next: string): string { return `${current}${next}`.slice(-32_000); }
function isMissingFileError(error: unknown): error is NodeJS.ErrnoException { return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
