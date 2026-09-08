import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentConfig, AgentMode, AgentTask, ModelProvider } from "@corporate-agent/protocol";

const defaultConfig: AgentConfig = {
  provider: { type: "mock", model: "corporate-agent-test-model" },
  security: { isolationMode: "strict", allowInternet: false, allowedHosts: [] },
  execution: { maxIterations: 12, maxTokens: 12_000, timeoutMs: 900_000 }
};

export class Logger {
  info(event: string, details: Readonly<Record<string, unknown>> = {}): void {
    process.stderr.write(`${JSON.stringify({ level: "info", event, timestamp: new Date().toISOString(), ...details })}\n`);
  }
}

export async function loadConfig(workspace: string): Promise<AgentConfig> {
  const file = process.env.AGENT_CONFIG ?? join(workspace, "agent.config.json");
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    return validateConfig(parsed);
  } catch (error: unknown) {
    if (isMissingFileError(error)) return defaultConfig;
    throw new Error(`Invalid agent configuration at ${file}: ${errorMessage(error)}`);
  }
}

export class AgentRuntime {
  private readonly provider: ModelProvider;
  private readonly logger: Logger;

  constructor(provider: ModelProvider, logger: Logger) {
    this.provider = provider;
    this.logger = logger;
  }

  async execute(mode: AgentMode, prompt: string, workspace: string, config: AgentConfig): Promise<{ task: AgentTask; response: string }> {
    const task: AgentTask = { id: randomUUID(), mode, prompt, workspace, status: "running" };
    this.logger.info("task.started", { taskId: task.id, mode, provider: this.provider.name });
    const result = await this.provider.generate({ taskId: task.id, mode, prompt, workspace, systemInstructions: ["Do not modify files or run commands. Answer the user request directly."], maxTokens: config.execution.maxTokens });
    this.logger.info("task.completed", { taskId: task.id, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
    return { task: { ...task, status: "completed" }, response: result.text };
  }
}

function validateConfig(value: unknown): AgentConfig {
  if (!isRecord(value)) throw new Error("configuration must be an object");
  const provider = value.provider;
  if (!isRecord(provider) || (provider.type !== "mock" && provider.type !== "codex-local" && provider.type !== "openai-compatible") || typeof provider.model !== "string") throw new Error("provider.type and provider.model are required");
  if (provider.type === "openai-compatible") throw new Error("openai-compatible provider is planned for a subsequent phase");
  const security = value.security;
  const execution = value.execution;
  if (!isRecord(security) || (security.isolationMode !== "strict" && security.isolationMode !== "permissive") || typeof security.allowInternet !== "boolean" || !isStringArray(security.allowedHosts)) {
    throw new Error("security.isolationMode, security.allowInternet and security.allowedHosts are required");
  }
  if (!isRecord(execution) || !isPositiveInteger(execution.maxIterations) || !isPositiveInteger(execution.maxTokens) || !isPositiveInteger(execution.timeoutMs)) {
    throw new Error("execution limits must be positive integers");
  }
  if (provider.type === "codex-local" && (security.isolationMode !== "permissive" || security.allowInternet !== true)) {
    throw new Error("codex-local requires an explicit permissive test configuration with allowInternet=true");
  }
  return {
    provider: { type: provider.type, model: provider.model },
    security: { isolationMode: security.isolationMode, allowInternet: security.allowInternet, allowedHosts: security.allowedHosts },
    execution: { maxIterations: execution.maxIterations, maxTokens: execution.maxTokens, timeoutMs: execution.timeoutMs }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === "string"); }
function isPositiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function isMissingFileError(error: unknown): error is NodeJS.ErrnoException { return isRecord(error) && error.code === "ENOENT"; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
