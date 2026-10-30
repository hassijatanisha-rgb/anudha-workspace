import {workspacePageHeader} from './helpers/page-header.mjs';
import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
const source=readFileSync(new URL('../tally-invoices.js',import.meta.url),'utf8');
const waitFor=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const invoice=(n=1,extra={})=>({id:'invoice-'+n,tally_guid:null,voucher_type:'Sales',voucher_number:'INV-'+n,voucher_date:'2026-10-29',party_name:'Fixture Clinic',order_reference:'',currency:'TZS',net_minor:'100000',vat_minor:'18000',total_minor:'118000',lines:[{item:'Reagent <A>',quantity:2,unit:'PCS',amount_minor:'100000'}],narration:'',cancelled:false,proforma_id:null,match_status:'unmatched',match_note:'',source:'upload',content_hash:'1234567890',imported_by:'actor',imported_at:'2026-10-29T08:00:00.123456Z',version:3,...extra});
function fixture({rows=[invoice(1),invoice(2),invoice(3)],filter='all',page=0,search=''}={}){
 const document=dom();document.body.innerHTML='<main id="content"></main>';const content=document.querySelector('#content'),descriptor=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(content),'innerHTML');let writes=0;
 Object.defineProperty(content,'innerHTML',{get:()=>descriptor.get.call(content),set:html=>{writes++;descriptor.set.call(content,html);}});
 const calls=[],reads=[],forms=[],messages=[],scrolls=[],actor={user_id:'actor',role:'owner'};
 const c=vm.createContext({workspacePageHeader,statusTone,document,me:actor,sessionLoadEpoch:1,view:'tallyinvoices',CSS:{escape:String},window:{scrollX:5,scrollY:400,scrollTo:(...args)=>scrolls.push(args)},$:selector=>document.querySelector(selector),run:fn=>fn(),message:(...args)=>messages.push(args),companyDate:()=> '2026-10-29',syncWorkspaceNavigation(){},workspaceLoading:()=>assert.fail('Ordinary saves must not replace the workspace'),
  esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),organizations:[{id:'clinic',name:'Fixture Clinic'}],salesOrganization:()=>({name:'Fixture Clinic'}),
  actionForm:(title,html,submit)=>{forms.push({title,html,submit});return forms.at(-1);},renderSearchPreservingPosition:(_,fn)=>fn(),
  all:async()=>assert.fail('Ordinary saves must not load complete arrays'),
  client:{rpc:async(name,args)=>{calls.push({name,args:structuredClone(args)});return c.response(name,args);},from:table=>{const eq=[];const query={select:columns=>{query.columns=columns;return query;},eq:(key,value)=>{eq.push([key,value]);return query;},maybeSingle:async()=>{reads.push({table,columns:query.columns,eq});return c.readResponse(Object.fromEntries(eq));}};return query;}}
 });
 vm.runInContext(readFileSync(new URL('../sales-domain.js',import.meta.url),'utf8'),c);vm.runInContext(source,c);const get=code=>vm.runInContext(code,c);c.seed=rows;
 c.response=(name,args)=>name==='review_tally_invoice'?{data:{...rows.find(row=>row.id===args.p_id),version:4,proforma_id:args.p_action==='match'?args.p_proforma_id:null,match_status:{match:'matched',unmatch:'unmatched',ignore:'ignored'}[args.p_action],match_note:args.p_note}}:{data:{rows:1,new:1,changed:0,unchanged:0,matched:1}};
 c.readResponse=lookup=>({data:lookup.id?{...rows.find(row=>row.id===lookup.id),version:4,match_status:'ignored'}:invoice(99,{...lookup,version:1,proforma_id:'pf',match_status:'matched'})});
 get(`tallyInvoices=seed;tallyInvoiceLoaded=true;tallyInvoiceActor=me;tallyInvoiceCanManage=true;tallyInvoiceProformas=[{id:'pf',document_number:'PF-1',organization_id:'clinic',status:'accepted',total_minor:'118000',tax_minor:'18000',currency:'TZS'}];tallyInvoiceFilter=${JSON.stringify(filter)};tallyInvoiceSearch=${JSON.stringify(search)};tallyInvoicePage=${page};renderTallyInvoices();`);
 return {c,get,document,content,calls,reads,forms,messages,scrolls,writes:()=>writes,node:selector=>document.querySelector(selector),row:id=>document.querySelector(`[data-tally-invoice-row="${id}"]`),open:(id='invoice-1',action='ignore')=>{c.openTallyInvoiceAction(get(`tallyInvoices.find(row=>row.id===${JSON.stringify(id)})`),action);return forms.at(-1);},test:()=>{c.openTallyTestInvoice();return forms.at(-1);}};
}

