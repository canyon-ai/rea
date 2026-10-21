import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/client/stdio";
import { parseEvidence } from "../dist/domain/evidence.js";
import { historicalSourceGraphSchema } from "../dist/domain/referenceSourceGraph.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = resolve(process.argv[2] ?? join(root, "..", "rea-windows-trial"));
await mkdir(out, { recursive: true });
const fixtureRoot = await mkdtemp(join(out, "run-"));
const source = join(fixtureRoot, "source"),
  bundle = join(fixtureRoot, "bundle");
await mkdir(join(source, "src"), { recursive: true });
await mkdir(join(bundle, "dist"), { recursive: true });
const original = "export const value = 1;\n";
const unchanged = "export const stable = 'STABLE';\n";
await writeFile(join(source, "src", "main.ts"), original);
await writeFile(join(source, "src", "stable.js"), unchanged);
await writeFile(
  join(source, "src", "unmatched.js"),
  "export const unknown = true;\n",
);
await writeFile(join(bundle, "dist", "stable.js"), unchanged);
await writeFile(join(source, "src", "stable.json"), '{"stable":"STABLE"}\n');
await writeFile(join(bundle, "dist", "stable.json"), '{"stable":"STABLE"}\n');
await writeFile(
  join(bundle, "dist", "main.js"),
  "var value = 2;\n//# sourceMappingURL=main.js.map\n",
);
await writeFile(
  join(bundle, "dist", "main.js.map"),
  JSON.stringify({
    version: 3,
    file: "main.js",
    sources: ["../src/main.ts"],
    sourcesContent: ["export const value = 2;\n"],
    names: [],
    mappings: "AAAA",
  }),
);
const run = promisify(execFile),
  env = getDefaultEnvironment();
async function cli(command, args, name) {
  const result = await run(
    process.execPath,
    [join(root, "scripts", "rea.mjs"), command, ...args, "--json"],
    {
      cwd: root,
      env,
      windowsHide: true,
      timeout: 90000,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  await writeFile(join(out, name + ".json"), result.stdout);
  return JSON.parse(result.stdout);
}
const reference = historicalSourceGraphSchema.parse(
  await cli("import-reference-source", [source], "reference"),
);
const application = parseEvidence(
  await cli("analyze-javascript-application", [bundle], "application"),
);
const request = { reference, application };
await writeFile(join(out, "compare.input.json"), JSON.stringify(request));
const cliComparison = parseEvidence(
  await cli(
    "compare-source-to-bundle",
    [join(out, "compare.input.json")],
    "comparison-cli",
  ),
);
function check(evidence) {
  const result = evidence.normalized_result;
  const mapped = result.items.find(
    (item) => item.source_path === "src/main.ts",
  );
  assert(
    mapped.candidates.some((candidate) =>
      candidate.signals.some(
        (signal) => signal.kind === "source-map-original-path",
      ),
    ),
  );
  const stable = result.items.find(
    (item) => item.source_path === "src/stable.js",
  );
  assert(
    stable.candidates.some((candidate) =>
      candidate.signals.some((signal) => signal.kind === "exact-source-digest"),
    ),
  );
  // REA defines duplication over graph nodes, not filesystem copy count:
  // one JS file has asset/module projections carrying the same source digest.
  assert.equal(stable.status, "duplicated");
  assert.equal(
    result.items.find((item) => item.source_path === "src/stable.json").status,
    "unchanged",
  );
  // The reader retains its pathname-race limitation. An unmatched path is not
  // silently upgraded to a proven removal from a partial historical inventory.
  assert.equal(
    result.items.find((item) => item.source_path === "src/unmatched.js").status,
    "unknown",
  );
}
check(cliComparison);
const client = new Client({
  name: "canyon-source-bundle-qualification",
  version: "1.0.0",
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "canyon", "static-mcp.mjs"), "--root", bundle],
  env,
  stderr: "pipe",
  maxBufferSize: 32 * 1024 * 1024,
});
let stderr = "";
transport.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});
try {
  await client.connect(transport);
  const called = await client.callTool({
    name: "compare_source_to_bundle",
    arguments: request,
  });
  assert(!called.isError, JSON.stringify(called.content));
  const evidence = parseEvidence(called.structuredContent);
  check(evidence);
  assert.equal(evidence.evidence_id, cliComparison.evidence_id);
  assert.equal(
    called._meta["canyon/rea-usage"].operation,
    "compare_source_to_bundle",
  );
  const tampered = structuredClone(request);
  tampered.application.limitations.push("TAMPER");
  const refused = await client.callTool({
    name: "compare_source_to_bundle",
    arguments: tampered,
  });
  assert.equal(refused.isError, true);
  await writeFile(join(out, "comparison-mcp.json"), JSON.stringify(evidence));
  await writeFile(
    join(out, "comparison-usage.json"),
    JSON.stringify(called._meta["canyon/rea-usage"], null, 2),
  );
  assert.equal(
    await readFile(join(source, "src", "main.ts"), "utf8"),
    original,
  );
  const report = {
    status: "PASS",
    platform: process.platform,
    checks: [
      "native-filesystem-historical-import",
      "source-map-original-path-match",
      "exact-content-unchanged-match",
      "partial-inventory-unmatched-remains-unknown",
      "CLI-and-MCP-identical-semantic-evidence",
      "local-MCP-usage-observation",
      "tampered-Evidence-refused",
      "target-source-unchanged",
    ],
    evidenceId: evidence.evidence_id,
    rootArtifactSha256: application.subject.digest.sha256,
    historicalRootSha256: reference.root_sha256,
    sourceInventory: reference.inventory_state,
    summary: evidence.normalized_result.summary,
    targetExecution: false,
    limitations: [
      "Qualified on fixed local NTFS using the verified Windows x64 native artifact; not UNC, reparse roots or arbitrary filesystems.",
      "Pathname enumeration race limitation remains explicit; matching is structural evidence, not execution or semantic equivalence.",
    ],
  };
  await writeFile(
    join(out, "source-bundle-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close();
  await writeFile(join(out, "mcp.stderr.txt"), stderr);
}
