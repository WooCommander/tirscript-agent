#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { AgentRuntime, Logger, formatTaskReport, loadConfig } from "@corporate-agent/core";
import { CodexLocalProvider, MockModelProvider, OpenAICompatibleProvider } from "@corporate-agent/model-provider";
import type { AgentMode } from "@corporate-agent/protocol";
import { MemoryEngine } from "@corporate-agent/memory-engine";

const [command, ...args] = process.argv.slice(2);
const workspace = process.cwd();

if (command === "config") {
  console.log(JSON.stringify(await loadConfig(workspace), null, 2));
} else if (command === "history" || command === "status" || command === "audit") {
  await showMemory(command);
} else if (command === "resume") {
  await resumeTask(args);
} else if (command === "chat") {
  await startChat();
} else if (command === "ask" || command === "inspect" || command === "run") {
  const showReport = args.includes("--report");
  const prompt = await readPrompt(args.filter((argument) => argument !== "--report"));
  if (!prompt) fail("Prompt is required");
  const config = await loadConfig(workspace);
  const runtime = createRuntime(config);
  const result = await runtime.execute(command satisfies AgentMode, prompt, workspace, config);
  console.log(result.response);
  if (showReport) console.log(formatTaskReport(result.report));
} else {
  fail("Usage: agent <ask|inspect|run> [--report] <prompt|task-file> | agent resume <task-id> <prompt> | agent <history|status|audit|chat|config>");
}

async function showMemory(command: "history" | "status" | "audit"): Promise<void> {
  const memory = await MemoryEngine.open(workspace);
  try {
    if (command === "history") console.log(JSON.stringify(memory.listTasks(), null, 2));
    else if (command === "audit") console.log(JSON.stringify(memory.listAudit(), null, 2));
    else console.log(JSON.stringify(memory.latestCheckpoint(), null, 2));
  } finally { memory.close(); }
}

async function resumeTask(args: readonly string[]): Promise<void> {
  const [taskId, ...promptParts] = args;
  const prompt = promptParts.join(" ").trim();
  if (taskId === undefined || !prompt) fail("Usage: agent resume <task-id> <prompt>");
  const memory = await MemoryEngine.open(workspace);
  const checkpoint = memory.latestCheckpoint(taskId);
  memory.close();
  if (checkpoint === null) fail(`Checkpoint not found for task: ${taskId}`);
  const config = await loadConfig(workspace);
  const result = await createRuntime(config).execute("resume", `Continue from trusted checkpoint:\n${JSON.stringify(checkpoint.state)}\n\nNew instruction:\n${prompt}`, workspace, config);
  console.log(result.response);
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
    : config.provider.type === "openai-compatible"
      ? new OpenAICompatibleProvider({ baseUrl: required(config.provider.baseUrl, "baseUrl"), model: config.provider.model, apiKeyEnv: required(config.provider.apiKeyEnv, "apiKeyEnv") })
      : new MockModelProvider(config.provider.model);
  return new AgentRuntime(provider, new Logger());
}

function required(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`Missing provider.${name}`);
  return value;
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