test('confirmed review patches only its row and exact counts, retaining shell, controls, peer rows, disclosures and focus',async()=>{
 const f=fixture(),shell=f.node('.tally-invoices-workspace'),header=f.node('.workspace-page-header'),search=f.node('#tallyInvoiceSearch'),tabs=f.node('.tabs'),pager=f.node('#tallyInvoicePager'),prev=f.node('#tallyInvoicePrev'),peer=f.row('invoice-2'),changed=f.row('invoice-1');
 changed.querySelector('details').open=true;peer.querySelector('details').open=true;const focus=peer.querySelector('button');focus.focus();search.value='Unsubmitted search text';
 await f.open().submit({note:'Cash order'});
 assert.ok(header);assert.equal(f.writes(),1);assert.equal(f.node('.tally-invoices-workspace'),shell);assert.equal(f.node('.workspace-page-header'),header);assert.equal(f.node('#tallyInvoiceSearch'),search);assert.equal(search.value,'Unsubmitted search text');assert.equal(f.node('.tabs'),tabs);assert.equal(f.node('#tallyInvoicePager'),pager);assert.equal(f.node('#tallyInvoicePrev'),prev);assert.equal(f.row('invoice-2'),peer);assert.equal(f.document.activeElement,focus);assert.equal(peer.querySelector('details').open,true);assert.equal(f.row('invoice-1').querySelector('details').open,true);assert.notEqual(f.row('invoice-1'),changed);
 assert.match(f.node('#tallyInvoiceCounts').textContent,/2 need linking · 0 linked · 1 not ERP orders/);assert.equal(f.calls.length,1);assert.equal(f.reads.length,0);assert.deepEqual(f.calls[0],{name:'review_tally_invoice',args:{p_id:'invoice-1',p_expected_version:3,p_action:'ignore',p_proforma_id:null,p_note:'Cash order'}});assert.deepEqual(f.scrolls.at(-1),[5,400]);assert.equal(f.get('tallyInvoices.length'),3);assert.equal(f.get('tallyInvoices.find(row=>row.id==="invoice-1").total_minor'),'118000');
});

for(const action of ['match','unmatch','ignore'])test(`${action} consumes the full versioned receipt and exact original arguments`,async()=>{
 const rows=[invoice(1,action==='unmatch'?{proforma_id:'pf',match_status:'matched'}:{})],f=fixture({rows});await f.open('invoice-1',action).submit({proforma:'PF-1 · Fixture Clinic',note:'Reviewed manually'});
 assert.equal(f.calls[0].args.p_action,action);assert.equal(f.calls[0].args.p_proforma_id,action==='match'?'pf':null);assert.equal(f.calls[0].args.p_expected_version,3);assert.equal(f.reads.length,0);assert.equal(f.get('tallyInvoices[0].version'),4);assert.equal(f.get('tallyInvoices[0].match_status'),{match:'matched',unmatch:'unmatched',ignore:'ignored'}[action]);assert.equal(f.writes(),1);
});

test('last-page removal clamps exact membership without replacing search, filter or pager controls',async()=>{
 const f=fixture({rows:Array.from({length:51},(_,i)=>invoice(i+1)),filter:'unmatched',page:1}),search=f.node('#tallyInvoiceSearch'),pager=f.node('#tallyInvoicePager'),next=f.node('#tallyInvoiceNext');
 assert.equal(f.node('#tallyInvoiceRows').querySelectorAll('tr').length,1);await f.open().submit({note:'Not from an ERP order'});
 assert.equal(f.get('tallyInvoicePage'),0);assert.equal(f.node('#tallyInvoiceRows').querySelectorAll('tr').length,50);assert.equal(f.get('tallyInvoices.length'),51);assert.equal(f.row('invoice-1'),null);assert.equal(f.node('#tallyInvoiceSearch'),search);assert.equal(f.node('#tallyInvoicePager'),pager);assert.equal(f.node('#tallyInvoiceNext'),next);assert.equal(pager.hidden,true);assert.equal(next.disabled,true);assert.equal(f.writes(),1);
});

