import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls,dispatchFocusout} from './helpers/native-form-controls.mjs';
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8'),plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const initialLines=()=>[{accountId:'bank',debit:'50.25',credit:'',description:'Bank line'},{accountId:'expense',debit:'',credit:'50.25',description:'Expense line'}];
const saved=args=>({id:args.p_id,entry_number:'JE-FICTIONAL',entry_date:args.p_date,memo:args.p_memo.replace(/^ +| +$/g,''),source_type:'manual',source_id:null,reverses_entry_id:null,currency:'TZS',created_by:'actor'});
async function fixture({lines=initialLines()}={}){
 const document=dom();installNativeFormControls(document);const proto=Object.getPrototypeOf(document.body),matches=proto.matches;
 proto.matches=function(selector){return selector.split(',').some(part=>matches.call(this,part.trim()));};proto.prepend=function(node){this.insertBefore(node,this.children[0]||null)};proto.getBoundingClientRect=()=>({left:20,top:20,bottom:64,width:240,height:44});proto.getClientRects=function(){return this.isConnected?[{}]:[]};
 Object.defineProperties(proto,{type:{configurable:true,get(){return this.attrs.type||''},set(value){this.attrs.type=value}},form:{get(){return this.closest('form')}},date:{get(){return this.elements.date}},memo:{get(){return this.elements.memo}},style:{get(){return this._style??={}}},classList:{get(){return {contains:name=>this.className.split(' ').includes(name),add:name=>{if(!this.className.split(' ').includes(name))this.className=(this.className+' '+name).trim()},remove:name=>{this.className=this.className.split(' ').filter(part=>part!==name).join(' ')}}}}});
 document.addEventListener=()=>{};document.getElementById=id=>document.querySelector('#'+id);document.documentElement={style:{},dataset:{},clientWidth:1280,clientHeight:900};document.body.innerHTML='<div id="notice"></div><main id="content"><button id="booksTransactionBack">Back</button><input id="unrelated" value="keep"><section id="booksBody"></section></main>';
 const actor={user_id:'actor'},calls=[];let ids=0,running;
 const c=vm.createContext({document,window:{addEventListener(){}},busy:false,me:actor,view:'books',$:selector=>document.querySelector(selector),esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),getComputedStyle:()=>({visibility:'visible'}),setTimeout:()=>1,clearTimeout(){},crypto:{randomUUID:()=>`request-${++ids}`},organizations:[]});
 for(const name of ['client-rules.js','sales-domain.js','accounting-ledger.js','action-feedback.js'])vm.runInContext(source(name),c);
 const app=source('app.js');vm.runInContext(app.split('\n').find(line=>line.startsWith('function message('))+'\n'+app.slice(app.indexOf('function friendlyError('),app.indexOf('let editSaving=false;')),c);const actualRun=c.run;c.run=(...args)=>running=actualRun(...args);
 const get=code=>vm.runInContext(code,c),node=selector=>document.querySelector(selector);c.data={today:'2026-10-30',accounts:[{id:'bank',code:'1200',name:'Bank',account_type:'asset',active:true},{id:'expense',code:'6000',name:'Expense',account_type:'expense',active:true}]};c.draft={journal:{date:'2026-10-30',memo:' Office rent ',lines}};get("booksData=data;booksDraft=draft;booksSection='journal';booksTransactionSelected='new';booksEpoch=10");
 const f={c,get,node,document,actor,calls,ids:()=>ids,write:async args=>({data:saved(args)}),blur:dispatchFocusout};c.client={rpc:async(name,args)=>{calls.push({name,args:plain(args)});return f.write(args)}};c.booksSelect=async(table,columns,build)=>{const read={table};build({eq(key,value){read[key]=value;return this;},limit(value){read.limit=value;return this;}});calls.push(read);return [saved(calls.find(call=>call.name==='post_manual_journal').args)];};c.booksWorkspace=async()=>calls.push({open:get('booksTransactionSelected')});
 const current=()=>c.me===actor&&c.view==='books'&&get("booksEpoch===10&&booksSection==='journal'");await c.booksJournal('actor',current);
 f.form=()=>node('#booksJournalForm');f.field=name=>f.form().elements[name];f.line=(i,key)=>f.form().querySelector(`[data-jl="${key}"][data-i="${i}"]`);f.post=()=>f.form().querySelector('[type="submit"]');f.summary=()=>node('#booksJournalErrors');f.error=control=>control.closest('label').querySelector('.field-error')?.textContent||'';
 f.change=control=>{for(let node=control;node;node=node.parentElement)for(const {fn}of node.events.change||[])fn({target:control,currentTarget:node});};f.submit=()=>{running=null;f.form().onsubmit({preventDefault(){}});return running;};f.writes=()=>calls.filter(call=>call.name==='post_manual_journal');f.pending=()=>running;
 f.replace=kind=>{if(kind==='actor')c.me={...actor};else if(kind==='view')c.view='personal';else if(kind==='section')get("booksSection='receipts'");else if(kind==='epoch')get('booksEpoch++');else if(kind==='data')get('booksData={}');else f.form().remove();};return f;
}

