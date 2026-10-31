import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {cases,sectionKeys,routeKey,openMainPageScenario} from '../tests/helpers/main-page-scenarios.mjs';
import {landingHead,landingSnapshot,serializeLandingNode,installLandingValueReflection,axeScript,shellScripts,shellBootstrapScript,shellBootstrapSource} from '../tests/helpers/landing-snapshot.mjs';

const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const defaultOutput=fileURLToPath(new URL('../../interface-refinement-preview/axe-landings/',import.meta.url));
const digest=value=>createHash('sha256').update(value).digest('hex');
const caseId=(entry,role)=>entry.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')+'--'+role;
const limitations=[
 'Fictional landing markup with authored responsive-shell initialization only; no live account, authentication service, database or workflow writer is connected.',
 'Keyboard behavior, focus restoration, live announcements, dialogs, gestures and workflow interactions require separate browser acceptance.',
 'Identity-DOM geometry and style mutation are mocked when rendering page content. Only actual ui-motion.js, nav-dropdown.js and ui-page-header.js initialize responsive navigation and measure eligible original landing actions from permission-filtered markup in the browser. The generated bootstrap invokes the header installer only; other page-specific runtime decorators are not run.',
 'Runtime theme and text-size attributes are retained. The browser harness must record any theme/viewport overrides; larger-text acceptance is separate.',
 'Authored CSS and the three shell scripts are served from /source/ in recorded order; their SHA-256 hashes and the generated shell-bootstrap.js hash must still match when browser checks run.',
 'Exports contain initial landing states only; collapsed or unmounted details, forms, errors and subsequent pages are not accessibility-tested by this export.',
 'Route buttons and workflow controls are unsupported in these read-only exports; no app routing, authentication or action globals are provided. Rendered shell geometry does not establish navigation or keyboard-interaction acceptance.'
];

async function writeManifest(output,manifest){
 await writeFile(resolve(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 const finite=manifest.cases.filter(entry=>entry.status==='ready').map(({id,role,page,url})=>({id,role,page,url}));
 await writeFile(resolve(output,'manifest.js'),'window.axeLandingCases = '+JSON.stringify(finite).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029')+';\n');
}

export async function exportAxeLandings({output=defaultOutput}={}){
 const index=await readFile(resolve(sourceRoot,'index.src.html'),'utf8'),head=landingHead(index);
 const styles=await Promise.all(head.styles.map(async link=>{
  const path=link.href.slice('/source/'.length).split('?')[0];
  return {url:link.href,sha256:digest(await readFile(resolve(sourceRoot,path)))};
 }));
 const runtimeScripts=await Promise.all(shellScripts.map(async url=>{const path=url.slice('/source/'.length);return {path,url,sha256:digest(await readFile(resolve(sourceRoot,path)))};}));
 const manifest={mode:'fictional-landings-with-authored-shell',generatedAt:new Date().toISOString(),completed:false,axeScript,sourceIndexSha256:digest(index),styles,runtimeScripts,shellBootstrap:{url:shellBootstrapScript,sha256:digest(shellBootstrapSource)},shellReadiness:'After iframe load, wait for #nav[data-dropdown="1"][data-shell-mode], #workspaceShortcuts and html[data-landing-shell-ready="true"], then two animation frames for measured shortcut and eligible primary-action bottom insets. Packing TV intentionally hides its shell.',limitations,expectedCases:cases.reduce((total,entry)=>total+entry.roles.length,0),navigationTargets:new Set(cases.map(entry=>routeKey(entry.state.view,entry.state[sectionKeys[entry.state.view]]))).size,renderedVariants:cases.length,cases:[]};
 await mkdir(output,{recursive:true});await writeFile(resolve(output,'shell-bootstrap.js'),shellBootstrapSource);await writeManifest(output,manifest);
 for(const entry of cases)for(const role of entry.roles){
  const id=caseId(entry,role),url='/axe-landings/'+id+'.html';
  if(manifest.cases.some(row=>row.id===id))throw Error('Duplicate landing export ID: '+id);
  const record={id,role,page:entry.name,url,requestedState:entry.state,status:'failed'};
  try{
   const fixture=await openMainPageScenario(entry,role,fixture=>installLandingValueReflection(fixture.document)),html=landingSnapshot(fixture.document,index);
   if(!manifest.authoredScripts){
    manifest.fixtureDate=fixture.evaluate('new Date().toISOString()');
    manifest.authoredScripts=await Promise.all(fixture.scripts.map(async path=>({path,sha256:digest(await readFile(resolve(sourceRoot,path)))})));
   }
   await writeFile(resolve(output,id+'.html'),html);
   Object.assign(record,{status:'ready',sha256:digest(html),markupSha256:digest(serializeLandingNode(fixture.document.body)),navigationSha256:digest(serializeLandingNode(fixture.document.querySelector('#nav'))),bytes:Buffer.byteLength(html),renderedView:fixture.evaluate('view'),renderedHash:fixture.ctx.location.hash,databaseRequests:fixture.calls.length,authProviderStubs:fixture.authCalls.length});
  }catch(error){record.error=error.message||String(error);}
  manifest.cases.push(record);
 }
 manifest.completed=manifest.cases.length===manifest.expectedCases&&manifest.cases.every(entry=>entry.status==='ready');
 await writeManifest(output,manifest);return manifest;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const manifest=await exportAxeLandings();
 console.log(`${manifest.cases.filter(entry=>entry.status==='ready').length}/${manifest.expectedCases} fictional landings exported to ${defaultOutput}`);
 if(!manifest.completed){for(const entry of manifest.cases.filter(entry=>entry.status!=='ready'))console.error(`${entry.id}: ${entry.error}`);process.exitCode=1;}
}