test('search membership is recomputed from complete arrays after a link',async()=>{
 const f=fixture({search:'PF-1'}),search=f.node('#tallyInvoiceSearch');assert.equal(f.node('#tallyInvoiceTable').hidden,true);
 await f.open('invoice-1','match').submit({proforma:'PF-1',note:''});assert.equal(f.row('invoice-1')!==null,true);assert.equal(f.node('#tallyInvoiceTable').hidden,false);assert.equal(f.node('#tallyInvoiceSearch'),search);assert.equal(f.get('tallyInvoices.length'),3);
});

for(const kind of ['missing','partial','wrong-id','old-version'])test(`${kind} receipt uses one ID-scoped read`,async()=>{
 const f=fixture();f.c.response=()=>({data:kind==='missing'?null:kind==='partial'?{id:'invoice-1',version:4}:kind==='wrong-id'?invoice(99,{version:4}):invoice(1)});await f.open().submit({note:'Reviewed'});
 assert.deepEqual(f.reads[0].eq,[['id','invoice-1']]);assert.equal(f.reads[0].table,'tally_sales_invoices');assert.match(f.row('invoice-1').textContent,/Not from a Pro forma/);assert.equal(f.calls.length,1);assert.equal(f.reads.length,1);assert.equal(f.writes(),1);
});

test('failed confirmed review locks only that record, preserves disclosure, and retries reads without a second write',async()=>{
 const f=fixture(),old=f.row('invoice-1');old.querySelector('details').open=true;f.c.response=()=>({data:null});f.c.readResponse=()=>({error:Error('Offline <script>')});const form=f.open();await form.submit({note:'Reviewed'});
 assert.equal(f.row('invoice-1'),old);assert.equal(old.querySelector('details').open,true);assert.equal(old.querySelector('button').disabled,true);assert.equal(f.row('invoice-2').querySelector('button').disabled,false);assert.match(f.node('#tallyInvoiceSaveStatus').textContent,/saved.*Offline <script>/);assert.equal(f.node('#tallyInvoiceSaveStatus').querySelector('script'),null);assert.match(f.node('#tallyInvoiceCounts').textContent,/awaiting verification/);
 await assert.rejects(form.submit({note:'Reviewed'}),/Invoice saved/);const forms=f.forms.length;f.c.openTallyInvoiceAction(f.get('tallyInvoices[0]'),'match');assert.equal(f.forms.length,forms);
 f.c.readResponse=()=>({data:invoice(1,{version:4,match_status:'ignored'})});await f.node('[data-tally-invoice-retry]').onclick();assert.equal(f.calls.length,1);assert.equal(f.reads.length,2);assert.equal(f.get('tallyInvoiceRecoveries.size'),0);assert.equal(f.row('invoice-1').querySelector('button').disabled,false);assert.equal(f.row('invoice-1').querySelector('details').open,true);assert.equal(f.writes(),1);
});

test('failed review remains blocked and retryable after changing filters',async()=>{
 const f=fixture();f.c.response=()=>({data:null});f.c.readResponse=()=>({error:Error('Offline')});await f.open().submit({note:'Reviewed'});f.node('[data-tally-invoice-filter="unmatched"]').onclick();
 assert.equal(f.row('invoice-1').querySelector('button').disabled,true);f.c.readResponse=()=>({data:invoice(1,{version:4,match_status:'ignored'})});await f.node('[data-tally-invoice-retry]').onclick();assert.equal(f.row('invoice-1'),null);assert.equal(f.calls.length,1);assert.equal(f.reads.length,2);
});

test('TEST creation preserves exact payload and performs only the unique-tuple scoped read after commit',async()=>{
 const f=fixture(),header=f.node('.workspace-page-header'),peer=f.row('invoice-2');await f.test().submit({proforma:'pf'});
 assert.deepEqual(f.calls[0],{name:'import_tally_invoices',args:{p_rows:[{voucher_number:'TEST-PF-1',voucher_date:'2026-10-29',voucher_type:'TEST Sales',party_name:'Fixture Clinic',order_reference:'PF-1',currency:'TZS',net_minor:100000,vat_minor:18000,total_minor:118000,lines:[],narration:'TEST INVOICE - NOT A REAL TAX INVOICE'}],p_source:'upload'}});
 assert.deepEqual(f.reads[0].eq,[['voucher_type','TEST Sales'],['voucher_number','TEST-PF-1'],['voucher_date','2026-10-29']]);assert.equal(f.reads.length,1);assert.equal(f.node('.workspace-page-header'),header);assert.equal(f.row('invoice-2'),peer);assert.equal(f.get('tallyInvoices.length'),4);assert.equal(f.writes(),1);assert.match(f.content.textContent,/TEST-PF-1/);
});