test('journal has a separate summary and real labels for repeated controls',async()=>{
 const f=await fixture();assert.equal(f.form().noValidate,true);assert.equal(f.form().firstElementChild,f.summary());assert.equal(f.summary().getAttribute('role'),'alert');
 for(const name of ['date','memo'])assert.match(f.field(name).closest('label').textContent,/required/);for(const input of f.form().querySelectorAll('[data-jl]'))assert.ok(input.closest('label').querySelector('span'));assert.match(f.line(0,'description').closest('label').textContent,/optional/);
});

test('blur only shows the departed field error and retains help and external focus',async()=>{
 const f=await fixture(),input=f.line(0,'debit');input.setAttribute('aria-describedby','amount-help');input.value='12.345';f.field('memo').value='';f.node('#unrelated').focus();f.blur(input);
 assert.match(f.error(input),/two decimal places/);assert.equal(f.error(f.field('memo')),'');assert.equal(f.summary().textContent,'1 field needs attention');assert.equal(f.document.activeElement,f.node('#unrelated'));assert.match(input.getAttribute('aria-describedby'),/^amount-help field-error-/);
 input.value='50.25';f.blur(input);assert.equal(f.error(input),'');assert.equal(input.getAttribute('aria-describedby'),'amount-help');assert.equal(f.summary().textContent,'');assert.equal(f.writes().length,0);
});

test('submit counts native and line errors before focusing the first invalid control in DOM order',async()=>{
 const f=await fixture();f.field('date').value='';f.field('memo').value='x';f.line(0,'debit').value='1.001';f.line(0,'description').value='x'.repeat(301);f.line(1,'accountId').value='';const focus=f.field('date').focus;f.field('date').focus=function(...args){assert.equal(f.summary().textContent,'5 fields need attention');return focus.apply(this,args)};
 await f.submit();assert.equal(f.document.activeElement,f.field('date'));assert.deepEqual(plain(f.field('date').scrolledIntoView),{block:'center',behavior:'instant'});assert.equal(f.writes().length,0);assert.equal(f.ids(),1);
});

test('each amount uses the unchanged money parser for malformed and unsafe values',async()=>{
 const f=await fixture();for(const value of ['-1','1,000','1e2','0.001','90071992547410']){f.line(0,'debit').value=value;f.blur(f.line(0,'debit'));assert.ok(f.error(f.line(0,'debit')),value);await f.submit();assert.equal(f.writes().length,0);}
 f.line(0,'debit').value=' 50.25 ';f.blur(f.line(0,'debit'));assert.equal(f.error(f.line(0,'debit')),'');
});

