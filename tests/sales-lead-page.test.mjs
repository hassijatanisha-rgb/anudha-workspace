import {installPageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,actor=id(1),other=id(2);
const deferred=()=>{let resolve,reject;const promise=new Promise((ok,bad)=>{resolve=ok;reject=bad});return {promise,resolve,reject}};
const row=n=>({id:id(100+n),lead_number:'LD-'+n,stage:'lead',source:'phone',organization_id:'clinic',contact_id:'contact',subject:'Analyzer <quote> '+n,details:'Full private details',caller_name:'Caller',caller_phone:'0712345678',caller_organization:'Clinic',caller_role:'doctor',owner_user_id:actor,next_action:'Call with a price',next_action_on:'2099-01-01',created_at:'2026-10-01T08:00:00Z',updated_at:'2026-10-01T08:00:00Z',created_by:actor,estimated_value_minor:null,currency:'TZS',lost_reason:'',proforma_id:null,version:3});
const summary=n=>{const r=row(n);return {id:r.id,page_summary:true,lead_number:r.lead_number,stage:r.stage,subject:r.subject,client_label:'Clinic <site>',owner_user_id:r.owner_user_id,next_action_on:r.next_action_on}};
function fixture(){
 const calls=[],loads=[],reads=[],controls=new Map(),buttons=[],timers=new Map(),forms=[],messages=[],document={activeElement:null};let html='',serial=0;
 const content={};Object.defineProperty(content,'innerHTML',{get:()=>html,set:value=>{
  for(const control of [...controls.values(),...buttons])control.isConnected=false;controls.clear();buttons.length=0;html=value;
  for(const match of value.matchAll(/<(button|input)\b[^>]*>/g)){
   const attrs=Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(part=>[part[1],part[2]]));
   const control={id:attrs.id,value:attrs.value||'',dataset:{},disabled:/\sdisabled\b/.test(match[0]),isConnected:true,selectionStart:0,selectionEnd:0,selectionDirection:'none',scrollLeft:0,parentElement:null,
    addEventListener(event,fn){this['on'+event]=fn},focus(){document.activeElement=this},setSelectionRange(start,end,direction){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction},scrollIntoView(){}};
   for(const [key,val] of Object.entries(attrs))if(key.startsWith('data-'))control.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=val;
   if(control.id)controls.set('#'+control.id,control);if(match[1]==='button')buttons.push(control);
  }
 }});
 document.querySelectorAll=selector=>{const attr=selector.match(/^\[data-([\w-]+)\]$/)?.[1];if(!attr)return [];const key=attr.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());return buttons.filter(button=>Object.hasOwn(button.dataset,key));};
 document.getElementById=id=>controls.get('#'+id)||null;document.querySelector=()=>null;
 const c=vm.createContext({statusTone,me:{user_id:actor,role:'staff'},view:'leads',document,window:{scrollX:4,scrollY:150,scrollTo(x,y){this.scrollX=x;this.scrollY=y;}},CSS:{escape:String},
  esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
  employeeDirectory:new Map([[actor,{user_id:actor,display_name:'Asha <Sales>'}],[other,{user_id:other,display_name:'Baraka'}]]),
  employeeName:key=>!key?'Unassigned':c.employeeDirectory.get(key)?.display_name||(key===c.me?.user_id?'You':'Employee name not set'),
  products:[{id:'product',name:'Complete product'}],contacts:[{id:'contact',phone:'0755555555',position:'Doctor'}],orgIndex:new Map([['clinic',{name:'Full clinic',location:'Dar'}]]),salesProformas:[{id:'existing',document_number:'PF-full'}],salesLoaded:false,salesPrefill:null,salesSection:'',salesEditing:'',hasArea:()=>true,
  listsLoaded:false,listsLoading:null,loadLists:async()=>{loads.push('shared lists');if(c.listError)throw Error(c.listError);c.listsLoaded=true;},
  all:async table=>{loads.push(table);if(c.fullError)throw Error(c.fullError);return table==='sales_leads'?[row(0),row(1)]:[{id:'full-pf',document_number:'PF-001',organization_id:'clinic'}];},
  client:{rpc:async(name,args)=>{calls.push({name,args});return c.response?c.response(name,args):{data:c.page(args.p_page)};},from:table=>{let key;const q={select:()=>q,eq:(field,value)=>{assert.equal(field,'id');key=value;return q;},maybeSingle:async()=>{reads.push({table,id:key});return c.readResult?c.readResult(key):{data:{...row(2000),id:key}};}};return q;}},
  $:selector=>selector==='#content'?content:controls.get(selector)||null,run:fn=>fn(),message:(...args)=>messages.push(args),syncWorkspaceNavigation(){},workspaceLoading:text=>{content.innerHTML='Loading '+text;},render:()=>loads.push('sales render'),
  actionForm:(title,fields,submit)=>forms.push({title,fields,submit}),inventoryOption:(value,label)=>`<option value="${value}">${label}</option>`,
  setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:key=>timers.delete(key)
 });
 installPageHeader(c);for(const file of ['business-date.js','search-state.js','sales-leads.js'])vm.runInContext(read(file),c);
 c.page=(page=0,total=105)=>{page=Math.min(page,Math.max(0,Math.ceil(total/25)-1));return {rows:Array.from({length:Math.min(25,Math.max(0,total-page*25))},(_,n)=>summary(page*25+n)),total,page,pages:Math.max(1,Math.ceil(total/25)),counts:{open:105,new:4,mine:100,won:3,lost:2,all:110}};};
 c.decorateOrderLiveStatus=async()=>loads.push('live decorator');c.decorateLeadHandovers=async()=>loads.push('handover decorator');
 const get=code=>vm.runInContext(code,c),button=(key,value)=>buttons.find(item=>item.dataset[key]===value);
 return {c,calls,loads,reads,controls,buttons,content,forms,messages,timers,get,button,flush:async()=>{for(const [key,fn] of timers){timers.delete(key);await fn();}await new Promise(resolve=>setImmediate(resolve));}};
}
test('cold landing uses one request and 25 compact summaries, preserving complete editor caches',async()=>{
 const f=fixture(),products=f.c.products,proformas=f.c.salesProformas;
 f.get(`leadRows=[${JSON.stringify(row(3000))}];leadLoaded=true`);const complete=f.get('leadRows');
 await f.c.leadsWorkspace();assert.deepEqual(f.calls.map(call=>call.name),['sales_lead_page']);assert.deepEqual(f.loads,[]);assert.deepEqual(f.reads,[]);
 assert.equal(f.calls[0].args.p_filter,'open');assert.equal(Object.hasOwn(f.calls[0].args,'p_owner_names'),false);assert.equal(f.get('leadRows'),complete);assert.equal(f.c.products,products);assert.equal(f.c.salesProformas,proformas);
 assert.equal((f.content.innerHTML.match(/data-lead-summary=/g)||[]).length,25);assert.equal((f.content.innerHTML.match(/<[a-z][\w-]*(?:\s|>)/gi)||[]).length<1500,true);
 assert.equal(f.content.innerHTML.replace(/<[^>]+>/g,' ').split(/\s+/).length<1500,true);assert.match(f.content.innerHTML,/Asha &lt;Sales>/);assert.match(f.content.innerHTML,/Clinic &lt;site>/);
 assert.doesNotMatch(f.content.innerHTML,/Full private details|data-lead-handovers|data-lead-history|data-lead-proforma|<details/);assert.match(f.content.innerHTML,/105 matching leads/);
});
test('paging and filters issue one request each and render only their page, including clamped empty pages',async()=>{
 const f=fixture();await f.c.leadsWorkspace();await f.controls.get('#leadNext').onclick();await f.flush();assert.equal(f.calls.at(-1).args.p_page,1);assert.match(f.content.innerHTML,/LD-25/);assert.doesNotMatch(f.content.innerHTML,/data-lead-summary="00000000-0000-4000-8000-000000000100"/);
 await f.button('leadFilter','won').onclick();await f.flush();assert.equal(f.calls.at(-1).args.p_filter,'won');assert.equal(f.calls.at(-1).args.p_page,0);
 f.c.page=()=>({rows:[],total:0,page:0,pages:1,counts:{open:0,new:0,mine:0,won:0,lost:0,all:0}});f.get('leadPage=999');await f.c.leadsWorkspace();
 assert.equal(f.calls.length,4);assert.equal(f.get('leadPage'),0);assert.match(f.content.innerHTML,/No leads match/);assert.equal(f.controls.get('#leadPrev').disabled,true);assert.equal(f.controls.get('#leadNext').disabled,true);assert.deepEqual(f.loads,[]);
});

