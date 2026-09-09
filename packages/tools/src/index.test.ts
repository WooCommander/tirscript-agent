import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolicyEngine } from "@corporate-agent/policy-engine";
import { WorkspaceTools } from "./index.js";

test("lists and searches permitted files", async () => {
  const workspace = join(tmpdir(), `agent-tools-${Date.now()}`);
  await mkdir(workspace);
  await writeFile(join(workspace, "sample.ts"), "export const greeting = 'hello';\n");
  await writeFile(join(workspace, ".env"), "SECRET=value\n");
  const tools = new WorkspaceTools(workspace, new PolicyEngine(workspace));
  assert.deepEqual(await tools.listFiles(), ["sample.ts"]);
  assert.deepEqual(await tools.searchText("greeting"), [{ path: "sample.ts", line: 1, text: "export const greeting = 'hello';" }]);
});

test("applies a patch only when the expected hash matches", async () => {
  const workspace = join(tmpdir(), `agent-patch-${Date.now()}`);
  await mkdir(workspace);
  const target = join(workspace, "sample.txt");
  await writeFile(target, "before", "utf8");
  const tools = new WorkspaceTools(workspace, new PolicyEngine(workspace));
  const expectedSha256 = createHash("sha256").update("before", "utf8").digest("hex");
  await tools.applyPatches([{ path: "sample.txt", expectedSha256, content: "after" }]);
  assert.equal(await readFile(target, "utf8"), "after");
  await assert.rejects(() => tools.applyPatches([{ path: "sample.txt", expectedSha256, content: "unexpected" }]));
  await rm(workspace, { recursive: true, force: true });
});
