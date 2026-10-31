import {installLeaveContext} from './helpers/leave-context.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const tick=()=>new Promise(setImmediate);
const proforma=(id='pf',status='draft')=>({id,status,version:1,revision:1,document_number:'PF-'+id,organization_id:'org',contact_id:'contact',currency:'TZS',total_minor:100,subtotal_minor:100,discount_minor:0,tax_minor:0,prepared_by:'actor',valid_until:'2026-11-10',notes:'',payment_terms:'Cash',delivery_period:'Agreed',commercial_kind:'sale',installation_required:false});
const delivery=(id='dn',status='packing')=>({id,status,version:1,delivery_number:'DN-'+id,proforma_id:'pf',organization_id:'org',contact_id:'contact',customer_waiting:false,expected_delivery_date:'2026-10-30',accounts_reference:'Confirmed',tax_invoice_reference:'INV-1'});
function fixture({kind='delivery',status=kind==='delivery'?'packing':'draft',historyFailure=false}={}){
 const cards=new Map(),calls=[],historyReads=[],messages=[],handoffs=[],body={isConnected:true},document={body,activeElement:body};let dialog=null,submit,historyResponse=null;
 const window={scrollX:12,scrollY:340,addEventListener(){},scrollTo({left,top}){this.scrollX=left;this.scrollY=top;}};
 const basic=(parent=null)=>({parent,dataset:{},disabled:false,textContent:'',get isConnected(){return this.parent?.isConnected||false;},setAttribute(key,value){this[key]=value;},addEventListener(name,fn){this[name]=fn;},focus(options){assert.deepEqual({...options},{preventScroll:true});document.activeElement=this;}});
 const dataOf=text=>Object.fromEntries([...text.matchAll(/data-([\w-]+)(?:="([^"]*)")?/g)].map(([,key,value])=>[key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),value||'']));
 const matches=(node,selector)=>{const key=selector.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);return key?Object.hasOwn(node.dataset,key[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase()))&&(key[2]===undefined||Object.values(node.dataset).includes(key[2])):false;};
 const parse=html=>{
  const id=html.match(/data-document-card="([^"]+)"/)?.[1];assert.ok(id,'actual card renderer supplies ID');
  const card={dataset:{documentCard:id},html,parent:null,connected:false,alerts:[],buttons:[],details:[],get isConnected(){return this.connected;},contains(node){while(node){if(node===this)return true;node=node.parent;}return false;},append(node){node.parent=this;this.alerts.push(node);},replaceWith(next){this.connected=false;next.connected=true;cards.set(id,next);if(!document.activeElement.isConnected)document.activeElement=body;}};
  const addButtons=text=>{for(const match of text.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)){const button=basic(card);button.dataset=dataOf(match[1]);button.disabled=/\bdisabled\b/.test(match[1]);button.textContent=match[2].replace(/<[^>]+>/g,'');card.buttons.push(button);}};addButtons(html);
  for(const [,attrs,title] of html.matchAll(/<details\b([^>]*)>\s*<summary>([\s\S]*?)<\/summary>/g)){const detail=basic(card),summary=basic(detail);summary.textContent=title.replace(/<[^>]+>/g,'');detail.dataset=dataOf(attrs);detail.open=/\bopen\b/.test(attrs);detail.querySelector=selector=>selector==='summary'?summary:null;card.details.push(detail);}
  const actions={querySelector:()=>null,append:button=>{button.parent=card;card.buttons.push(button);},insertAdjacentHTML(position,text){assert.equal(position,'beforebegin');card.serialPanel={html:text};addButtons(text);}};
  card.querySelectorAll=selector=>selector==='details[open]'?card.details.filter(detail=>detail.open):selector==='details'?card.details:selector==='button,summary'?[...card.buttons,...card.details.map(detail=>detail.querySelector('summary'))]:card.buttons.filter(button=>matches(button,selector));
  card.querySelector=selector=>selector==='.actions'?actions:selector==='.actions button:not(:disabled)'?card.buttons.find(button=>!button.disabled):selector==='[data-serial-panel]'?card.serialPanel||null:card.querySelectorAll(selector)[0]||null;
  return card;
 };
 document.querySelector=selector=>selector==='dialog[open]'?dialog:selector.match(/^\[data-document-card="(.+)"\]$/)?cards.get(selector.match(/"(.+)"/)[1])||null:null;
 document.querySelectorAll=selector=>selector==='[data-document-card]'?[...cards.values()]:[];
 document.createElement=tag=>{if(tag!=='template')return basic();const template={content:{}};Object.defineProperty(template,'innerHTML',{set:html=>template.content.firstElementChild=parse(html)});return template;};
 const previous=kind==='delivery'?delivery('dn',status):proforma('pf',status),other=kind==='delivery'?delivery('other','ready'):proforma('other','sent');
 const ctx=vm.createContext({statusTone,document,window,CSS:{escape:String},Date,me:{user_id:'actor',role:'owner'},view:'sales',esc:value=>String(value??'').replaceAll('<','&lt;'),$:document.querySelector,
  orgIndex:new Map([['org',{id:'org',name:'Fictional clinic',location:'Dar'}]]),contacts:[{id:'contact',first_name:'Named',last_name:'Contact'}],products:[],inventoryLots:[],inventoryLoaded:true,employeeName:()=> 'Asha',deliveryCanFinishPacking:()=>true,
  actionForm:(label,fields,fn)=>{submit=fn;},message:(text,error)=>messages.push({text,error}),run:fn=>fn(),confirm:()=>true,
  clearServiceWorkflow(){},decorateWorkHandoffs:async root=>handoffs.push(root),decorateDeliverySerials:async()=>{throw Error('Unrelated serial reload');},loadInventoryOperations:async()=>{throw Error('Unexpected inventory reload');},
  client:{rpc:async(name,args)=>{calls.push({name,args});return {data:{...previous,version:2,status:kind==='delivery'?'ready':'sent'}};},from(table){
   assert.equal(table,'sales_delivery_events');const request={table},query={select(){return this;},in(column,ids){request.column=column;request.ids=[...ids];return this;},order(){return this;},range(start,end){request.range=[start,end];return this;},then(yes,no){historyReads.push(request);return (historyResponse||Promise.resolve(historyFailure?{error:{message:'Offline'}}:{data:[{id:'confirmed-event',delivery_note_id:'dn',to_status:'ready',created_at:'2026-10-29T10:00:00Z',actor_user_id:'actor'}]})).then(yes,no);}};return query;
  }},liveStatusCache:new Map([['pf',{at:1}]])
 });
 for(const file of ['row-index.js','business-date.js','sales-domain.js','company-forms.js','proforma-commercial.js','sales-delivery.js','serial-numbers.js'])vm.runInContext(read(file),ctx);
 installLeaveContext(ctx);ctx.askConfirm=async()=>true;const get=code=>vm.runInContext(code,ctx);ctx.seed=kind==='delivery'?[proforma('pf','accepted')]:[previous,other];ctx.notes=kind==='delivery'?[previous,other]:[];
 get("salesProformas=seed;salesDeliveryNotes=notes;salesLoaded=true;salesProformaPageKey='cached-page';salesDeliveryEvents=[{id:'old',delivery_note_id:'dn',to_status:'packing',created_at:'2026-10-29T09:00:00Z'},{id:'unrelated',delivery_note_id:'other',to_status:'ready',created_at:'2026-10-29T09:00:00Z'}];salesDeliveryHistoryLoaded.add('dn');salesDeliveryHistoryLoaded.add('other');salesDeliveryWorkspace=async()=>{throw Error('Unexpected workspace reload')};");
 const render=row=>kind==='delivery'?ctx.deliveryCard(row):ctx.proformaCard(row);
 for(const record of [previous,other]){const card=parse(render(record));card.connected=true;cards.set(record.id,card);ctx.bindSalesRecordCard(card);}
 const original=cards.get(previous.id),kept=cards.get(other.id);original.details[0].open=true;kept.details[0].open=true;
 return {ctx,get,previous,cards,original,kept,calls,historyReads,messages,handoffs,document,window,setHistory(value){historyResponse=value;},setDialog(value){dialog=value;},async action(action){const trigger=original.querySelector('[data-'+(kind==='delivery'?'delivery':'proforma')+'-action]');if(kind==='delivery')ctx.openDeliveryAction(previous,action,trigger);else ctx.openProformaAction(previous,action,trigger);return submit({reference:'Customer confirmation'});},submit:values=>submit(values)};
}

