import type { ModelCapabilities, ModelProvider, ModelRequest, ModelResponse } from "@corporate-agent/protocol";
import { Codex, type Thread } from "@openai/codex-sdk";

export class MockModelProvider implements ModelProvider {
  readonly name = "mock";
  private readonly model: string;

  constructor(model = "corporate-agent-test-model") {
    this.model = model;
  }

  capabilities(): ModelCapabilities {
    return { streaming: false, tokenCounting: true, cancellation: true };
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (request.signal?.aborted) throw new Error("Model request cancelled");
    return {
      text: `Mock response for task ${request.taskId}: ${request.prompt}`,
      model: this.model,
      inputTokens: request.prompt.length,
      outputTokens: 12
    };
  }
}

export class CodexLocalProvider implements ModelProvider {
  readonly name = "codex-local";
  private readonly model: string;
  private thread: Thread | undefined;

  constructor(model: string) {
    this.model = model;
  }

  capabilities(): ModelCapabilities {
    return { streaming: false, tokenCounting: true, cancellation: true };
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (request.mode !== "ask" && request.mode !== "inspect" && request.mode !== "run" && request.mode !== "resume") {
      throw new Error("codex-local supports only ask, inspect, run and resume modes during the test phase");
    }
    const thread = this.thread ?? this.startThread(request.workspace);
    this.thread = thread;
    const turnOptions = {
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      ...(request.outputSchema === undefined ? {} : { outputSchema: request.outputSchema })
    };
    const result = await thread.run(`${request.systemInstructions.join("\n")}\n\nUser request:\n${request.prompt}`, turnOptions);
    return {
      text: result.finalResponse,
      model: this.model,
      ...(result.usage === null ? {} : {
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens
      })
    };
  }

  private startThread(workspace: string): Thread {
    return new Codex().startThread({
      model: this.model,
      workingDirectory: workspace,
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled"
    });
  }
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly name = "openai-compatible";

  constructor(private readonly options: { readonly baseUrl: string; readonly model: string; readonly apiKeyEnv: string }) {}

  capabilities(): ModelCapabilities {
    return { streaming: false, tokenCounting: true, cancellation: true };
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (request.mode === "run") throw new Error("openai-compatible provider supports ask, inspect and resume; controlled run requires a validated patch schema");
    const apiKey = process.env[this.options.apiKeyEnv];
    if (!apiKey) throw new Error(`Missing API key environment variable: ${this.options.apiKeyEnv}`);
    const endpoint = new URL("chat/completions", withTrailingSlash(this.options.baseUrl));
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: this.options.model,
        messages: [
          { role: "system", content: request.systemInstructions.join("\n") },
          { role: "user", content: request.prompt }
        ],
        stream: false
      }),
      ...(request.signal === undefined ? {} : { signal: request.signal })
    });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(`Model request failed with HTTP ${response.status}: ${errorText(payload)}`);
    const parsed = parseCompletion(payload);
    return { text: parsed.text, model: this.options.model, ...(parsed.inputTokens === undefined ? {} : { inputTokens: parsed.inputTokens }), ...(parsed.outputTokens === undefined ? {} : { outputTokens: parsed.outputTokens }) };
  }
}

function parseCompletion(value: unknown): { readonly text: string; readonly inputTokens?: number; readonly outputTokens?: number } {
  if (!isRecord(value) || !Array.isArray(value.choices) || !isRecord(value.choices[0]) || !isRecord(value.choices[0].message) || typeof value.choices[0].message.content !== "string") throw new Error("Model response has no text completion");
  const usage = isRecord(value.usage) ? value.usage : null;
  return {
    text: value.choices[0].message.content,
    ...(typeof usage?.prompt_tokens === "number" ? { inputTokens: usage.prompt_tokens } : {}),
    ...(typeof usage?.completion_tokens === "number" ? { outputTokens: usage.completion_tokens } : {})
  };
}
function errorText(value: unknown): string { return isRecord(value) && isRecord(value.error) && typeof value.error.message === "string" ? value.error.message : "unknown error"; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function withTrailingSlash(url: string): string { return url.endsWith("/") ? url : `${url}/`; }
