# Canyon static analysis profile

This experimental profile pins REA `rea-agents-6.7.0` at
`27dc42d10249f0410904a75c0997842eb03b931c` plus Canyon's Windows reader fix. It exposes seven existing REA tools
through local stdio MCP. It does not execute analyzed targets or expose native
decompiler providers, runtime capture or mutation. Source-to-bundle comparison is
now qualified on Windows x64 with the matching native artifact on fixed local NTFS.
The wrapper is an application-level restriction, not an OS filesystem sandbox.

## Build and verify

Use a Node version supported by the pinned package (qualification used Node
24.16.0 and npm 11.11.0 on Windows). Install locked dependencies, then build:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run build:cached
node canyon/verify-static.mjs ..\rea-trial
node canyon/verify-mcp.mjs ..\rea-trial
node canyon/verify-source-bundle.mjs ..\rea-windows-trial
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
- `compare_source_to_bundle`

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

A previous upstream run returned **97 passed, 52 failed, 3 skipped** across six
files. The Windows reader fix resolves the no-follow blocker using existing native
read guards, retaining the guard until the borrowed Node file descriptor closes.
Failed close retains one composite cleanup owner; retries preserve close order.
The path suite now returns **55 passed, 3 pre-existing POSIX-only skips, 0 failed**.
All Windows-native path cases still use real filesystem import. Four cases with
NTFS-invalid `?` names use explicitly recorded historical paths and actual ASAR
bytes; their matching assertions still execute. No additional cases were skipped.
The expanded regression run passed **165 tests, 3 skipped** across ten files;
subsequent Windows/CLI coverage includes cancellation during final close.

The real Windows CLI-to-MCP workflow passes historical import, source-map original
matching, exact-byte matching, retained unknowns, identical CLI/MCP Evidence,
call usage metadata, tampered Evidence refusal and unchanged target source.
`compare_source_to_bundle` accepts imported historical graph JSON plus application
Evidence. Import the graph first with the CLI; the comparison itself reads no
source paths. See [workflow](../docs/javascript-application-workflows.md#historical-source-to-bundle-comparison).

Qualification is for regular files on fixed local NTFS with verified native x64
authority. Junction rejection, write/delete exclusion, missing-authority refusal
and cleanup/cancellation are covered. A broader reader run returned 36 passed,
7 pre-existing skips and 7 failures during privileged symbolic-link fixture setup
(`EPERM`). This host cannot create ordinary file/directory symlinks; those seven
cases remain unqualified, and were not hidden or disabled. Junctions were exercised
without that privilege. UNC roots, reparse roots, alternate streams, other
filesystems and full cross-platform regression remain outside this qualification.
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
