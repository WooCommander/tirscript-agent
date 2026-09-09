import assert from "node:assert/strict";
import test from "node:test";
import { PolicyEngine, PolicyViolationError } from "./index.js";

test("denies protected files and paths outside workspace", () => {
  const policy = new PolicyEngine(process.cwd());
  assert.throws(() => policy.assertReadable(".env"), PolicyViolationError);
  assert.throws(() => policy.assertReadable("../outside.txt"), PolicyViolationError);
});

test("denies destructive and publishing commands", () => {
  const policy = new PolicyEngine(process.cwd());
  assert.throws(() => policy.assertCommand("git push origin main"), PolicyViolationError);
  assert.throws(() => policy.assertCommand("rm -rf generated"), PolicyViolationError);
});

test("applies configured denylist and network allowlist", () => {
  const policy = new PolicyEngine(process.cwd(), { deniedFiles: ["private/**"], allowedHosts: ["models.example"] });
  assert.throws(() => policy.assertReadable("private/notes.txt"), PolicyViolationError);
  policy.assertNetworkUrl("https://models.example/v1");
  assert.throws(() => policy.assertNetworkUrl("https://other.example/v1"), PolicyViolationError);
});