test('TEST follow-up failure blocks repeat creation across filter changes; Retry never imports again',async()=>{
 const f=fixture(),form=f.test();f.c.readResponse=()=>({error:Error('Read unavailable')});await form.submit({proforma:'pf'});assert.equal(f.node('#tallyTestInvoice').disabled,true);await assert.rejects(form.submit({proforma:'pf'}),/Invoice saved/);assert.equal(f.calls.length,1);
 f.node('[data-tally-invoice-filter="unmatched"]').onclick();assert.equal(f.node('#tallyTestInvoice').disabled,true);f.c.readResponse=lookup=>({data:invoice(99,{...lookup,version:1,match_status:'matched',proforma_id:'pf'})});await f.node('[data-tally-invoice-retry]').onclick();assert.equal(f.calls.length,1);assert.equal(f.reads.length,2);assert.equal(f.get('tallyInvoices.length'),4);assert.equal(f.row('invoice-99'),null);assert.equal(f.node('#tallyTestInvoice').disabled,false);
});

test('TEST tuple read refuses a mismatching invoice and never guesses a row from import counts',async()=>{
 const f=fixture();f.c.readResponse=()=>({data:invoice(99)});await f.test().submit({proforma:'pf'});assert.equal(f.get('tallyInvoices.length'),3);assert.equal(f.get('tallyInvoiceRecoveries.size'),1);assert.match(f.node('#tallyInvoiceSaveStatus').textContent,/saved.*could not be verified/);assert.equal(f.calls.length,1);
});

test('local reconciliation failure retries the confirmed receipt without another request',async()=>{
 const f=fixture(),create=f.document.createElement;let fail=true;f.document.createElement=tag=>{if(tag==='template'&&fail){fail=false;throw Error('Local render failed');}return create(tag);};await f.open().submit({note:'Reviewed'});
 assert.equal(f.get('tallyInvoiceRecoveries.size'),1);await f.node('[data-tally-invoice-retry]').onclick();assert.match(f.row('invoice-1').textContent,/Not from a Pro forma/);assert.equal(f.calls.length,1);assert.equal(f.reads.length,0);assert.equal(f.get('tallyInvoiceRecoveries.size'),0);
});

for(const change of ['actor','session','epoch','request','route','root'])for(const reject of [false,true])test(`${change} change suppresses a late ${reject?'write rejection':'receipt'}`,async()=>{
 const f=fixture(),wait=waitFor(),old=f.row('invoice-1');f.c.response=()=>wait.promise;const pending=f.open().submit({note:'Reviewed'});
 if(change==='root')f.c.renderTallyInvoices();else f.get({actor:'me={...me}',session:'sessionLoadEpoch++',epoch:'tallyInvoiceEpoch++',request:'tallyInvoiceRequest++',route:"view='staff'"}[change]);const before=f.content.innerHTML;
 if(reject)wait.reject(Error('Late private failure'));else wait.resolve({data:invoice(1,{version:4,match_status:'ignored'})});await pending;assert.equal(f.content.innerHTML,before);assert.equal(f.get('tallyInvoices[0].version'),3);assert.equal(f.messages.length,0);assert.equal(f.reads.length,0);
});

for(const change of ['actor','session','epoch','route','root'])test(`${change} change suppresses a pending scoped read and the old retry`,async()=>{
 const f=fixture(),wait=waitFor();f.c.response=()=>({data:null});f.c.readResponse=()=>({error:Error('Offline')});await f.open().submit({note:'Reviewed'});const retry=f.node('[data-tally-invoice-retry]');f.c.readResponse=()=>wait.promise;const pending=retry.onclick();
 if(change==='root')f.c.renderTallyInvoices();else f.get({actor:'me={...me}',session:'sessionLoadEpoch++',epoch:'tallyInvoiceEpoch++',route:"view='staff'"}[change]);const before=f.content.innerHTML;wait.resolve({data:invoice(1,{version:4,match_status:'ignored'})});await pending;assert.equal(f.content.innerHTML,before);assert.equal(f.get('tallyInvoices[0].version'),3);const count=f.reads.length;await retry.onclick();assert.equal(f.reads.length,count);
});

