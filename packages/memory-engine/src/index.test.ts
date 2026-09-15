import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryEngine } from "./index.js";

test("persists tasks and latest checkpoint", async () => {
  const workspace = join(tmpdir(), `agent-memory-${Date.now()}`);
  await mkdir(workspace);
  const memory = await MemoryEngine.open(workspace, join(workspace, ".test-agent-data"));
  memory.startTask({ id: "task-1", mode: "inspect", prompt: "inspect", status: "running", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", summary: null, sessionId: null });
  memory.saveCheckpoint({ taskId: "task-1", plan: ["inspect"], state: { step: 1 }, createdAt: "2026-01-01T00:00:01.000Z" });
  memory.completeTask("task-1", "completed", "done");
  assert.equal(memory.latestCheckpoint()?.taskId, "task-1");
  assert.equal(memory.listTasks()[0]?.summary, "done");
  memory.close();
  await rm(workspace, { recursive: true, force: true });
});

test("persists and retrieves a task's session id, surviving reopen", async () => {
  const workspace = join(tmpdir(), `agent-memory-session-${Date.now()}`);
  await mkdir(workspace);
  const dataRoot = join(workspace, ".test-agent-data");
  const memory = await MemoryEngine.open(workspace, dataRoot);
  memory.startTask({ id: "task-1", mode: "run", prompt: "run", status: "running", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", summary: null, sessionId: null });
  assert.equal(memory.getTask("task-1")?.sessionId, null);
  memory.setSessionId("task-1", "thread-abc");
  assert.equal(memory.getTask("task-1")?.sessionId, "thread-abc");
  memory.close();

  const reopened = await MemoryEngine.open(workspace, dataRoot);
  assert.equal(reopened.getTask("task-1")?.sessionId, "thread-abc");
  assert.equal(reopened.getTask("missing-task"), null);
  reopened.close();
  await rm(workspace, { recursive: true, force: true });
});