test('refused paging and filter presses cannot change lead state or make another request',async()=>{
 const f=fixture();await f.c.leadsWorkspace();const calls=f.calls.length;
 f.c.run=()=>undefined;
 await f.controls.get('#leadNext').onclick();await f.button('leadFilter','won').onclick();
 assert.equal(f.get('leadPage'),0);assert.equal(f.get('leadFilter'),'open');assert.equal(f.calls.length,calls);
});

test('lead conversion waits for the destination and suppresses a late message after actor replacement',async()=>{
 const f=fixture(),wait=deferred();let complete=false;f.c.render=()=>wait.promise;
 const opening=f.c.startProformaFromLead(row(0)).then(()=>{complete=true;});
 assert.equal(f.c.view,'sales');assert.equal(complete,false);assert.equal(f.messages.length,0);
 f.c.me={...f.c.me};wait.resolve();await opening;assert.equal(complete,true);assert.equal(f.messages.length,0);
});
test('search debounces to one request, sends names only for nonempty search and restores caret and scroll',async()=>{
 const f=fixture();await f.c.leadsWorkspace();const input=f.controls.get('#leadSearch');input.focus();
 for(const value of ['A','Ash',' Asha %_ ']){input.value=value;input.oninput({target:input});}input.selectionStart=2;input.selectionEnd=5;input.selectionDirection='backward';input.scrollLeft=7;
 assert.equal(f.calls.length,1);assert.equal(f.timers.size,1);await f.flush();assert.equal(f.calls.length,2);assert.equal(f.calls[1].args.p_query,' Asha %_ ');assert.equal(f.calls[1].args.p_owner_names[actor],'Asha <Sales>');
 const next=f.controls.get('#leadSearch');assert.equal(f.c.document.activeElement,next);assert.deepEqual([next.selectionStart,next.selectionEnd,next.selectionDirection,next.scrollLeft],[2,5,'backward',7]);assert.equal(f.c.window.scrollY,150);
 next.value=' ';next.oninput({target:next});await f.flush();assert.equal(Object.hasOwn(f.calls.at(-1).args,'p_owner_names'),false);
});
test('Open loads full context once, displays one complete lead and preserves the existing conversion contract',async()=>{
 const f=fixture();await f.c.leadsWorkspace();await f.button('leadOpen',row(0).id).onclick();
 assert.deepEqual(f.loads,['shared lists','sales_leads','sales_proformas','live decorator','handover decorator']);assert.equal(f.reads.length,0);assert.equal(f.get('leadRows.length'),2);assert.equal(f.get('leadLanding()'),false);
 assert.equal((f.content.innerHTML.match(/data-lead-card=/g)||[]).length,1);assert.match(f.content.innerHTML,/Full private details/);assert.doesNotMatch(f.content.innerHTML,/data-lead-summary=/);assert.equal(f.c.document.activeElement.id,'leadBack');
 f.c.startProformaFromLead(f.get('leadRows[0]'));assert.equal(f.c.view,'sales');assert.deepEqual(JSON.parse(JSON.stringify(f.c.salesPrefill)),{organizationId:'clinic',contactId:'contact',leadNumber:'LD-0'});assert.equal(f.c.salesEditing,'new');
});
test('New and archived deep links load full data only on explicit opening; Back retains the page and search',async()=>{
 const f=fixture();await f.c.leadsWorkspace();f.c.leadEditor=()=>'<section id="new-editor">New form</section>';
 await f.controls.get('#newLead').onclick();assert.equal(f.get('leadEditing'),'new');assert.match(f.content.innerHTML,/New form/);assert.ok(f.c.listsLoaded);await f.controls.get('#leadBack').onclick();await f.flush();
 f.get(`leadSearch='Archived';leadFilter='all';leadPage=2`);await f.c.leadsWorkspace();f.c.focusLead(row(2000).id);await f.c.leadsWorkspace();assert.deepEqual(f.reads,[{table:'sales_leads',id:row(2000).id}]);assert.match(f.content.innerHTML,/LD-2000/);
 await f.controls.get('#leadBack').onclick();await f.flush();assert.equal(f.calls.at(-1).args.p_query,'Archived');assert.equal(f.calls.at(-1).args.p_filter,'all');assert.equal(f.get('leadLanding()'),true);
});
test('direct page Open and Back preserve the prior page without resetting it',async()=>{
 const f=fixture();f.get("leadFilter='all';leadSearch='quote';leadPage=3");await f.c.leadsWorkspace();await f.button('leadOpen',summary(75).id).onclick();await f.controls.get('#leadBack').onclick();await f.flush();
 assert.equal(f.calls.at(-1).args.p_page,3);assert.equal(f.calls.at(-1).args.p_query,'quote');assert.equal(f.calls.at(-1).args.p_filter,'all');
});
for(const problem of ['permission','oversized','duplicate','unknown-stage','bad-total'])test(`a ${problem} response cannot become usable summary data`,async()=>{
 const f=fixture();f.c.response=()=>{const data=f.c.page();if(problem==='permission')return {error:{message:'Access <denied>'}};if(problem==='oversized')data.rows.push(summary(25));if(problem==='duplicate')data.rows[1]=data.rows[0];if(problem==='unknown-stage')data.rows[0].stage='admin';if(problem==='bad-total')data.total=NaN;return {data};};
 await f.c.leadsWorkspace();assert.match(f.content.innerHTML,/role="alert"/);assert.doesNotMatch(f.content.innerHTML,/data-lead-open=/);assert.equal(f.get('leadPageData'),null);assert.deepEqual(f.loads,[]);
 if(problem==='permission')assert.match(f.content.innerHTML,/Access &lt;denied>/);
});
for(const change of ['actor','same-user-session','route','request'])test(`${change} change discards pending landing completion and errors`,async()=>{
 for(const fail of [false,true]){const f=fixture(),wait=deferred();f.c.response=()=>wait.promise;const pending=f.c.leadsWorkspace();
  if(change==='actor'||change==='same-user-session')f.c.me={user_id:change==='actor'?other:actor};
  else if(change==='route')f.c.view='staff';else{f.c.response=null;f.get("leadFilter='mine'");await f.c.leadsWorkspace();}
  const before=f.content.innerHTML;if(fail)wait.reject(Error('late private error'));else wait.resolve({data:f.c.page()});await pending;assert.equal(f.content.innerHTML,before);
 }
});
test('a fresh actor clears private detail/page state and cancels pending search work',async()=>{
 const f=fixture();await f.c.leadsWorkspace();const input=f.controls.get('#leadSearch');input.value='private';input.oninput({target:input});f.get(`leadRows=[${JSON.stringify(row(0))}];leadLoaded=true;leadSelectedId='private'`);
 f.c.me={user_id:other};await f.c.leadsWorkspace();assert.equal(f.get('leadRows.length'),0);assert.equal(f.get('leadSelectedId'),'');assert.equal(f.get('leadSearch'),'');assert.equal(f.calls.at(-1).args.p_filter,'open');assert.equal(f.calls.at(-1).args.p_query,'');assert.equal(f.timers.size,0);
});
test('session clearing removes search/filter/page state even before a new actor is installed',async()=>{
 const f=fixture();await f.c.leadsWorkspace();f.get("leadSearch='Private caller';leadFilter='mine';leadPage=3");f.c.clearLeads();assert.equal(f.get('leadSearch'),'');assert.equal(f.get('leadFilter'),'open');assert.equal(f.get('leadPage'),0);assert.equal(f.get('leadPageData'),null);assert.equal(f.get('leadRows.length'),0);
});
for(const failure of ['lists','full','missing'])test(`failed ${failure} detail loading never opens a partial editor`,async()=>{
 const f=fixture();await f.c.leadsWorkspace();if(failure==='lists')f.c.listError='Shared records unavailable';if(failure==='full')f.c.fullError='Full record unavailable';if(failure==='missing')f.c.readResult=()=>({data:null});
 await f.c.openLeadDetail(row(2000).id,'edit');assert.equal(f.get('leadLanding()'),true);assert.equal(f.get('leadEditing'),'');assert.match(f.content.innerHTML,/role="alert"/);assert.doesNotMatch(f.content.innerHTML,/id="leadForm"|data-lead-card=/);
});
test('a pending detail request cannot open after navigating away or replacing the same-user session',async()=>{
 for(const change of ['route','session','request']){const f=fixture(),wait=deferred();f.c.loadLists=()=>wait.promise;const pending=f.c.openLeadDetail(row(0).id);if(change==='route')f.c.view='staff';else if(change==='session')f.c.me={user_id:actor};else{f.c.response=null;await f.c.leadsWorkspace();}const before=f.content.innerHTML;f.c.listsLoaded=true;wait.resolve();await pending;assert.equal(f.content.innerHTML,before);assert.equal(f.loads.length,0);}
});
for(const reject of [false,true])test(`a scoped confirmed-record ${reject?'failure':'read'} cannot reopen a detail after Back or a newer page request`,async()=>{
 const f=fixture();await f.c.openLeadDetail(row(0).id);const wait=deferred();f.c.readResult=()=>wait.promise;const pending=f.c.leadRefreshOne(row(0).id);await f.controls.get('#leadBack').onclick();await f.flush();const before=f.content.innerHTML;if(reject)wait.reject(Error('Late read failure'));else wait.resolve({data:{...row(0),stage:'lost'}});await pending;assert.equal(f.content.innerHTML,before);assert.equal(f.get('leadLanding()'),true);
});
for(const action of ['advance','handover'])test(`${action} preserves versioned RPC fields and rejects stale forms before any write`,async()=>{
 const f=fixture();await f.c.openLeadDetail(row(0).id);const selected=f.get('leadRows[0]');
 const open=()=>action==='advance'?f.c.openLeadAction(selected,'lost'):f.c.openLeadHandover(selected);open();f.c.me={user_id:actor};await assert.rejects(f.forms.at(-1).submit({assignee:other,note:'Please call this customer back'}),/Reopen the lead/);assert.equal(f.calls.length,0);
 await f.c.openLeadDetail(row(0).id);open();f.c.response=()=>({data:{...row(0),version:4}});f.c.readResult=()=>({data:{...row(0),version:4}});
 await f.forms.at(-1).submit({assignee:other,note:'Please call this customer back',nextAction:'Call',nextActionOn:'2099-01-02'});assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.p_id,row(0).id);assert.equal(f.calls[0].args.p_expected_version,3);assert.equal(f.calls[0].name,action==='advance'?'advance_sales_lead':'hand_over_sales_lead');assert.equal(f.reads.length,0);assert.equal(f.get('leadRows[0].version'),3);assert.equal(f.get('leadRows.find(row=>row.id==="'+row(0).id+'").version'),4);
});
test('pending action completion cannot announce or reread into a replacement session',async()=>{
 const f=fixture();await f.c.openLeadDetail(row(0).id);f.c.openLeadAction(f.get('leadRows[0]'),'lost');const wait=deferred();f.c.response=()=>wait.promise;const pending=f.forms.at(-1).submit({note:'No longer needed'});f.c.me={user_id:actor};wait.resolve({data:{}});await pending;assert.equal(f.reads.length,0);assert.equal(f.messages.length,0);
});
