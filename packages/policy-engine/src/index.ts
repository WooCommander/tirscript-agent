import { isAbsolute, relative, resolve, sep } from "node:path";

const defaultDeniedNames = new Set([".env", ".env.local", ".env.production"]);
const defaultDeniedExtensions = new Set([".key", ".pem", ".pfx", ".p12"]);

export class PolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolationError";
  }
}

export class PolicyEngine {
  private readonly root: string;

  constructor(workspace: string) {
    this.root = resolve(workspace);
  }

  assertReadable(path: string): string {
    const resolved = this.assertInWorkspace(path);
    const name = resolved.split(sep).at(-1)?.toLowerCase() ?? "";
    if (defaultDeniedNames.has(name) || [...defaultDeniedExtensions].some((extension) => name.endsWith(extension))) {
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

  private assertInWorkspace(path: string): string {
    const resolved = resolve(this.root, path);
    const pathToRoot = relative(this.root, resolved);
    if (pathToRoot === ".." || pathToRoot.startsWith(`..${sep}`) || isAbsolute(pathToRoot)) {
      throw new PolicyViolationError("Path is outside the workspace");
    }
    return resolved;
  }
}
