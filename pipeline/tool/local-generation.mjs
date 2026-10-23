import fs from 'node:fs';
import path from 'node:path';
import {pipelineCommands,normalizeSettings,runProcess} from './auto-publish.mjs';
import {snapshotPublicFiles,restorePublicFiles} from './auto-publish-files.mjs';
import {acquireMonitorLock} from './monitor-lock.mjs';
import {matchesAppliedSource,readAppliedLodestoneState} from './lodestone-applied-state.mjs';
import {containedPath} from './publication-paths.mjs';

// Generation changes only this VPS worktree. No credentials, git operations,
// notifications, Actions, external deployment, or arbitrary command arguments.
export async function runLocalGeneration({root,current,config={},run=runProcess,
  snapshot=snapshotPublicFiles,restore=restorePublicFiles,
  readApplied=readAppliedLodestoneState}={}) {
  root=path.resolve(root);
  if(!current?.RecipeRefreshId&&!current?.AcquisitionRefreshId&&!current?.QualityRecipeKeys?.length&&matchesAppliedSource(readApplied({repositoryRoot:root}),current))return {status:'already-applied',published:false};
  const stateRoot=containedPath(root,'pipeline/state');
  const release=acquireMonitorLock(path.join(stateRoot,'auto-publish.lock'));
  const journal=path.join(stateRoot,'local-generation.json');
  const settings={...normalizeSettings(config),delayMs:Math.max(0,Number(config.delayMs??100)||0),
    freshAudit:Boolean(current?.RecipeRefreshId),acquisitionOnly:Boolean(current?.AcquisitionRefreshId&&!current?.RecipeRefreshId),
    qualityOnly:Boolean(current?.QualityRecipeKeys?.length&&!current?.RecipeRefreshId),qualityRecipeKeys:current?.QualityRecipeKeys||[]};
  let backup;
  const record={status:'generating',published:false,startedAt:new Date().toISOString(),completedCommands:[]};
  const save=()=>{const temporary=journal+'.tmp';fs.writeFileSync(temporary,JSON.stringify(record,null,2)+'\n',{mode:0o600});fs.renameSync(temporary,journal)};
  try {
    backup=fs.mkdtempSync(path.join(stateRoot,'local-generation-files-'));
    snapshot(root,backup);record.backup=path.relative(root,backup).split(path.sep).join('/');save();
    for(const args of pipelineCommands(settings)) {
      await run(process.execPath,[`--max-old-space-size=${settings.nodeHeapMb}`,path.join(root,'pipeline/tool/pipeline-tool.mjs'),...args],
        {cwd:root,timeoutMs:12*60*60*1000});
      record.completedCommands.push(args[0]);save();
    }
    await run(process.execPath,[path.join(root,'tools/validate-site.mjs'),'--data-only'],{cwd:root,timeoutMs:2*60*60*1000});
    if(!readApplied({repositoryRoot:root}))throw new Error('Generated data lineage validation failed');
    record.status='generated';record.finishedAt=new Date().toISOString();save();
    return {status:'generated',published:false,completedCommands:record.completedCommands};
  } catch(error) {
    if(backup)restore(root,backup);
    record.status='failed';record.finishedAt=new Date().toISOString();save();throw error;
  } finally {release()}
}
