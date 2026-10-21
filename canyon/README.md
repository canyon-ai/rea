# Canyon static analysis profile

This experimental profile pins REA `rea-agents-6.7.0` at
`27dc42d10249f0410904a75c0997842eb03b931c`. It exposes six existing REA tools
through local stdio MCP. It does not execute analyzed targets or expose native
providers, runtime capture, mutation or source-to-bundle filesystem comparison.
The wrapper is an application-level restriction, not an OS filesystem sandbox.

## Build and verify

Use a Node version supported by the pinned package (qualification used Node
24.16.0 and npm 11.11.0 on Windows). Install locked dependencies, then build:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run build:cached
node canyon/verify-static.mjs ..\rea-trial
node canyon/verify-mcp.mjs ..\rea-trial
```

A source checkout on Windows also needs the matching published Windows native
artifact to satisfy the upstream build. Follow upstream packaging documentation;
verify the package integrity and `node scripts/verify-windows-native-artifact.mjs`.
Do not commit binaries, dependencies, generated output or trial evidence.

Launch with an explicit analysis root:

```powershell
node canyon/static-mcp.mjs --root C:\repos
```

The tool catalog is exactly:

- `analyze_javascript_application`
- `inspect_analysis_view`
- `trace_application_feature`
- `trace_javascript_semantics`
- `compare_application_versions`
- `compare_javascript_export_shapes`

The analysis input must resolve inside the configured root. Use a narrower root
for a particular repository. REA's own path resolution and internal reads remain
part of the trusted local implementation; the wrapper is not a security isolation
boundary for hostile files or concurrent path replacement.

Each completed call keeps upstream Evidence unchanged and adds MCP `_meta`
`canyon/rea-usage`: invocation ID, operation, Evidence/artifact IDs where available,
elapsed milliseconds and error status. Token/cost values and native gateway
receipt remain null. This is a local call observation, not a SmartBlock execution
receipt. Downstream private projections may associate a call with existing blocks;
they must distinguish supplied associations from verified execution.
Preflight refusals and thrown transport errors do not emit this metadata; it is
not a complete invocation audit. Client cancellation is forwarded upstream.

## Qualification, 2026-10-21

The static CLI trial passed six assertions: connected path, unconnected fixture
omitted from a seed trace, removed/added contract fields, retained dynamic unknowns,
and tampered Evidence refusal. Actual stdio MCP passed seven checks including
catalog restriction, upstream Evidence parsing, usage metadata, outside-root input
refusal and unavailable runtime-tool refusal.

A broader upstream run returned **97 passed, 52 failed, 3 skipped** across six
files. All 52 failures were in `sourceToBundlePaths.test.ts`: Windows safe no-follow
open restrictions and POSIX filename cases. This profile excludes that operation.
These failures remain unresolved; the complete REA product is not qualified here.
The five other files passed, covering JS semantics, application workflows,
export shapes, MCP export shapes and domain source-to-bundle comparison logic.
Only the operations exercised by the CLI/MCP trial have end-to-end qualification;
catalog availability alone is not equivalent verification of every input mode.

An initial extensionless TypeScript import `./connected` reported `not-found`;
the passing fixture uses explicit `.ts` paths. Prefer actual compiled artifacts or
check resolution/coverage explicitly. An unresolved edge cannot establish dead
code, runtime absence or semantic equivalence. No native decompiler or runtime
provider was exercised. No model calls were made; model cost/tokens, CPU time and
peak process-family memory were not measured.

This is a bounded development aid. Keep original Evidence, digests, coverage and
unknowns. Propose code changes separately, then run the repository's behavioral
checks. Adopted business logic, native certification and registry admission remain
owned by the receiving system's existing processes.
