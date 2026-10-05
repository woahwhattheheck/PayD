import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { backendCases as cases, required, validators, writeFixtures } from './fixtures.mjs';
import { configuration, sourceMetadata } from './runtime.mjs';

const config = configuration('backend');
const ts = config.dependencyRequire('typescript');
const sourceRootURL = config.sourceURL('');
const dependencyURLs = Object.fromEntries(['fast-csv', '@stellar/stellar-sdk', 'zod'].map(name => [name, config.dependencyURL(name)]));
const { parseCSVPreview } = await import(config.sourceURL('frontend/src/utils/csvPreview.ts'));
const state = { employees: [], queries: [], logs: [] };
globalThis.__csvEvidenceState = state;
const stubs = {
  employee: 'export const employeeService={create:async(employee)=>{globalThis.__csvEvidenceState.employees.push(employee);return employee}};',
  database: 'export const pool={connect:async()=>({query:async(sql)=>{globalThis.__csvEvidenceState.queries.push(sql);return {rows:[]}},release:()=>{}})};',
  logger: 'export default {error:(...args)=>{globalThis.__csvEvidenceState.logs.push(args.map(x=>String(x)))}};',
};
const stubURL = name => 'data:text/javascript,' + encodeURIComponent(stubs[name]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (['fast-csv', '@stellar/stellar-sdk', 'zod'].includes(specifier)) {
      return { url: dependencyURLs[specifier], shortCircuit: true };
    }
    if (context.parentURL?.startsWith(sourceRootURL)) {
      if (specifier === './employeeService.js') return { url: stubURL('employee'), shortCircuit: true };
      if (specifier === '../config/database.js') return { url: stubURL('database'), shortCircuit: true };
      if (specifier === '../utils/logger.js') return { url: stubURL('logger'), shortCircuit: true };
      if (specifier.endsWith('.js') && specifier.startsWith('.')) {
        const url = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
        if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.ts')) {
      const source = readFileSync(fileURLToPath(url), 'utf8');
      const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
      return { format: 'module', source: compiled.outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const { csvPayrollImportService } = await import(config.sourceURL('backend/src/services/csvPayrollImportService.ts'));
const outDir = config.outputDirectory;
const manifest = await writeFixtures(cases, outDir);
const results = [];
for(let index = 0; index < cases.length; index++){
  const testCase = cases[index];
  const saved = manifest[index];
  state.employees=[];state.queries=[];state.logs=[];
  const raw=Buffer.from(testCase.content,'utf8');
  const reloaded = await readFile(join(outDir, saved.file));
  assert.deepEqual(reloaded, raw, testCase.name + ': preserved raw bytes');
  let frontend;
  try{const rows=parseCSVPreview(testCase.content,required,validators);frontend={accepted:true,rows,validCount:rows.filter(x=>x.isValid).length};}
  catch(error){frontend={accepted:false,error:error.message};}
  let backend;
  try{backend={accepted:true,result:await csvPayrollImportService.processCsv(1,testCase.content)};}
  catch(error){backend={accepted:false,error:error.message};assert.equal(state.employees.length,0,'file parser rejection must not store valid prefix');}
  const employees=structuredClone(state.employees);
  if(backend.accepted)assert.equal(backend.result.successCount,employees.length);
  results.push({...saved,frontend,backend,recordedEmployees:employees,recordedDatabaseCommands:[...state.queries],logs:[...state.logs],countMismatch:frontend.accepted&&backend.accepted&&frontend.validCount!==backend.result.successCount});
}
const summary = {
  total:results.length,
  countMismatches:results.filter(x=>x.countMismatch).map(x=>({name:x.name,previewValid:x.frontend.validCount,backend:x.backend.result,employees:x.recordedEmployees})),
  acceptanceMismatches:results.filter(x=>x.frontend.accepted!==x.backend.accepted).map(x=>({name:x.name,frontend:x.frontend,backend:x.backend})),
  salaryConversions:results.filter(x=>x.name==='salary-hex'||x.name==='salary-validation-1'||x.name==='salary-validation-10').map(x=>({name:x.name,preview:x.frontend,backend:x.backend,employees:x.recordedEmployees})),
  fileRejections:results.filter(x=>!x.backend.accepted).map(x=>({name:x.name,error:x.backend.error,recordedWrites:x.recordedEmployees.length})),
};
const evidence = {
  ...sourceMetadata(config), node:process.version, dependencies:config.dependencyVersions,
  status:summary.countMismatches.length||summary.acceptanceMismatches.length ? 'completed-with-observed-mismatches' : 'completed-without-observed-count-or-acceptance-mismatches',
  method:'Actual backend processCsv and actual employee schema; only employeeService, database pool and logger replaced with in-memory recording stubs. Actual frontend preview and snapshotted EmployeeList validators. No network requests, database writes, source mutations, or product dependency changes. Exit zero records successful collection and narrow invariants, not full API/database/frontend equivalence.',
  summary,cases:results,
};
await writeFile(join(outDir,'backend-validation.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({status:evidence.status,...summary},null,2));