test('the mutually exclusive debit/credit rule is visible on either departed amount and clears together on submit',async()=>{
 const f=await fixture();f.line(0,'credit').value='10';f.blur(f.line(0,'debit'));assert.match(f.error(f.line(0,'debit')),/either a debit or a credit/);assert.equal(f.error(f.line(0,'credit')),'');await f.submit();assert.equal(f.summary().textContent,'2 fields need attention');assert.match(f.error(f.line(0,'credit')),/either a debit or a credit/);assert.equal(f.writes().length,0);
 f.line(0,'credit').value='';f.change(f.line(0,'credit'));assert.equal(f.summary().textContent,'2 fields need attention');await f.submit();assert.equal(f.summary().textContent,'');assert.equal(f.writes().length,1);
});

test('minimum-line and imbalance errors have editable targets while empty rows stay optional',async()=>{
 const f=await fixture({lines:[{accountId:'bank',debit:'50'},{}]});await f.submit();assert.match(f.error(f.line(1,'accountId')),/at least two lines/);assert.equal(f.document.activeElement,f.line(1,'accountId'));assert.equal(f.writes().length,0);
 const g=await fixture();g.line(1,'credit').value='40';await g.submit();assert.match(g.error(g.line(1,'credit')),/differ by/);assert.equal(g.document.activeElement,g.line(1,'credit'));assert.equal(g.writes().length,0);
 const h=await fixture({lines:[...initialLines(),{description:'Unused note'}]});await h.submit();assert.equal(h.writes()[0].args.p_lines.length,2);
});

test('native custom errors take priority and header/note maximum lengths stay local',async()=>{
 const f=await fixture();f.line(0,'debit').value='bad';f.line(0,'debit').setCustomValidity('Amount needs review');f.field('memo').value='x'.repeat(501);f.line(1,'description').value='x'.repeat(301);await f.submit();assert.match(f.error(f.line(0,'debit')),/Amount needs review/);assert.match(f.error(f.field('memo')),/500/);assert.match(f.error(f.line(1,'description')),/300/);assert.equal(f.writes().length,0);
});

test('busy refusal precedes validation and retains the existing form and request',async()=>{
 const f=await fixture();f.c.busy=true;f.field('memo').value='';await f.submit();assert.equal(f.form().querySelectorAll('.field-error').length,0);assert.match(f.summary().textContent,/Another action/);assert.equal(f.post().disabled,false);assert.equal(f.writes().length,0);assert.equal(f.ids(),1);
});

test('actual runtime preserves pending locks, exact posting arguments and the confirmed saved-record focus',async()=>{
 const f=await fixture(),wait=deferred(),form=f.form(),draft=f.get('booksDraft'),label=f.post().textContent;f.write=()=>wait.promise;f.post().focus();const posting=f.submit();assert.equal(form.inert,true);assert.equal(f.post().disabled,true);assert.equal(f.post().textContent,label);assert.equal(f.post().getAttribute('aria-busy'),'true');await f.submit();f.node('#booksAddLine').onclick();assert.equal(f.writes().length,1);
 assert.deepEqual(f.writes()[0].args,{p_id:'request-1',p_date:'2026-10-30',p_memo:' Office rent ',p_lines:[{account_id:'bank',debit_minor:5025,credit_minor:0,description:'Bank line'},{account_id:'expense',debit_minor:0,credit_minor:5025,description:'Expense line'}]});wait.resolve({data:saved(f.writes()[0].args)});await posting;
 assert.equal(f.form(),form);assert.equal(f.get('booksDraft'),draft);assert.equal(form.inert,true);assert.equal(f.document.activeElement,f.node('[data-books-posted-open]'));assert.equal(f.post().getAttribute('aria-busy'),null);await f.submit();assert.equal(f.writes().length,1);
});

