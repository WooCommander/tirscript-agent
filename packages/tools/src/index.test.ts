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

test("does not partially apply a patch set when one source hash is stale", async () => {
  const workspace = join(tmpdir(), `agent-patch-set-${Date.now()}`);
  await mkdir(workspace);
  await writeFile(join(workspace, "first.txt"), "first-before", "utf8");
  await writeFile(join(workspace, "second.txt"), "second-before", "utf8");
  const tools = new WorkspaceTools(workspace, new PolicyEngine(workspace));
  const firstHash = createHash("sha256").update("first-before", "utf8").digest("hex");
  await assert.rejects(() => tools.applyPatches([
    { path: "first.txt", expectedSha256: firstHash, content: "first-after" },
    { path: "second.txt", expectedSha256: firstHash, content: "second-after" }
  ]));
  assert.equal(await readFile(join(workspace, "first.txt"), "utf8"), "first-before");
  assert.equal(await readFile(join(workspace, "second.txt"), "utf8"), "second-before");
  await rm(workspace, { recursive: true, force: true });
});

test("rejects duplicate targets in one patch set", async () => {
  const workspace = join(tmpdir(), `agent-patch-duplicate-${Date.now()}`);
  await mkdir(workspace);
  await writeFile(join(workspace, "sample.txt"), "before", "utf8");
  const tools = new WorkspaceTools(workspace, new PolicyEngine(workspace));
  const expectedSha256 = createHash("sha256").update("before", "utf8").digest("hex");
  await assert.rejects(() => tools.applyPatches([
    { path: "sample.txt", expectedSha256, content: "first" },
    { path: "sample.txt", expectedSha256, content: "second" }
  ]), /Duplicate patch target/);
  assert.equal(await readFile(join(workspace, "sample.txt"), "utf8"), "before");
  await rm(workspace, { recursive: true, force: true });
});
