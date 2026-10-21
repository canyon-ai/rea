import { realpath } from "node:fs/promises";
import { relative, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/client/stdio";
import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

// A narrow local adapter, not an execution or SmartBlock authority gateway.
export const STATIC_TOOLS = Object.freeze([
  "analyze_javascript_application",
  "inspect_analysis_view",
  "trace_application_feature",
  "trace_javascript_semantics",
  "compare_application_versions",
  "compare_javascript_export_shapes",
  "compare_source_to_bundle",
]);
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--root")
  throw new Error(
    "Usage: node canyon/static-mcp.mjs --root <authorized-analysis-directory>",
  );
const allowedRoot = await realpath(resolve(args[1]));
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const upstream = new Client({
  name: "canyon-rea-static-carrier",
  version: "1.0.0",
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("../scripts/rea.mjs", import.meta.url)), "mcp"],
  cwd: packageRoot,
  env: getDefaultEnvironment(),
  stderr: "inherit",
  maxBufferSize: 32 * 1024 * 1024,
});
await upstream.connect(transport);
const catalog = [];
let cursor;
do {
  const page = await upstream.listTools(cursor ? { cursor } : undefined);
  catalog.push(...page.tools);
  cursor = page.nextCursor;
} while (cursor);
const server = new McpServer(
  { name: "canyon-rea-static", version: "1.1.0" },
  {
    instructions:
      "Static analysis only within the configured root. Results are evidence, not authority, runtime proof, or SmartBlock certification. Retain hashes, unknowns and coverage. Use the private SmartBlocks projection CLI for candidate packs. compare_source_to_bundle accepts an imported historical graph and application Evidence; import-reference-source is a separate CLI requiring verified Windows native read guards on local NTFS. No target execution, mutation or decompiler providers are exposed.",
  },
);
for (const name of STATIC_TOOLS) {
  const tool = catalog.find((t) => t.name === name);
  if (!tool) throw new Error("PINNED_TOOL_MISSING: " + name);
  server.registerTool(
    name,
    {
      description: tool.description,
      inputSchema: fromJsonSchema(tool.inputSchema),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input, context) => {
      if (name === "analyze_javascript_application") {
        const target = await realpath(input.input_path);
        const rel = relative(allowedRoot, target);
        if (
          isAbsolute(rel) ||
          rel === ".." ||
          rel.startsWith("..\\") ||
          rel.startsWith("../")
        )
          return {
            isError: true,
            content: [{ type: "text", text: "ANALYSIS_ROOT_REFUSED" }],
          };
        input = { ...input, input_path: target };
      }
      const id = randomUUID(),
        started = performance.now();
      const result = await upstream.callTool(
        { name, arguments: input },
        undefined,
        { timeout: 90000, signal: context.mcpReq.signal },
      );
      const evidence = result.structuredContent;
      return {
        ...result,
        _meta: {
          ...result._meta,
          "canyon/rea-usage": {
            schema: "canyon.rea-tool-usage/1",
            invocationId: id,
            operation: name,
            transport: "local-stdio",
            status: result.isError ? "error" : "returned",
            evidenceId: evidence?.evidence_id ?? null,
            artifactSha256: evidence?.subject?.digest?.sha256 ?? null,
            elapsedMs: Math.round(performance.now() - started),
            modelTokens: null,
            modelCost: null,
            smartBlockBinding: "not-supplied",
            nativeGatewayReceipt: null,
            authority: "observed-local-tool-call-not-native-acceptance",
          },
        },
      };
    },
  );
}
let closing;
async function close() {
  if (!closing)
    closing = Promise.allSettled([server.close(), upstream.close()]);
  await closing;
}
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
process.stdin.once("end", () => void close());
await server.connect(new StdioServerTransport());