test('changing filters while a recovery is pending permits a new scoped Retry without stale completion overwriting it',async()=>{
 const f=fixture(),wait=waitFor();f.c.response=()=>({data:null});f.c.readResponse=()=>wait.promise;const pending=f.open().submit({note:'Reviewed'});await new Promise(resolve=>setImmediate(resolve));f.node('[data-tally-invoice-filter="unmatched"]').onclick();
 const retry=f.node('[data-tally-invoice-retry]');assert.ok(retry);f.c.readResponse=()=>({data:invoice(1,{version:4,match_status:'ignored'})});await retry.onclick();wait.resolve({error:Error('Old failure')});await pending;assert.equal(f.get('tallyInvoiceRecoveries.size'),0);assert.equal(f.row('invoice-1'),null);assert.equal(f.calls.length,1);assert.equal(f.reads.length,2);
});

test('newer cached invoice versions are retained when an older confirmed receipt completes',async()=>{
 const f=fixture(),wait=waitFor();f.c.response=()=>wait.promise;const pending=f.open().submit({note:'Reviewed'});f.get("tallyInvoices[0]={...tallyInvoices[0],version:5,party_name:'Later confirmed name'}");wait.resolve({data:invoice(1,{version:4,match_status:'ignored'})});await pending;assert.equal(f.get('tallyInvoices.find(row=>row.id==="invoice-1").version'),5);assert.match(f.row('invoice-1').textContent,/Later confirmed name/);
});

test('actor replacement clears private complete caches and recovery state before loading',async()=>{
 const f=fixture();f.c.response=()=>({data:null});f.c.readResponse=()=>({error:Error('Offline')});await f.open().submit({note:'Reviewed'});f.get('me={...me}');f.c.workspaceLoading=()=>{};f.c.all=async()=>[];f.c.response=()=>({data:false});await f.c.tallyInvoicesWorkspace();assert.equal(f.get('tallyInvoices.length'),0);assert.equal(f.get('tallyInvoiceRecoveries.size'),0);assert.equal(f.get('tallyInvoiceCanManage'),false);assert.equal(f.get('tallyInvoiceSearch'),'');
});

for(const change of ['actor','session'])test(`${change} change blocks an old review/test form and recovery before any write or read`,async()=>{
 const f=fixture(),review=f.open(),create=f.test();f.c.response=()=>({data:null});f.c.readResponse=()=>({error:Error('Offline')});await review.submit({note:'Reviewed'});const retry=f.node('[data-tally-invoice-retry]'),calls=f.calls.length,reads=f.reads.length;
 f.get(change==='actor'?'me={...me}':'sessionLoadEpoch++');await retry.onclick();await assert.rejects(create.submit({proforma:'pf'}),/Reopen Tally/);assert.equal(f.calls.length,calls);assert.equal(f.reads.length,reads);
 if(change==='actor'){const count=f.forms.length;f.c.openTallyInvoiceAction(f.get('tallyInvoices[0]'),'match');f.c.openTallyTestInvoice();assert.equal(f.forms.length,count);}
});

for(const change of ['actor','session','clear'])test(`${change} change discards a late complete-array load`,async()=>{
 const f=fixture(),wait=waitFor();f.c.all=()=>wait.promise;f.c.response=()=>({data:true});const pending=f.c.loadTallyInvoices();f.get(change==='actor'?'me={...me}':change==='session'?'sessionLoadEpoch++':'clearTallyInvoices()');const before=f.get('tallyInvoices');wait.resolve([invoice(99)]);assert.equal(await pending,false);assert.equal(f.get('tallyInvoices'),before);
});

test('a confirmed TEST commit after navigation is remembered and cannot be imported again on return',async()=>{
 const f=fixture(),wait=waitFor();f.c.response=()=>wait.promise;const pending=f.test().submit({proforma:'pf'});f.c.renderTallyInvoices();wait.resolve({data:{rows:1,new:1,changed:0,unchanged:0,matched:1}});await pending;
 assert.equal(f.get('tallyInvoiceLoaded'),false);assert.equal(f.get('tallyInvoiceRecoveries.size'),1);const forms=f.forms.length;f.c.openTallyTestInvoice();assert.equal(f.forms.length,forms);f.c.renderTallyInvoices();assert.equal(f.node('#tallyTestInvoice').disabled,true);await f.node('[data-tally-invoice-retry]').onclick();assert.equal(f.calls.length,1);assert.equal(f.reads.length,1);
});
