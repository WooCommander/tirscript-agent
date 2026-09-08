import assert from "node:assert/strict";
import test from "node:test";
import { MockModelProvider } from "./index.js";
import { CodexLocalProvider } from "./index.js";

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