test('failed writes retain their request and form values; malformed success only retries saved details',async()=>{
 const f=await fixture();f.write=async()=>({error:{message:'Posting rejected'}});await f.submit();assert.equal(f.form().inert,false);assert.equal(f.post().disabled,false);assert.match(f.summary().textContent,/Posting rejected/);f.write=async()=>({data:{id:'wrong'}});await f.submit();assert.equal(f.writes()[0].args.p_id,f.writes()[1].args.p_id);assert.equal(f.form().inert,true);assert.ok(f.node('[data-books-posted-retry]'));await f.submit();assert.equal(f.writes().length,2);
 f.node('[data-books-posted-retry]').onclick();await f.pending();assert.ok(f.node('[data-books-posted-open]'));assert.equal(f.writes().length,2);assert.equal(f.calls.filter(call=>call.table==='acc_journal_entries').length,1);
});

test('Add line preserves the existing draft rebuild and request lifecycle without stale error nodes',async()=>{
 const f=await fixture();f.line(0,'debit').value='bad';f.blur(f.line(0,'debit'));const old=f.form();f.node('#booksAddLine').onclick();assert.equal(old.isConnected,false);assert.equal(f.line(0,'debit').value,'bad');assert.equal(f.get('booksDraft.journal.lines.length'),3);assert.equal(f.form().querySelectorAll('.field-error').length,0);assert.equal(f.summary().textContent,'');assert.equal(f.ids(),2);assert.equal(f.writes().length,0);
});

for(const change of ['actor','view','section','epoch','data','detach'])test(`${change} replacement suppresses stale blur, submit and late posting results`,async()=>{
 const f=await fixture(),form=f.form(),memo=f.field('memo'),summary=f.summary();f.replace(change);memo.value='';f.blur(memo);form.onsubmit({preventDefault(){}});assert.equal(summary.textContent,'');assert.equal(f.writes().length,0);
 const g=await fixture(),wait=deferred(),old=g.form();g.write=()=>wait.promise;const posting=g.submit();g.replace(change);wait.resolve({data:saved(g.writes()[0].args)});await posting;assert.equal(old.inert,true);assert.equal(g.node('[data-books-posted]'),null);
});

function dispatchCorrectionChange(control){
 const event=new Event('change',{bubbles:true});Object.defineProperty(event,'target',{value:control});
 for(let node=control;node;node=node.parentElement){Object.defineProperty(event,'currentTarget',{configurable:true,value:node});node.onchange?.call(node,event);for(const {fn}of [...(node.events.change||[])])fn.call(node,event);}
}

test('journal correction followed by action blur preserves layout through change and focusout',async()=>{
 const f=await fixture(),input=f.field('memo');input.value='';f.blur(input);assert.equal(f.summary().textContent,'1 field needs attention');const errorNode=input.closest('label').querySelector('.field-error');input.value=' Office rent ';const html=f.form().innerHTML;
 dispatchCorrectionChange(input);assert.equal(f.form().innerHTML,html,'text change must not mutate errors before focusout');f.post().focus();f.blur(input,f.post());assert.equal(f.form().innerHTML,html);assert.equal(input.closest('label').querySelector('.field-error'),errorNode);assert.equal(f.document.activeElement,f.post());assert.equal(f.writes().length,0);
 await f.submit();assert.equal(f.writes().length,1);assert.equal(f.writes()[0].args.p_memo,' Office rent ');assert.equal(f.error(input),'');
});
test('journal selector change still eagerly refreshes touched fields',async()=>{
 const f=await fixture(),input=f.line(0,'accountId');input.value='';f.blur(input);assert.ok(f.error(input));input.value='bank';dispatchCorrectionChange(input);assert.equal(f.error(input),'');assert.equal(f.summary().textContent,'');assert.equal(f.writes().length,0);
});
test('journal action blur still requires valid fields on submit',async()=>{
 const f=await fixture(),input=f.field('memo');input.value='';f.blur(input,f.post());assert.equal(f.summary().textContent,'');await f.submit();assert.equal(f.writes().length,0);assert.equal(f.document.activeElement,input);assert.ok(f.error(input));
});