test('customer collection confirmation leaves the record untouched on Cancel',async()=>{
 const f=fixture({status:'sent_to_sales'}),question=deferred();f.ctx.askConfirm=()=>question.promise;
 const pending=f.original.querySelector('[data-delivery-collection]').onclick();assert.equal(f.calls.length,0);question.resolve(false);await pending;
 assert.equal(f.calls.length,0);assert.equal(f.get('salesDeliveryNotes[0].customer_waiting'),false);assert.equal(f.cards.get('dn'),f.original);
});

test('customer collection answers cannot write after actor, route, hash, version, workspace or card changes',async()=>{
 for(const change of [f=>{f.ctx.me={...f.ctx.me};},f=>{f.ctx.view='personal';},f=>{f.ctx.location.hash='#/go/staff';},f=>{f.previous.version++;},f=>f.get('salesWorkspaceRequest++'),f=>{f.original.connected=false;}]){
  const f=fixture({status:'sent_to_sales'}),question=deferred();f.ctx.askConfirm=()=>question.promise;
  const pending=f.original.querySelector('[data-delivery-collection]').onclick();change(f);question.resolve(true);await pending;assert.equal(f.calls.length,0);
 }
});
for(const [action,from,to] of [['send','draft','sent'],['accept','sent','accepted'],['revise','sent','draft'],['reject','sent','rejected'],['cancel','draft','cancelled']])test(`confirmed Pro forma ${action} updates one card and current cached row without full-register reads`,async()=>{
 const f=fixture({kind:'proforma',status:from}),oldArray=f.get('salesProformas');f.ctx.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:{...f.previous,status:to,version:2}};};
 await f.action(action);assert.equal(f.get("salesProforma('pf').status"),to);assert.notEqual(f.get('salesProformas'),oldArray);assert.equal(f.get("rowsWhere(salesProformas,'status','"+to+"')[0].version"),2);
 assert.equal(f.cards.get('other'),f.kept);assert.equal(f.kept.details[0].open,true);assert.equal(f.cards.get('pf').details[0].open,true);assert.equal(f.historyReads.length,0);assert.equal(f.calls.length,1);assert.equal(f.get('salesProformaPageKey'),'');assert.equal(f.ctx.liveStatusCache.has('pf'),false);assert.equal(f.handoffs[0],f.cards.get('pf'));
});
for(const [action,from,to,rpc] of [['ready','packing','ready','packing_mark_packed'],['send_to_sales','tax_invoice_created','sent_to_sales','advance_sales_delivery'],['deliver','out_for_delivery','delivered','advance_sales_delivery']])test(`${action} reads only affected history and preserves unrelated cards and scroll`,async()=>{
 const f=fixture({status:from});f.ctx.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:{...f.previous,status:to,version:2}};};await f.action(action);
 assert.equal(f.calls[0].name,rpc);assert.equal(f.historyReads.length,1);assert.deepEqual(f.historyReads[0].ids,['dn']);assert.equal(f.get("salesDeliveryNotes.find(row=>row.id==='dn').status"),to);assert.equal(f.get("salesDeliveryEvents.find(row=>row.delivery_note_id==='dn').id"),'confirmed-event');assert.equal(f.get("salesDeliveryEvents.find(row=>row.delivery_note_id==='other').id"),'unrelated');assert.equal(f.cards.get('other'),f.kept);assert.equal(f.window.scrollY,340);assert.equal(f.window.scrollX,12);
});
test('customer-waiting toggle binds the confirmed version without duplicating global handlers',async()=>{
 const f=fixture({status:'sent_to_sales'});f.ctx.client.rpc=async(name,args)=>{f.calls.push({name,args});return {data:{...f.previous,customer_waiting:args.p_customer_waiting,version:args.p_expected_version+1}};};
 f.original.querySelector('[data-delivery-collection]').onclick();await tick();assert.equal(f.calls[0].args.p_expected_version,1);assert.equal(f.get('salesDeliveryNotes[0].customer_waiting'),true);
 f.cards.get('dn').querySelector('[data-delivery-collection]').onclick();await tick();assert.equal(f.calls[1].args.p_expected_version,2);assert.equal(f.get('salesDeliveryNotes[0].version'),3);assert.equal(f.get('salesDeliveryNotes[0].customer_waiting'),false);assert.equal(f.cards.get('other'),f.kept);
});
test('focus returns to the next record action after its dialog closes, without moving unrelated focus',async()=>{
 const f=fixture(),dialog={isConnected:true,addEventListener(type,fn){assert.equal(type,'close');this.closed=fn;}};f.setDialog(dialog);f.document.activeElement=dialog;await f.action('ready');assert.equal(f.document.activeElement,dialog);
 f.setDialog(null);f.document.activeElement=f.document.body;dialog.closed();assert.equal(f.document.activeElement,f.cards.get('dn').querySelector('.actions button:not(:disabled)'));
 const g=fixture();g.document.activeElement=g.kept.buttons[0];await g.action('ready');assert.equal(g.document.activeElement,g.kept.buttons[0]);
});
test('confirmed delivery with failed history keeps truthful new status and an inline saved/read-failed alert',async()=>{
 const f=fixture({historyFailure:true});await f.action('ready');assert.equal(f.get('salesDeliveryNotes[0].status'),'ready');assert.equal(f.get("salesDeliveryHistoryLoaded.has('dn')"),false);assert.equal(f.get("salesDeliveryEvents.some(row=>row.delivery_note_id==='dn')"),false);
 assert.match(f.cards.get('dn').alerts[0].textContent,/Change saved.*history.*Offline.*Refresh/);assert.equal(f.messages.at(-1).error,true);assert.equal(f.cards.get('other'),f.kept);
});
test('failed writes and unconfirmed response rows retain prior records and perform no history reads',async()=>{
 const variants=[{error:{message:'Version changed'}},{data:null},{data:{id:'dn',status:'ready',version:2}},...['id','status','version'].map(key=>({key}))];
 for(const variant of variants){const f=fixture();f.ctx.client.rpc=async()=>variant.key?{data:{...f.previous,status:'ready',version:2,[variant.key]:variant.key==='version'?1:'wrong'}}:variant;await assert.rejects(f.action('ready'));assert.equal(f.cards.get('dn'),f.original);assert.equal(f.get('salesDeliveryNotes[0].version'),1);assert.equal(f.historyReads.length,0);assert.equal(f.messages.length,0);}
});
test('same-user replacement, session clear, navigation and newer workspace loads discard pending writes',async()=>{
 for(const kind of ['proforma','delivery'])for(const change of [f=>f.ctx.me={user_id:'actor',role:'owner'},f=>f.ctx.clearSalesDelivery(),f=>f.ctx.view='personal',f=>f.get('salesWorkspaceRequest++')]){
  const f=fixture({kind}),wait=deferred(),status=kind==='proforma'?'sent':'ready';f.ctx.client.rpc=()=>wait.promise;const pending=f.action(kind==='proforma'?'send':'ready');change(f);wait.resolve({data:{...f.previous,status,version:2}});await pending;assert.equal(f.cards.get(f.previous.id),f.original);assert.equal(f.historyReads.length,0);assert.equal(f.messages.length,0);
 }
});
test('customer collection cannot write after leaving the active Sales record workspace',async()=>{
 const f=fixture({status:'sent_to_sales'});f.ctx.view='personal';await assert.rejects(f.ctx.saveDeliveryCollection(f.previous,true,f.original.buttons[0]),/Reopen this delivery/);assert.equal(f.calls.length,0);
});
test('navigation during scoped history cannot patch cards or populate its replacement session',async()=>{
 const f=fixture(),wait=deferred();f.setHistory(wait.promise);const pending=f.action('ready');await tick();f.ctx.me={user_id:'actor',role:'owner'};wait.resolve({data:[{id:'late',delivery_note_id:'dn'}]});await pending;assert.equal(f.cards.get('dn'),f.original);assert.equal(f.get('salesDeliveryNotes[0].version'),1);assert.equal(f.messages.length,0);
});
test('serial panel for unchanged allocations gains current-step controls without a serial reload',async()=>{
 const f=fixture({status:'tax_invoice_created'});f.original.serialPanel={};f.get("salesDeliveryLines=[{id:'line',delivery_note_id:'dn',product_id:'machine',quantity:1}];serialSettings.set('machine',true);deliverySerials=[{id:'serial',delivery_note_id:'dn',delivery_line_id:'line',serial_number:'S-1',inventory_serial_id:'received'}];");f.ctx.client.rpc=async()=>({data:{...f.previous,status:'sent_to_sales',version:2}});await f.action('send_to_sales');assert.match(f.cards.get('dn').serialPanel.html,/Correct serial numbers/);assert.equal(f.historyReads.length,1);
});
test('a pending initial serial lookup finishes before the changed card gets current-step controls',async()=>{
 const f=fixture({status:'tax_invoice_created'}),serials=deferred();f.ctx.pendingSerials=serials.promise;f.get('salesSerialsLoading=pendingSerials');f.ctx.client.rpc=async()=>({data:{...f.previous,status:'sent_to_sales',version:2}});
 const saved=f.action('send_to_sales');await tick();assert.equal(f.cards.get('dn'),f.original);
 f.original.serialPanel={};f.get("salesDeliveryLines=[{id:'line',delivery_note_id:'dn',product_id:'machine',quantity:1}];serialSettings.set('machine',true);deliverySerials=[{id:'serial',delivery_note_id:'dn',delivery_line_id:'line',serial_number:'S-1',inventory_serial_id:'received'}]");serials.resolve();await saved;
 assert.match(f.cards.get('dn').serialPanel.html,/Correct serial numbers/);assert.equal(f.cards.get('other'),f.kept);assert.equal(f.historyReads.length,1);
});
test('status-only Pro forma changes retain its immutable revision identities and totals',async()=>{
 const f=fixture({kind:'proforma'});f.get("salesRevisionSnapshots.set('pf:1',{organizationName:'Saved clinic',organizationLocation:'Arusha',contactName:'Saved contact',currency:'TZS',validUntil:'2026-11-10',deliveryPeriod:'Agreed',paymentTerms:'Cash',subtotalMinor:100,discountMinor:0,taxMinor:0,totalMinor:100,lines:[]})");
 f.ctx.orgIndex.set('org',{name:'Renamed current clinic',location:'Mwanza'});await f.action('send');const html=f.cards.get('pf').html;
 assert.match(html,/Saved clinic/);assert.match(html,/Saved contact/);assert.doesNotMatch(html,/Renamed current clinic|Saved revision unavailable/);assert.equal(f.get("salesRevisionSnapshots.get('pf:1').totalMinor"),100);
});
function stockRefreshFixture(action,from,to){
 const f=fixture({status:from}),reads=[];
 f.get("salesDeliveryLines=[{id:'old-line',delivery_note_id:'dn',quantity:1,product_id:'product',lot_id:'old-lot'}];deliverySerials=[{id:'kept-serial',delivery_note_id:'other'}];plannedSerialLines=new Set(['old-line','other-line']);inventoryLots=[{id:'old-lot',reserved_units:1},{id:'untouched-lot',reserved_units:2}]");
 const refreshed={sales_delivery_lines:[{id:'new-line',delivery_note_id:'dn',quantity:1,product_id:'product',lot_id:'new-lot'}],sales_delivery_events:[{id:'new-event',delivery_note_id:'dn',to_status:to}],delivery_line_serials:[{id:'new-serial',delivery_note_id:'dn',delivery_line_id:'new-line'}],inventory_lots:[{id:'old-lot',reserved_units:0},{id:'new-lot',reserved_units:1}]};
 f.ctx.loadSerialSettings=async()=>true;
 f.ctx.client.from=table=>{const request={table},query={select(){return this},in(column,ids){request.column=column;request.ids=[...ids];return this},order(){return this},range(){return this},then(resolve,reject){reads.push(request);return Promise.resolve(f.failedTable===table?{error:{message:'Read offline'}}:{data:refreshed[table]}).then(resolve,reject)}};return query};
 f.ctx.client.rpc=async(name,args)=>{f.calls.push({name,args});return name==='planned_delivery_serial_lines'?{data:[{delivery_line_id:'new-line'}]}:{data:{...f.previous,version:2,status:to}}};
 return Object.assign(f,{reads,refreshed,actionName:action});
}
for(const [action,from,to,rpc] of [['tax_invoice','accounts_approved','tax_invoice_created','create_tax_invoice_and_reserve_stock'],['start_packing','sent_to_sales','packing','start_reserved_sales_delivery_packing'],['dispatch','ready','out_for_delivery','advance_sales_delivery'],['cancel','packing','cancelled','advance_sales_delivery']])test(`${action} reconciles affected allocations, stock, serials and history without replacing the workspace`,async()=>{
 const f=stockRefreshFixture(action,from,to),untouched=f.ctx.inventoryLots[1];await f.action(action);
 assert.equal(f.calls[0].name,rpc);assert.equal(f.calls[0].args.p_expected_version,1);assert.equal(f.calls.length,2);assert.equal(f.calls[1].name,'planned_delivery_serial_lines');assert.deepEqual([...f.calls[1].args.p_delivery_note_ids],['dn']);
 assert.deepEqual(f.reads.map(r=>r.table),['sales_delivery_lines','sales_delivery_events','delivery_line_serials','inventory_lots']);for(const r of f.reads.slice(0,3))assert.deepEqual(r.ids,['dn']);assert.deepEqual(f.reads[3].ids,['old-lot','new-lot']);
 assert.equal(f.cards.get('other'),f.kept);assert.equal(f.window.scrollY,340);assert.equal(f.get('salesDeliveryNotes[0].status'),to);assert.equal(f.get('salesDeliveryLines[0].id'),'new-line');assert.equal(f.get("plannedSerialLines.has('old-line')"),false);assert.equal(f.get("plannedSerialLines.has('new-line')"),true);assert.equal(f.get("plannedSerialLines.has('other-line')"),true);assert.equal(f.get('deliverySerials[0].id'),'kept-serial');assert.equal(f.ctx.inventoryLots.find(lot=>lot.id==='untouched-lot'),untouched);assert.equal(f.ctx.inventoryLots.find(lot=>lot.id==='old-lot').reserved_units,0);assert.equal(f.ctx.inventoryLoaded,false);
});
test('confirmed stock change with a failed dependent read offers a read-only retry and no stale actions or print',async()=>{
 const f=stockRefreshFixture('tax_invoice','accounts_approved','tax_invoice_created');f.failedTable='inventory_lots';await f.action('tax_invoice');
 const failed=f.cards.get('dn');assert.match(failed.html,/Change saved.*Read offline/);assert.match(failed.html,/Refresh delivery details/);assert.doesNotMatch(failed.html,/data-delivery-action|data-print-document|Haadi lot/);assert.equal(f.get('salesDeliveryNotes[0].version'),2);assert.equal(f.cards.get('other'),f.kept);assert.equal(f.messages.at(-1).error,true);
 f.failedTable='';await failed.querySelector('[data-delivery-retry]').onclick();assert.equal(f.calls.filter(c=>c.name==='create_tax_invoice_and_reserve_stock').length,1);assert.equal(f.get('salesDeliveryRefreshErrors.size'),0);assert.match(f.cards.get('dn').html,/data-print-document/);assert.equal(f.get('salesDeliveryLines[0].id'),'new-line');
});
test('a missing allocated lot fails closed instead of treating it as zero stock',async()=>{
 const f=stockRefreshFixture('start_packing','sent_to_sales','packing');f.refreshed.inventory_lots=[];await f.action('start_packing');assert.match(f.cards.get('dn').html,/Change saved.*allocated stock could not be verified/);assert.doesNotMatch(f.cards.get('dn').html,/data-delivery-action/);
});
test('route and same-ID actor changes during scoped stock refresh leave replacement caches and DOM alone',async()=>{
 for(const change of [f=>{f.ctx.me={user_id:'actor',role:'owner'}},f=>{f.ctx.view='service'},f=>f.get('salesWorkspaceRequest++')]){
  const f=stockRefreshFixture('cancel','packing','cancelled'),wait=deferred();f.ctx.loadSerialSettings=()=>wait.promise;const saving=f.action('cancel');await tick();change(f);wait.resolve(true);await saving;assert.equal(f.cards.get('dn'),f.original);assert.equal(f.get('salesDeliveryNotes[0].version'),1);assert.equal(f.get('salesDeliveryLines[0].id'),'old-line');assert.equal(f.messages.length,0);
 }
});
