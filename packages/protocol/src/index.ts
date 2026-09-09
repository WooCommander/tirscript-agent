export type AgentMode = "ask" | "inspect" | "run" | "diagnose" | "review" | "resume";
export type TaskStatus = "planned" | "running" | "completed" | "failed" | "stopped";

export interface ModelCapabilities {
  readonly streaming: boolean;
  readonly tokenCounting: boolean;
  readonly cancellation: boolean;
}

export interface ModelRequest {
  readonly taskId: string;
  readonly mode: AgentMode;
  readonly prompt: string;
  readonly workspace: string;
  readonly systemInstructions: readonly string[];
  readonly maxTokens: number;
  readonly outputSchema?: unknown;
  readonly signal?: AbortSignal;
}

export interface ModelResponse {
  readonly text: string;
  readonly model: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface ModelProvider {
  readonly name: string;
  capabilities(): ModelCapabilities;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

export interface AgentConfig {
  readonly provider: { readonly type: "mock" | "codex-local" | "openai-compatible"; readonly model: string; readonly baseUrl?: string; readonly apiKeyEnv?: string };
  readonly security: { readonly isolationMode: "strict" | "permissive"; readonly allowInternet: boolean; readonly allowedHosts: readonly string[] };
  readonly execution: { readonly maxIterations: number; readonly maxTokens: number; readonly timeoutMs: number };
  readonly memory?: { readonly enabled: boolean };
  readonly context?: { readonly maxFiles: number; readonly maxChars: number };
}

export interface AgentTask {
  readonly id: string;
  readonly mode: AgentMode;
  readonly prompt: string;
  readonly workspace: string;
  readonly status: TaskStatus;
}
