#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { AgentRuntime, Logger, loadConfig } from "@corporate-agent/core";
import { CodexLocalProvider, MockModelProvider } from "@corporate-agent/model-provider";
import type { AgentMode } from "@corporate-agent/protocol";

const [command, ...args] = process.argv.slice(2);
const workspace = process.cwd();

if (command === "config") {
  console.log(JSON.stringify(await loadConfig(workspace), null, 2));
} else if (command === "chat") {
  await startChat();
} else if (command === "ask" || command === "inspect" || command === "run") {
  const prompt = await readPrompt(args);
  if (!prompt) fail("Prompt is required");
  const config = await loadConfig(workspace);
  const runtime = createRuntime(config);
  const result = await runtime.execute(command satisfies AgentMode, prompt, workspace, config);
  console.log(result.response);
} else {
  fail("Usage: agent <ask|inspect|run> <prompt|task-file> | agent chat | agent config");
}

async function startChat(): Promise<void> {
  const config = await loadConfig(workspace);
  const runtime = createRuntime(config);
  const terminal = createInterface({ input: stdin, output: stdout });
  console.log("Agent chat started. Type exit to stop.");
  try {
    while (true) {
      const prompt = (await terminal.question("\nYou> ")).trim();
      if (prompt === "exit" || prompt === "/exit") break;
      if (!prompt) continue;
      try {
        const result = await runtime.execute("ask", prompt, workspace, config);
        console.log(`\nAgent> ${result.response}`);
      } catch (error: unknown) {
        console.error(`\nAgent error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    terminal.close();
  }
}

function createRuntime(config: Awaited<ReturnType<typeof loadConfig>>): AgentRuntime {
  const provider = config.provider.type === "codex-local"
    ? new CodexLocalProvider(config.provider.model)
    : new MockModelProvider(config.provider.model);
  return new AgentRuntime(provider, new Logger());
}

async function readPrompt(args: readonly string[]): Promise<string> {
  const argument = args.join(" ").trim();
  if (argument) {
    if (argument.endsWith(".md") || argument.endsWith(".txt")) return (await readFile(resolve(argument), "utf8")).trim();
    return argument;
  }
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").trim();
}

function fail(message: string): never { console.error(message); process.exit(1); }
