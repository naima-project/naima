// The platform bridge served as an MCP server (the Model Context Protocol), so that an agent reads and acts through
// exactly the commands the app's page uses: each command the app chooses becomes a tool, called with the same
// arguments and answering the same JSON. Like bridge-handler.ts it imports nothing and is built only on what Deno, Node
// and Bun share, so a backend on any of them can serve it.
//
//   const mcp = bridgeMcp({ name: "my-app", version: "1.0.0", handlers, tools: { describe: { description: "..." } } });
//   await serveMcpLines(mcp, linesOf(stdin), (line) => stdout.write(line + "\n"));   // the stdio transport
//
// The protocol is JSON-RPC 2.0, one message a line on the standard input and output (the MCP stdio transport); the
// server answers initialize, ping, tools/list and tools/call, and ignores the notifications. A tool's answer is the
// command's JSON, as text and, when it is an object, as structured content; a command that throws answers a tool
// error with its message, so the agent reads why. A command the app does not list in `tools` is not a tool.
//
// Whether an app serves its bridge this way is the project's choice, asked at design time (stance-ui.json's
// platforms.mcp): an agent that can call a tool can do whatever the command does.

import type { Handlers, Json } from "./bridge-handler.ts";

/** A bridge command offered as a tool: what it does, for the agent, and its arguments' JSON Schema (an object). */
export interface McpTool {
  description: string;
  inputSchema?: { [key: string]: Json };
}

export interface BridgeMcpOptions {
  /** The server's name and version, as the client shows them. */
  name: string;
  version: string;
  /** What the agent should know to use the tools well; the client may give it to the model. */
  instructions?: string;
  handlers: Handlers;
  /** The commands offered as tools, by the command's name: only these. */
  tools: { [command: string]: McpTool };
}

/** One JSON-RPC message in, its answer out: null for a notification, which is never answered. */
export type McpServer = (message: Json) => Promise<Json | null>;

/** The protocol versions this server speaks, the newest first: it answers a client's own when it is one of them. */
export const MCP_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const isObject = (v: Json | undefined): v is { [key: string]: Json } =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The bridge's commands named in `tools`, as an MCP server. */
export function bridgeMcp(options: BridgeMcpOptions): McpServer {
  const names = Object.keys(options.tools).filter((n) => Object.hasOwn(options.handlers, n));
  const list = names.map((name) => ({
    name,
    description: options.tools[name]!.description,
    inputSchema: options.tools[name]!.inputSchema ?? { type: "object", properties: {} },
  }));
  const call = async (params: { [key: string]: Json }): Promise<Json> => {
    const name = String(params["name"]);
    if (!names.includes(name)) throw Object.assign(new Error(`no tool ${name}`), { code: -32602 });
    const args = isObject(params["arguments"]) ? params["arguments"] : {};
    try {
      const answer = await options.handlers[name]!(args);
      const text = typeof answer === "string" ? answer : JSON.stringify(answer, null, 1);
      return {
        content: [{ type: "text", text }],
        ...(isObject(answer) ? { structuredContent: answer } : {}),
        isError: false,
      };
    } catch (e) {
      return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
    }
  };
  return async (message) => {
    if (!isObject(message) || message["jsonrpc"] !== "2.0" || typeof message["method"] !== "string") {
      return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "not a JSON-RPC 2.0 request" } };
    }
    const id = message["id"];
    // A notification (no id): initialized, cancelled, progress; nothing to answer.
    if (id === undefined) return null;
    const params = isObject(message["params"]) ? message["params"] : {};
    const ok = (result: Json): Json => ({ jsonrpc: "2.0", id, result });
    try {
      switch (message["method"]) {
        case "initialize": {
          const asked = String(params["protocolVersion"] ?? "");
          return ok({
            protocolVersion: MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[0]!,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: options.name, version: options.version },
            ...(options.instructions ? { instructions: options.instructions } : {}),
          });
        }
        case "ping":
          return ok({});
        case "tools/list":
          return ok({ tools: list });
        case "tools/call":
          return ok(await call(params));
        default:
          return { jsonrpc: "2.0", id, error: { code: -32601, message: `no method ${message["method"]}` } };
      }
    } catch (e) {
      const code = typeof (e as { code?: unknown }).code === "number" ? (e as { code: number }).code : -32603;
      return { jsonrpc: "2.0", id, error: { code, message: e instanceof Error ? e.message : String(e) } };
    }
  };
}

/**
 * The stdio transport: each line read is one message, each answer written as one line, in the order the answers
 * come (a slow tool does not hold the others back). Ends when the lines end and every answer is written.
 */
export async function serveMcpLines(
  server: McpServer,
  lines: AsyncIterable<string>,
  write: (line: string) => void,
): Promise<void> {
  const pending = new Set<Promise<void>>();
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message: Json;
    try {
      message = JSON.parse(line) as Json;
    } catch {
      write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "a line that is not JSON" } }));
      continue;
    }
    const p = server(message).then((answer) => {
      if (answer !== null) write(JSON.stringify(answer));
    });
    pending.add(p);
    void p.finally(() => pending.delete(p));
  }
  await Promise.all(pending);
}
