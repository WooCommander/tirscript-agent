import assert from "node:assert/strict";
import test from "node:test";
import { CodexLocalProvider, MockModelProvider, OpenAICompatibleProvider } from "./index.js";

test("mock provider returns a deterministic response", async () => {
  const provider = new MockModelProvider("test-model");
  const response = await provider.generate({
    taskId: "task-1",
    mode: "ask",
    prompt: "hello",
    workspace: process.cwd(),
    systemInstructions: [],
    maxTokens: 100
  });

  assert.equal(response.model, "test-model");
  assert.match(response.text, /task-1/);
  assert.equal(response.inputTokens, 5);
});

test("codex-local declares supported capabilities without contacting the service", () => {
  const provider = new CodexLocalProvider("test-model");
  assert.equal(provider.name, "codex-local");
  assert.equal(provider.capabilities().cancellation, true);
});

test("openai-compatible provider normalizes a chat completion", async () => {
  const originalFetch = globalThis.fetch;
  process.env.TEST_PROVIDER_KEY = "test-key";
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "real answer" } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), { status: 200 });
  try {
    const provider = new OpenAICompatibleProvider({ baseUrl: "https://model.example/v1", model: "test-model", apiKeyEnv: "TEST_PROVIDER_KEY" });
    const result = await provider.generate({ taskId: "task", mode: "ask", prompt: "hello", workspace: process.cwd(), systemInstructions: [], maxTokens: 10 });
    assert.equal(result.text, "real answer");
    assert.equal(result.inputTokens, 3);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TEST_PROVIDER_KEY;
  }
});
