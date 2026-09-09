import assert from "node:assert/strict";
import test from "node:test";
import { createGreeting } from "../src/greeting.js";

test("creates a greeting", () => {
  assert.equal(createGreeting("Ada"), "Hello, Ada!");
});
