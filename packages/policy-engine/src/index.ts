import { isAbsolute, relative, resolve, sep } from "node:path";

const defaultDeniedNames = new Set([".env", ".env.local", ".env.production"]);
const defaultDeniedExtensions = new Set([".key", ".pem", ".pfx", ".p12"]);

export interface PolicyConfig {
  readonly deniedFiles?: readonly string[];
  readonly allowedHosts?: readonly string[];
}

export class PolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolationError";
  }
}

export class PolicyEngine {
  private readonly root: string;

  constructor(workspace: string, private readonly config: PolicyConfig = {}) {
    this.root = resolve(workspace);
  }

  assertReadable(path: string): string {
    const resolved = this.assertInWorkspace(path);
    const name = resolved.split(sep).at(-1)?.toLowerCase() ?? "";
    const relativePath = relative(this.root, resolved).replaceAll("\\", "/");
    if (defaultDeniedNames.has(name) || [...defaultDeniedExtensions].some((extension) => name.endsWith(extension)) || (this.config.deniedFiles ?? []).some((pattern) => globMatches(relativePath, pattern))) {
      throw new PolicyViolationError(`Reading protected file is denied: ${name}`);
    }
    return resolved;
  }

  assertWritable(path: string): string {
    return this.assertReadable(path);
  }

  assertCommand(command: string): void {
    const blocked = /(^|\s)(rm|del|rmdir|format|git\s+push|git\s+reset\s+--hard)(\s|$)/i;
    if (blocked.test(command)) throw new PolicyViolationError("Destructive or external command is denied by policy");
  }

  assertNetworkUrl(url: string): void {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new PolicyViolationError("Invalid network URL"); }
    if (parsed.protocol !== "https:" || !(this.config.allowedHosts ?? []).includes(parsed.host)) {
      throw new PolicyViolationError(`Network host is denied: ${parsed.host}`);
    }
  }

  private assertInWorkspace(path: string): string {
    const resolved = resolve(this.root, path);
    const pathToRoot = relative(this.root, resolved);
    if (pathToRoot === ".." || pathToRoot.startsWith(`..${sep}`) || isAbsolute(pathToRoot)) {
      throw new PolicyViolationError("Path is outside the workspace");
    }
    return resolved;
  }
}

function globMatches(path: string, pattern: string): boolean {
  const expression = `^${pattern.replaceAll("\\", "/").replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("**/", "(?:.*/)?").replaceAll("**", ".*").replaceAll("*", "[^/]*")}$`;
  return new RegExp(expression, "i").test(path);
}
