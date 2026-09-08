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
    if (request.mode !== "ask") throw new Error("codex-local is limited to ask mode during the test phase");
    const thread = this.thread ?? this.startThread(request.workspace);
    this.thread = thread;
    const turnOptions = request.signal === undefined ? {} : { signal: request.signal };
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
