import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryEngine } from "@corporate-agent/memory-engine";
import { PolicyEngine } from "@corporate-agent/policy-engine";
import { WorkspaceTools } from "@corporate-agent/tools";
import { ContextEngine } from "./index.js";

test("reuses unchanged index entries and selects matching context", async () => {
  const workspace = join(tmpdir(), `agent-context-${Date.now()}`);
  const dataRoot = join(tmpdir(), `agent-context-data-${Date.now()}`);
  await mkdir(workspace);
  await writeFile(join(workspace, "greeting.ts"), "export function createGreeting(name: string) { return name; }\n", "utf8");
  const memory = await MemoryEngine.open(workspace, dataRoot);
  const context = new ContextEngine(new WorkspaceTools(workspace, new PolicyEngine(workspace)), memory);
  assert.equal((await context.index()).indexed, 1);
  assert.equal((await context.index()).reused, 1);
  assert.equal((await context.select("createGreeting", { maxFiles: 2, maxChars: 1000 }))[0]?.path, "greeting.ts");
  memory.close();
  await rm(workspace, { recursive: true, force: true });
  await rm(dataRoot, { recursive: true, force: true });
});
