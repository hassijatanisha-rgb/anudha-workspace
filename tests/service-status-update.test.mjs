import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}};
const row=(id,extra={})=>({id,case_number:'INS-'+id,case_type:'installation',organization_id:'clinic',product_id:'machine',status:'new',version:3,assigned_user_id:null,scheduled_for:null,created_at:'2026-10-01T08:00:00Z',updated_at:'2026-10-01T08:00:00Z',...extra});
function fixture(){
 const calls=[],messages=[],decorations=[],forms=[],cards=new Map(),draft={value:'Keep this intake draft'},document={activeElement:null};
 const parent={children:[],insertBefore(card,after){this.children=this.children.filter(node=>node!==card);const index=after?this.children.indexOf(after):this.children.length;this.children.splice(index,0,card)}};
 const makeCard=html=>{
  const id=html.match(/data-service-card="([^"]+)"/)[1],card={dataset:{serviceCard:id},className:html.match(/class="([^"]+)"/)[1],parentNode:parent,childNodes:[{html}],isConnected:true,history:{open:false},buttons:[],handoff:true};
  card.mount=markup=>{card.html=markup;card.buttons.forEach(button=>button.parent=null);card.buttons=[...markup.matchAll(/<button[^>]*data-service-action="([^"]+)"[^>]*data-id="([^"]+)"/g)].map(match=>({dataset:{serviceAction:match[1],id:match[2]},parent:card,closest:selector=>selector==='[data-service-card]'?card:null,focus(){document.activeElement=this}}));card.actions={files:null,querySelector:()=>card.actions.files,append:button=>card.actions.files=button};card.handoff=false;};
  card.mount(html);card.handoff=true;
  card.querySelector=selector=>selector==='.workflow-history'?card.history:selector==='.actions'?card.actions:selector==='.primary-action,button'?card.buttons[0]||card.actions.files:null;
  card.querySelectorAll=selector=>selector==='[data-service-action]'?card.buttons:[];
  card.contains=node=>node===card||card.buttons.includes(node);card.focus=()=>document.activeElement=card;
  card.replaceChildren=(...children)=>{card.childNodes=children;card.mount(children[0].html);card.history={open:false}};
  return card;
 };
 let metrics={replaceWith(next){metrics=next}};
 document.querySelector=selector=>selector==='.service-metrics'?metrics:cards.get(selector.match(/data-service-card="([^"]+)"/)?.[1])||null;
 document.querySelectorAll=selector=>selector==='[data-service-card]'?[...cards.values()]:[];
 document.createElement=tag=>{
  if(tag==='button')return {dataset:{}};
  assert.equal(tag,'template');const template={content:{}};
  Object.defineProperty(template,'innerHTML',{set(html){template.content.firstElementChild=html.includes('data-service-card=')?makeCard(html):{html,replaceWith(next){metrics=next}}}});return template;
 };
 const window={scrollX:12,scrollY:800,scrollTo({left,top}){this.scrollX=left;this.scrollY=top}},ctx=vm.createContext({statusTone,me:{user_id:'engineer',role:'staff'},view:'service',document,window,CSS:{escape:String},
  esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),employeeName:id=>id,inventoryProduct:()=>({name:'Fixture machine'}),orgIndex:new Map([['clinic',{name:'Clinic'}]]),
  inventoryOption:(id,label)=>`<option value="${id}">${label}</option>`,message:(text,error)=>messages.push({text,error}),actionForm:(title,fields,submit)=>{forms.push({title,fields,submit});return {querySelector:()=>({})}},
  actionFeedbackActive:null,actionFeedbackReference:node=>({node}),openDocumentAttachments(){},run:fn=>fn(),
  all(){throw Error('Full history loader must not run')},workspaceLoading(){throw Error('Page replacement must not run')},
  decorateWorkHandoffs:async()=>{const changed=[...cards.values()].filter(card=>!card.handoff);decorations.push(changed.map(card=>card.dataset.serviceCard));changed.forEach(card=>card.handoff=true)},
  client:{rpc:async(name,args)=>{calls.push({name,args});return {data:row(args.p_id,{status:'assigned',version:4,assigned_user_id:args.p_assigned_user_id,updated_at:'2026-10-29T08:00:00Z'})}},from(table){
   const request={table,filters:[],orders:[]},query={select(){return query},eq(...filter){request.filters.push(filter);return query},order(...order){request.orders.push(order);return query},limit(limit){request.limit=limit;return query},then(ok,bad){calls.push(request);return Promise.resolve(ctx.eventResult).then(ok,bad)}};return query;
  }}
 });
 for(const file of ['business-date.js','service-domain.js','service-workflow.js'])vm.runInContext(read(file),ctx);
 const set=code=>vm.runInContext(code,ctx);ctx.seed=[row('changed'),row('other')];set('serviceCases=seed;serviceLoaded=true;serviceEvents=[{id:"old-event",case_id:"changed",to_status:"new",created_at:"2026-10-01T08:00:00Z",note:"Created",actor_user_id:"engineer"}]');
 for(const record of ctx.seed){const card=makeCard(ctx.serviceCaseCard(record));cards.set(record.id,card);parent.children.push(card)}
 cards.get('changed').history.open=true;
 ctx.eventResult={data:[{id:'saved-event',case_id:'changed',to_status:'assigned',created_at:'2026-10-29T08:00:00Z',note:'Confirmed <note>',actor_user_id:'engineer'}]};
 return {ctx,calls,messages,decorations,forms,cards,parent,draft,window,set,get:set,metrics:()=>metrics};
}
test('confirmed status action patches only its case, history and metrics without full loaders',async()=>{
 const f=fixture(),changed=f.cards.get('changed'),other=f.cards.get('other'),oldOtherHtml=other.html;
 f.ctx.actionFeedbackActive={successOrigin:{node:changed.buttons[0]}};
 f.ctx.openServiceAction(f.ctx.seed[0],'assign');await f.forms[0].submit({assignee:'engineer',note:'Confirmed <note>'});
 assert.equal(f.calls.length,2);assert.equal(f.calls[0].name,'advance_service_case');assert.equal(f.calls[0].args.p_expected_version,3);
 assert.deepEqual(f.calls[1].filters,[['case_id','changed'],['created_at','2026-10-29T08:00:00Z']]);assert.equal(f.calls[1].limit,1);
 assert.equal(f.get('serviceCases[0].version'),4);assert.equal(f.get('serviceEvents.length'),2);assert.equal(f.get('serviceLoaded'),true);
 assert.equal(f.cards.get('other'),other);assert.equal(other.html,oldOtherHtml);assert.equal(f.draft.value,'Keep this intake draft');
 assert.match(changed.html,/Confirmed &lt;note>/);assert.equal(changed.history.open,true);assert.ok(changed.actions.files);assert.equal(typeof changed.buttons[0].onclick,'function');
 assert.deepEqual(f.decorations,[['changed']]);assert.equal(f.ctx.actionFeedbackActive.successOrigin.node,changed.buttons[0]);
 assert.match(f.metrics().html,/Awaiting engineer<\/small><strong>1/);assert.equal(f.window.scrollX,12);assert.equal(f.window.scrollY,800);
});
test('current history failure keeps confirmed status, marks the audit gap and does not invite a duplicate write',async()=>{
 const f=fixture();f.ctx.eventResult={error:{message:'History <offline>'}};
 f.ctx.openServiceAction(f.ctx.seed[0],'assign');await f.forms[0].submit({assignee:'engineer',note:'Confirmed'});
 assert.equal(f.get('serviceCases[0].version'),4);assert.equal(f.get('serviceEvents.length'),1);
 assert.match(f.cards.get('changed').html,/The job was saved, but recent history could not load/);assert.match(f.cards.get('changed').html,/History &lt;offline>/);
 assert.equal(f.messages[0].error,true);assert.equal(f.calls.filter(call=>call.name).length,1);
});
test('each ordinary status action retains its versioned RPC contract and applies the server row',async()=>{
 for(const [action,from,to] of [['assign','new','assigned'],['reassign','scheduled','scheduled'],['schedule','assigned','scheduled'],['start','scheduled','on_site'],['submit_report','on_site','report_required'],['cancel','new','cancelled']]){
  const f=fixture(),before=row('changed',{status:from}),saved={...before,status:to,version:4,assigned_user_id:'engineer',scheduled_for:'2026-11-01',updated_at:'2026-10-29T08:00:00Z'};
  f.ctx.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:action==='schedule'?[saved]:saved}};
  f.ctx.eventResult.data[0].to_status=to;f.ctx.openServiceAction(before,action);await f.forms[0].submit({assignee:'engineer',scheduledFor:'2026-11-01',note:'Confirmed'});
  assert.equal(f.calls[0].name,'advance_service_case');assert.equal(f.calls[0].args.p_expected_version,3);assert.equal(f.calls[0].args.p_action,action);
  assert.equal(f.get('serviceCases[0].status'),to);assert.equal(f.get('serviceCases[0].scheduled_for'),'2026-11-01');assert.equal(f.calls.length,2);
 }
});
test('rejected and malformed status writes preserve the existing case and history',async()=>{
 for(const result of [{error:Error('Service case changed')},{data:{status:'assigned'}}]){
  const f=fixture(),before=f.cards.get('changed').html;f.ctx.client.rpc=async()=>result;
  f.ctx.openServiceAction(f.ctx.seed[0],'assign');await assert.rejects(f.forms[0].submit({assignee:'engineer',note:'Confirmed'}),/changed|could not be confirmed/);
  assert.equal(f.get('serviceCases[0].version'),3);assert.equal(f.cards.get('changed').html,before);assert.equal(f.get('serviceEvents.length'),1);assert.deepEqual(f.calls,[]);
 }
});
test('actor, section and cache changes reject late status responses and late history reads',async()=>{
 for(const stage of ['write','history'])for(const reset of ["me={user_id:'engineer'}","serviceSection='schedule'",'clearServiceWorkflow()']){
  const f=fixture(),pending=deferred(),before=f.cards.get('changed').html;
  if(stage==='write')f.ctx.client.rpc=()=>pending.promise;else f.ctx.eventResult=pending.promise;
  f.ctx.openServiceAction(f.ctx.seed[0],'assign');const save=f.forms[0].submit({assignee:'engineer',note:'Confirmed'});await new Promise(setImmediate);
  f.set(reset);pending.resolve(stage==='write'?{data:row('changed',{version:4,status:'assigned'})}:{data:[{id:'late',case_id:'changed'}]});await save;
  assert.equal(f.cards.get('changed').html,before);assert.deepEqual(f.messages,[]);assert.equal(f.decorations.length,0);
 }
});
test('a status patch waits for the initial handoff load and retains unrelated decorated cards',async()=>{
 const f=fixture(),initial=deferred();f.ctx.pendingHandoffs=initial.promise;f.set('serviceHandoffsLoading=pendingHandoffs');
 f.ctx.eventResult.data[0].to_status='cancelled';
 const record=row('changed',{status:'cancelled',version:4,updated_at:'2026-10-29T08:00:00Z'}),pending=f.ctx.updateServiceCase(record,()=>true);await new Promise(setImmediate);
 assert.equal(f.get('serviceCases[0].version'),3);assert.equal(f.decorations.length,0);
 initial.resolve();await pending;assert.equal(f.get('serviceCases[0].version'),4);assert.deepEqual(f.parent.children.map(card=>card.dataset.serviceCard),['other','changed']);assert.deepEqual(f.decorations,[['changed']]);
});

test('a confirmed status patch updates bounded-page metrics from the complete cache and invalidates page ordering',async()=>{
 const f=fixture();f.set("servicePageKey='cached';servicePageData={rows:[{...seed[0],display:{product_name:'Reviewed name'}}],metrics:{awaiting_engineer:100}};");
 await f.ctx.updateServiceCase({...f.ctx.seed[0],status:'assigned',assigned_user_id:'engineer',version:4,updated_at:'2026-10-29T08:00:00Z'},()=>true);
 assert.equal(f.get('servicePageKey'),'');assert.equal(f.get('servicePageData.rows[0].version'),4);assert.equal(f.get('servicePageData.rows[0].display.product_name'),'Reviewed name');assert.equal(f.get('servicePageData.metrics.awaiting_engineer'),1);assert.equal(f.get('servicePageData.metrics.awaiting_date'),2);
});
