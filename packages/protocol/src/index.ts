export type AgentMode = "ask" | "inspect" | "run" | "diagnose" | "review" | "resume";
export type TaskStatus = "planned" | "running" | "completed" | "failed" | "stopped";
export type ProviderType = "mock" | "codex-local" | "openai-compatible";

export interface ProviderConfig {
  readonly type: ProviderType;
  readonly model: string;
  readonly baseUrl?: string;
  readonly apiKeyEnv?: string;
}

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
  readonly sessionId?: string;
}

export interface ModelResponse {
  readonly text: string;
  readonly model: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly sessionId?: string;
}

export interface ModelProvider {
  readonly name: string;
  capabilities(): ModelCapabilities;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

export interface AgentConfig {
  readonly provider: ProviderConfig;
  readonly routing?: { readonly providers: Readonly<Record<string, ProviderConfig>>; readonly roles: Partial<Record<AgentMode, string>> };
  readonly security: { readonly isolationMode: "strict" | "permissive"; readonly allowInternet: boolean; readonly allowedHosts: readonly string[]; readonly deniedFiles?: readonly string[] };
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
  readonly sessionId?: string;
}
