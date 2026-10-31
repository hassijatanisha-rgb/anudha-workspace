import {workspacePageHeader} from './helpers/page-header.mjs';
import {installWorkspaceDialogFixture} from './helpers/workspace-dialog-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {dom} from './helpers/dom-identity.mjs';
import {statusTone} from './helpers/status-ui.mjs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function fixture(){
 const document=dom();Object.defineProperty(Object.getPrototypeOf(document.body),'className',{get(){return this.attrs.class||'';},set(value){this.attrs.class=value;}});
 document.body.innerHTML='<main><article data-staff-row="employee"><span class="staff-account-status" data-staff-accounting-status aria-live="polite">Accounting: checking…</span><div class="actions"></div></article></main>';
 const calls=[],messages=[],state={active:true,error:null,readWait:null,writeWait:null,writeError:null};
 const c=vm.createContext({workspacePageHeader,document,statusTone,esc,busy:false,view:'staff',me:{user_id:'owner',role:'owner'},employeeName:()=>'<img src=x> & Person',askConfirm:async()=>true,run:fn=>fn(),message:text=>messages.push(text),client:{rpc:async(name,args)=>{
  calls.push({name,args});if(name==='staff_accounting_access')return state.readWait?state.readWait.promise:{data:[{user_id:'employee',active:state.active}],error:state.error};
  assert.equal(name,'set_accounting_access');return state.writeWait?state.writeWait.promise:{error:state.writeError};
 }}});
 installWorkspaceDialogFixture(c);
 for(const file of ['staff-access.js','data-quality.js'])vm.runInContext(read(file),c);
 const row=document.querySelector('[data-staff-row]'),status=row.querySelector('[data-staff-accounting-status]');
 return {c,document,calls,messages,state,row,status,button:()=>row.querySelector('[data-accounting]')};
}

test('quality badges retain the existing issue thresholds, labels and count with shared tones',()=>{
 const {c}=fixture();assert.equal(c.qualityBadge(c.qualityLevel(0),[]),'');
 for(const count of [1,2,8]){
  const issues=Array.from({length:count},(_,i)=>'Issue '+i),level=c.qualityLevel(count),html=c.qualityBadge(level,issues);
  assert.equal(level,count===1?'yellow':'red');assert.match(html,new RegExp('quality-'+level+' chip chip--'+(count===1?'warning':'danger')));
  assert.ok(html.includes((count===1?'Yellow':'Red')+' · '+count+' to fix'));assert.ok(html.includes(issues.join('; ')));
 }
 assert.equal(c.contactQuality(['Missing phone'],[]).level,'yellow');assert.equal(c.contactQuality(['Missing phone'],[{reason:'Same phone'}]).level,'red');
});

test('quality issues and the legacy class value remain escaped, never executable markup',()=>{
 const {c,document}=fixture(),html=c.qualityBadge('red" onclick="bad()',['<img src=x onerror=bad()> & "quoted"']);
 assert.doesNotMatch(html,/<img|class="[^"]*" onclick=/);assert.match(html,/chip--danger/);assert.match(html,/&lt;img/);assert.match(html,/&quot;quoted&quot;/);
 const node=document.createElement('div');node.innerHTML=html;assert.equal(node.querySelector('img'),null);assert.equal(node.querySelector('span').getAttribute('onclick'),null);
});

for(const [active,error,text,tone] of [[true,null,'Accounting: on','success'],[false,null,'Accounting: off','neutral'],[false,{message:'Unavailable <now>'},'Accounting unavailable','danger']])test(`accounting status reads render ${tone} without changing text or live announcement`,async()=>{
 const f=fixture();Object.assign(f.state,{active,error});await f.c.decorateStaffAccounting();
 assert.equal(f.status.textContent,text);assert.equal(f.status.className,'staff-account-status chip chip--'+tone);assert.equal(f.status.getAttribute('aria-live'),'polite');
 assert.equal(!!f.button(),!error);assert.deepEqual(f.calls.map(call=>call.name),['staff_accounting_access']);
});

test('accounting changes update the same status node after the confirmed write and keep exact args',async()=>{
 const f=fixture();await f.c.decorateStaffAccounting();const button=f.button();
 assert.equal(button.getAttribute('aria-label'),'Remove accounting access for <img src=x> & Person');assert.equal(f.row.querySelector('img'),null);
 await button.onclick();assert.equal(f.status.textContent,'Accounting: off');assert.match(f.status.className,/chip--neutral/);assert.equal(f.row.querySelector('[data-staff-accounting-status]'),f.status);
 assert.equal(button.getAttribute('aria-label'),'Give accounting access for <img src=x> & Person');await button.onclick();assert.match(f.status.className,/chip--success/);
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls.slice(1))),[{name:'set_accounting_access',args:{p_user_id:'employee',p_active:false}},{name:'set_accounting_access',args:{p_user_id:'employee',p_active:true}}]);
});

test('failed accounting writes keep the previously confirmed tone and action state',async()=>{
 const f=fixture();await f.c.decorateStaffAccounting();f.state.writeError={message:'Permission changed'};
 await assert.rejects(f.button().onclick(),/Permission changed/);assert.equal(f.status.textContent,'Accounting: on');assert.match(f.status.className,/chip--success/);assert.equal(f.button().dataset.on,'true');assert.equal(f.messages.length,0);
});

for(const change of ['actor','detached'])test(`late accounting read/write does not recolour a ${change} context`,async()=>{
 const f=fixture(),read=deferred();f.state.readWait=read;const loading=f.c.decorateStaffAccounting();
 if(change==='actor')f.c.me={...f.c.me};else f.row.remove();read.resolve({data:[{user_id:'employee',active:true}]});await loading;
 assert.equal(f.status.textContent,'Accounting: checking…');assert.equal(f.status.className,'staff-account-status');
 const g=fixture();await g.c.decorateStaffAccounting();g.state.writeWait=deferred();const saving=g.button().onclick();await new Promise(setImmediate);assert.equal(g.calls.filter(call=>call.name==='set_accounting_access').length,1);
 if(change==='actor')g.c.me={...g.c.me};else g.row.remove();g.state.writeWait.resolve({});await saving;
 assert.equal(g.status.textContent,'Accounting: on');assert.match(g.status.className,/chip--success/);assert.equal(g.messages.length,0);
});

test('staff import existing-login metadata is neutral and does not claim the login is enabled',async()=>{
 const f=fixture(),name='<img src=x> & Existing';f.c.employeeDirectory=new Map([['employee',{display_name:name}]]);
 f.c.openStaffListImport();const form=f.document.querySelector('dialog').querySelector('form'),file=form.elements.file;
 file.files=[{text:async()=>JSON.stringify({format:'anudha-staff-list-v1',rows:[{full_name:name,role:'staff',department:'sales',start:true}]})}];
 await file.onchange();const preview=form.querySelector('[data-preview]');assert.match(preview.innerHTML,/muted chip chip--neutral/);assert.match(preview.textContent,/Has a login/);assert.equal(preview.querySelector('img'),null);assert.equal(preview.querySelector('[data-row]'),null);assert.equal(form.querySelector('[type="submit"]').disabled,true);
});

test('non-owners do not fetch or decorate accounting status',async()=>{
 const f=fixture();f.c.me={user_id:'employee',role:'staff'};await f.c.decorateStaffAccounting();assert.equal(f.calls.length,0);assert.equal(f.status.className,'staff-account-status');
});
