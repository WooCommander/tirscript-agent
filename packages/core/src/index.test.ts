import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentConfig, ModelCapabilities, ModelProvider, ModelRequest, ModelResponse } from "@corporate-agent/protocol";
import { AgentRuntime, Logger } from "./index.js";

class ScriptedProvider implements ModelProvider {
  readonly name = "codex-local";
  private callCount = 0;

  capabilities(): ModelCapabilities { return { streaming: false, tokenCounting: false, cancellation: false }; }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.callCount += 1;
    if (this.callCount === 1) return { text: JSON.stringify({ files: ["sample.txt"] }), model: "test" };
    assert.match(request.prompt, /SHA256:/);
    return { text: JSON.stringify({ summary: "Updated sample", patches: [{ path: "sample.txt", content: "after" }], checks: [] }), model: "test" };
  }
}

test("run applies only an approved, hash-checked patch", async () => {
  const workspace = join(tmpdir(), `agent-runtime-${Date.now()}`);
  await mkdir(workspace);
  await writeFile(join(workspace, "sample.txt"), "before", "utf8");
  const config: AgentConfig = {
    provider: { type: "codex-local", model: "test" },
    security: { isolationMode: "permissive", allowInternet: true, allowedHosts: [] },
    execution: { maxIterations: 1, maxTokens: 1000, timeoutMs: 10_000 }
  };
  const runtime = new AgentRuntime(new ScriptedProvider(), new Logger());
  const result = await runtime.execute("run", "Update the sample", workspace, config);
  assert.equal(await readFile(join(workspace, "sample.txt"), "utf8"), "after");
  assert.deepEqual(result.report.changes, ["sample.txt"]);
  await rm(workspace, { recursive: true, force: true });
});

class SessionAwareProvider implements ModelProvider {
  readonly name = "codex-local";
  readonly requests: ModelRequest[] = [];

  capabilities(): ModelCapabilities { return { streaming: false, tokenCounting: false, cancellation: false }; }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return { text: `response for ${request.prompt}`, model: "test", sessionId: "thread-abc" };
  }
}

test("resume continues the original task's session without restating the checkpoint", async () => {
  const workspace = join(tmpdir(), `agent-resume-session-${Date.now()}`);
  await mkdir(workspace);
  const config: AgentConfig = {
    provider: { type: "codex-local", model: "test" },
    security: { isolationMode: "permissive", allowInternet: true, allowedHosts: [] },
    execution: { maxIterations: 1, maxTokens: 1000, timeoutMs: 10_000 }
  };
  const provider = new SessionAwareProvider();
  const runtime = new AgentRuntime(provider, new Logger());
  const started = await runtime.execute("ask", "first question", workspace, config);
  assert.equal(started.task.sessionId, "thread-abc");

  const resumed = await runtime.resume(started.task.id, "continue please", workspace, config);
  assert.equal(resumed.task.sessionId, "thread-abc");
  const resumeRequest = provider.requests[1];
  assert.equal(resumeRequest?.sessionId, "thread-abc");
  assert.equal(resumeRequest?.prompt, "continue please");
  await rm(workspace, { recursive: true, force: true });
});

class RecordingProvider implements ModelProvider {
  readonly name = "mock";
  readonly requests: ModelRequest[] = [];

  capabilities(): ModelCapabilities { return { streaming: false, tokenCounting: false, cancellation: false }; }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return { text: `response for ${request.prompt}`, model: "test" };
  }
}

test("resume falls back to a text checkpoint when no session was recorded", async () => {
  const workspace = join(tmpdir(), `agent-resume-fallback-${Date.now()}`);
  await mkdir(workspace);
  const config: AgentConfig = {
    provider: { type: "mock", model: "test" },
    security: { isolationMode: "strict", allowInternet: false, allowedHosts: [] },
    execution: { maxIterations: 1, maxTokens: 1000, timeoutMs: 10_000 }
  };
  const provider = new RecordingProvider();
  const runtime = new AgentRuntime(provider, new Logger());
  const started = await runtime.execute("ask", "first question", workspace, config);
  assert.equal(started.task.sessionId, undefined);

  await runtime.resume(started.task.id, "continue please", workspace, config);
  const resumeRequest = provider.requests[1];
  assert.equal(resumeRequest?.sessionId, undefined);
  assert.match(resumeRequest?.prompt ?? "", /Continue from trusted checkpoint:/);
  assert.match(resumeRequest?.prompt ?? "", /continue please/);
  await rm(workspace, { recursive: true, force: true });
});

test("loads AGENTS.md project rules into the model's system instructions before execution", async () => {
  const workspace = join(tmpdir(), `agent-project-rules-${Date.now()}`);
  await mkdir(workspace);
  await writeFile(join(workspace, "AGENTS.md"), "# Rules\n- Never use any.", "utf8");
  const config: AgentConfig = {
    provider: { type: "mock", model: "test" },
    security: { isolationMode: "strict", allowInternet: false, allowedHosts: [] },
    execution: { maxIterations: 1, maxTokens: 1000, timeoutMs: 10_000 }
  };
  const provider = new RecordingProvider();
  const runtime = new AgentRuntime(provider, new Logger());
  await runtime.execute("ask", "hello", workspace, config);
  assert.match(provider.requests[0]?.systemInstructions.join("\n") ?? "", /Never use any\./);
  await rm(workspace, { recursive: true, force: true });
});

test("does not fail and adds no project-rules instruction when AGENTS.md is absent", async () => {
  const workspace = join(tmpdir(), `agent-no-project-rules-${Date.now()}`);
  await mkdir(workspace);
  const config: AgentConfig = {
    provider: { type: "mock", model: "test" },
    security: { isolationMode: "strict", allowInternet: false, allowedHosts: [] },
    execution: { maxIterations: 1, maxTokens: 1000, timeoutMs: 10_000 }
  };
  const provider = new RecordingProvider();
  const runtime = new AgentRuntime(provider, new Logger());
  await runtime.execute("ask", "hello", workspace, config);
  assert.deepEqual(provider.requests[0]?.systemInstructions, ["Do not modify files or run commands. Answer the user request directly."]);
  await rm(workspace, { recursive: true, force: true });
});
