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
  memory.startTask({ id: "task-1", mode: "inspect", prompt: "inspect", status: "running", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", summary: null });
  memory.saveCheckpoint({ taskId: "task-1", plan: ["inspect"], state: { step: 1 }, createdAt: "2026-01-01T00:00:01.000Z" });
  memory.completeTask("task-1", "completed", "done");
  assert.equal(memory.latestCheckpoint()?.taskId, "task-1");
  assert.equal(memory.listTasks()[0]?.summary, "done");
  memory.close();
  await rm(workspace, { recursive: true, force: true });
});
