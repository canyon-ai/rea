import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';
import { resolve,join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { parseEvidence } from '../dist/domain/evidence.js';
const out=resolve(process.argv[2]??'../rea-trial');
const client=new Client({name:'canyon-mcp-qualification',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('static-mcp.mjs',import.meta.url)),'--root',join(out,'left')],env:getDefaultEnvironment(),stderr:'pipe',maxBufferSize:32*1024*1024});
let stderr='';transport.stderr.on('data',b=>{stderr+=b.toString();});
try {
  await client.connect(transport);
  const list=await client.listTools();
  const names=list.tools.map(t=>t.name).sort();
  assert.deepEqual(names,['analyze_javascript_application','compare_application_versions','compare_javascript_export_shapes','inspect_analysis_view','trace_application_feature','trace_javascript_semantics'].sort());
  const result=await client.callTool({name:'analyze_javascript_application',arguments:{input_path:join(out,'left')}});
  assert(!result.isError,JSON.stringify(result.content));
  const evidence=parseEvidence(result.structuredContent);
  const usage=result._meta['canyon/rea-usage'];
  assert.equal(usage.evidenceId,evidence.evidence_id);assert.equal(usage.operation,'analyze_javascript_application');
  const denied=await client.callTool({name:'analyze_javascript_application',arguments:{input_path:join(out,'right')}});
  assert(denied.isError);assert(JSON.stringify(denied).includes('ANALYSIS_ROOT_REFUSED'));
  await assert.rejects(()=>client.callTool({name:'capture_process',arguments:{}}));
  await writeFile(join(out,'mcp-evidence.json'),JSON.stringify(evidence));
  await writeFile(join(out,'mcp-usage.json'),JSON.stringify(usage,null,2));
  const report={status:'PASS',checks:['real-stdio-initialization','six-static-tools-only','real-analysis-call','upstream-evidence-validation','observed-usage-metadata','outside-root-refused','non-allowlisted-tool-refused'],tools:names,evidenceId:evidence.evidence_id};
  await writeFile(join(out,'mcp-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await client.close();await writeFile(join(out,'mcp.stderr.txt'),stderr);}
