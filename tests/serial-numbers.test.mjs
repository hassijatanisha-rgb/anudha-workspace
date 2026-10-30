import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({esc:s=>String(s).replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`),salesProduct:id=>({name:id==='M'?'Analyzer <X>':'Reagent'})});
vm.runInContext(fs.readFileSync(new URL('../serial-numbers.js',import.meta.url),'utf8'),context);

test('typed or scanned serials split on lines, commas and semicolons, trimmed, blanks dropped',()=>{
 assert.deepEqual([...context.parseSerialList(' SN-1 \nSN-2,SN-3;\n\n SN-4 ')],['SN-1','SN-2','SN-3','SN-4']);
 assert.deepEqual([...context.parseSerialList('')],[]);
});

test('exactly one serial per unit, no duplicates ignoring case',()=>{
 assert.equal(context.serialListProblem(['A'],2),'Enter exactly 2 serial numbers; 1 entered.');
 assert.equal(context.serialListProblem(['A','a'],2),'a is entered twice.');
 assert.equal(context.serialListProblem(['A'.repeat(121)],1),'A serial number is too long.');
 assert.equal(context.serialListProblem(['A','B'],2),'');
});

test('the panel lists only serial-tracked lines, warns before dispatch, and is read-only after',()=>{
 vm.runInContext("serialSettings=new Map([['M',true],['R',false]])",context);
 const lines=[{id:'L1',product_id:'M',quantity:2},{id:'L2',product_id:'R',quantity:5}];
 const packing=context.deliverySerialPanelHtml({id:'N1',status:'packing'},lines,[{delivery_line_id:'L1',serial_number:'SN-1'}]);
 assert.match(packing,/Analyzer &#60;X&#62; × 2 · <code>SN-1<\/code>/);assert.doesNotMatch(packing,/Reagent/);
 assert.match(packing,/cannot go out until every unit/);assert.match(packing,/data-serial-record="N1">Enter serial numbers/);
 const complete=context.deliverySerialPanelHtml({id:'N1',status:'ready'},lines,[{delivery_line_id:'L1',serial_number:'SN-1'},{delivery_line_id:'L1',serial_number:'SN-2'}]);
 assert.doesNotMatch(complete,/cannot go out/);assert.match(complete,/Correct serial numbers/);
 const out=context.deliverySerialPanelHtml({id:'N1',status:'delivered'},lines,[{delivery_line_id:'L1',serial_number:'SN-1',returned_at:'2026-10-15'},{delivery_line_id:'L1',serial_number:'SN-2'}]);
 assert.match(out,/SN-1<\/code> <small>\(returned\)<\/small>/);assert.doesNotMatch(out,/data-serial-record/);
 assert.equal(context.deliverySerialPanelHtml({id:'N2',status:'packing'},[lines[1]],[]),'','nothing for untracked products');
});

test('only the stores head or the owner flags products',()=>{
 assert.equal(context.canFlagSerials({role:'owner'}),true);
 assert.equal(context.canFlagSerials({role:'head',department:'stores'}),true);
 assert.equal(context.canFlagSerials({role:'head',department:'sales'}),false);
 assert.equal(context.canFlagSerials({role:'staff',department:'stores'}),false);
});

test('classified machines require serials even when the optional setting is absent or false',()=>{
 context.inventoryClassification=id=>id==='M'?{category:'machines'}:{category:'reagents'};
 vm.runInContext("serialSettings=new Map([['M',false]])",context);
 assert.equal(context.serialRequired('M'),true);assert.equal(context.serialRequired('R'),false);
 const panel=context.deliverySerialPanelHtml({id:'N3',status:'packing'},[{id:'L3',product_id:'M',quantity:1}],[]);
 assert.match(panel,/Enter serial numbers/);assert.match(panel,/before marking Packed/);
 context.inventoryClassification=()=>({category:'reagents'});assert.equal(context.serialRequired('M'),false,'the latest classification controls machine requirements');
});

test('serial tools label machine requirements and only offer removal for optional products',async()=>{
 let html='';const content={querySelector:()=>null,querySelectorAll:()=>[],insertAdjacentHTML:(_position,value)=>{html=value;}};
 const ctx=vm.createContext({me:{user_id:'owner',role:'owner'},products:[{id:'M',name:'Analyzer'},{id:'R',name:'Reagent'}],esc:String,
  inventoryProductChoices:()=>'',inventoryClassification:id=>({category:id==='M'?'machines':'reagents'}),inventoryProduct:id=>({name:id==='M'?'Analyzer':'Reagent'}),
  $:selector=>selector==='#content'?content:selector==='#inventoryRefresh'?{}:selector==='#serialSearch'?{}:null,
  client:{from:()=>({select:async()=>({data:[{product_id:'M',serial_required:false},{product_id:'R',serial_required:true}]})})}});
 vm.runInContext(fs.readFileSync(new URL('../serial-numbers.js',import.meta.url),'utf8'),ctx);await ctx.decorateSerialTools();
 assert.match(html,/Analyzer <small>Required for machines<\/small>/);assert.doesNotMatch(html,/data-serial-unflag="M"/);assert.match(html,/data-serial-unflag="R"/);
});

test('a planned line and actual recorded serials survive category correction without flagging unrelated lines',()=>{
 context.inventoryClassification=()=>({category:'consumables'});vm.runInContext("serialSettings=new Map();plannedSerialLines=new Set(['PLAN'])",context);
 const lines=[{id:'PLAN',product_id:'M',quantity:1},{id:'OLD',product_id:'M',quantity:1},{id:'OTHER',product_id:'M',quantity:1}],serials=[{delivery_line_id:'OLD',serial_number:'KNOWN-1'}];
 assert.equal(context.deliveryLineSerialRequired(lines[0],serials),true);assert.equal(context.deliveryLineSerialRequired(lines[1],serials),true);assert.equal(context.deliveryLineSerialRequired(lines[2],serials),false);
 assert.match(context.deliverySerialPanelHtml({id:'N1',status:'packing'},lines,serials),/Enter serial numbers/);
 assert.equal(context.deliverySerialPanelHtml({id:'N2',status:'packing'},[lines[2]],[]),'');
 let fields;context.document={activeElement:null};context.customerReturnContext=()=>({current:()=>true});context.deliveryLines=()=>lines;context.actionForm=(_title,html)=>{fields=html};vm.runInContext("deliverySerials=[{delivery_line_id:'OLD',serial_number:'KNOWN-1'}]",context);
 context.openRecordSerials({id:'N1',delivery_number:'DN1',version:1});assert.match(fields,/name="serials_PLAN"/);assert.match(fields,/name="serials_OLD"/);assert.doesNotMatch(fields,/serials_OTHER/);
});

test('delivery decoration fetches bounded planned line identities for stores without reading service cases',async()=>{
 let html='',requested;const note={id:'N',status:'packing',delivery_number:'DN'},actions={insertAdjacentHTML:(_position,value)=>{html=value;}},card={dataset:{documentCard:'N'},querySelector:selector=>selector==='.actions'?actions:null};
 const ctx=vm.createContext({me:{user_id:'packer'},esc:String,CSS:{escape:String},salesDeliveryNotes:[note],salesProduct:()=>({name:'Corrected product'}),inventoryClassification:()=>({category:'consumables'}),deliveryLines:()=>[{id:'PLANNED',product_id:'M',quantity:1}],
  document:{querySelectorAll:selector=>selector==='[data-document-card]'?[card]:[],querySelector:()=>card},
  salesRowsFor:async(table,column,ids,order)=>{assert.equal(table,'delivery_line_serials');assert.equal(column,'delivery_note_id');assert.deepEqual([...ids],['N']);assert.equal(order,'serial_number');return {data:[]};},
  client:{rpc:async(name,args)=>{requested={name,args};return {data:[{delivery_line_id:'PLANNED'}]};},from:table=>{
   assert.ok(['product_serial_settings','delivery_line_serials'].includes(table));return {select:()=>table==='product_serial_settings'?Promise.resolve({data:[{product_id:'M',serial_required:false}]}):{in:()=>({order:async()=>({data:[]})})}};}}});
 vm.runInContext(fs.readFileSync(new URL('../serial-numbers.js',import.meta.url),'utf8'),ctx);await ctx.decorateDeliverySerials();
 assert.equal(requested.name,'planned_delivery_serial_lines');assert.deepEqual([...requested.args.p_delivery_note_ids],['N']);assert.match(html,/Enter serial numbers/);
});

test('return marking remains available for recorded units after category and setting correction',()=>{
 let html='';const panel={dataset:{returnsPanel:'N'},querySelector:()=>null,querySelectorAll:()=>[],insertAdjacentHTML:(_position,value)=>{html=value;}};
 context.document={querySelectorAll:()=>[panel]};context.CSS={escape:String};context.customerReturnLines=[{id:'RETURN',product_id:'M',delivery_line_id:'OLD',quantity:1}];
 vm.runInContext("serialSettings=new Map([['M',false]]);plannedSerialLines=new Set();deliverySerials=[{id:'SERIAL',delivery_line_id:'OLD',delivery_note_id:'N',serial_number:'KNOWN-1'}]",context);
 context.decorateReturnedSerials();assert.match(html,/data-serial-return="RETURN"/);assert.match(html,/1 to mark/);
});

test('serial decoration keeps later pages and a large planned JSON result, and rejects incomplete reads',async()=>{
 let html='',failure=false;const pages=[],orders=[],messages=[],rows=Array.from({length:1001},(_,i)=>({id:String(i),delivery_line_id:i===1000?'RECORDED':'OTHER'+i,delivery_note_id:'N',serial_number:'SN-'+i,inventory_serial_id:'RECEIPT'+i}));
 const actions={insertAdjacentHTML:(_position,value)=>{html=value;}},card={dataset:{documentCard:'N'},querySelector:selector=>selector==='.actions'?actions:null};
 const ctx=vm.createContext({me:{user_id:'packer'},salesEpoch:0,esc:String,CSS:{escape:String},message:text=>messages.push(text),salesDeliveryNotes:[{id:'N',status:'packing'}],salesProduct:()=>({name:'Corrected product'}),inventoryClassification:()=>({category:'consumables'}),deliveryLines:()=>[{id:'PLANNED',product_id:'M',quantity:1},{id:'RECORDED',product_id:'M',quantity:1}],document:{querySelectorAll:selector=>selector==='[data-document-card]'?[card]:[],querySelector:()=>card},
  client:{rpc:async()=>({data:Array.from({length:1001},(_,i)=>({delivery_line_id:i===1000?'PLANNED':'PLAN'+i}))}),from:table=>({select:()=>{
   if(table==='product_serial_settings')return Promise.resolve({data:[]});const query={in:()=>query,order:column=>{orders.push(column);return query;},range:async(start,end)=>{pages.push([start,end]);return failure&&start===1000?{error:{message:'Synthetic page failed'}}:{data:rows.slice(start,end+1)};}};return query;
  }})}});
 vm.runInContext(fs.readFileSync(new URL('../sales-delivery.js',import.meta.url),'utf8').match(/async function salesRowsFor\([\s\S]*?\n}\n/)[0],ctx);
 vm.runInContext(fs.readFileSync(new URL('../serial-numbers.js',import.meta.url),'utf8'),ctx);await ctx.decorateDeliverySerials();
 assert.deepEqual(pages,[[0,999],[1000,1999]]);assert.deepEqual(orders,['serial_number','id','serial_number','id']);assert.match(html,/SN-1000/);assert.match(html,/Not entered yet/);
 assert.equal(ctx.deliveryLineSerialRequired({id:'PLANNED',product_id:'M'}),true);failure=true;html='';await ctx.decorateDeliverySerials();
 assert.equal(html,'');assert.equal(ctx.deliveryLineSerialRequired({id:'PLANNED',product_id:'M'}),false);assert.equal(ctx.deliveryLineSerialRequired({id:'RECORDED',product_id:'M'}),false);assert.match(messages.at(-1),/Serial numbers could not load.*Synthetic page failed/);
});

for(const change of ['same-account-session','different-account','session-reset','newer-read'])test(`serial settings reject a late ${change} response before it can change transfer dispatch`,async()=>{
 const pending=[],writes=[];
 const ctx=vm.createContext({me:{user_id:'employee'},sessionLoadEpoch:1,inventoryTransfers:[{id:'T',product_id:'P',expected_units:1}],inventoryClassification:()=>({category:'consumables'}),
  client:{from:()=>({select:()=>new Promise(resolve=>pending.push(resolve))}),rpc:async(name,args)=>{writes.push({name,args});return {data:{}};}}});
 vm.runInContext(fs.readFileSync(new URL('../serial-numbers.js',import.meta.url),'utf8'),ctx);
 vm.runInContext(fs.readFileSync(new URL('../receiving-serials.js',import.meta.url),'utf8').match(/async function saveInventoryTransferWithSerials\([\s\S]*?\n}/)[0],ctx);
 const old=ctx.loadSerialSettings();
 if(change==='same-account-session')ctx.me={...ctx.me};
 if(change==='different-account')ctx.me={user_id:'other-employee'};
 if(change==='session-reset')ctx.sessionLoadEpoch++;
 if(change!=='newer-read'){
  pending[0]({data:[{product_id:'P',serial_required:false}]});assert.equal(await old,false);
 }
 const current=ctx.loadSerialSettings();pending[1]({data:[{product_id:'P',serial_required:true}]});assert.equal(await current,true);
 if(change==='newer-read'){pending[0]({data:[{product_id:'P',serial_required:false}]});assert.equal(await old,false);}
 assert.equal(ctx.serialRequired('P'),true);
 await ctx.saveInventoryTransferWithSerials('dispatch',{p_id:'T',p_expected_version:7},'REAL-1',false);
 assert.equal(writes[0].name,'dispatch_serialized_inventory_transfer');assert.deepEqual([...writes[0].args.p_serials],['REAL-1']);assert.equal(writes[0].args.p_expected_version,7);
});

for(const invalidate of ['same-ID actor replacement','newer decoration'])test(`late serial decoration cannot replace ${invalidate} state`,async()=>{
 let release,serialReads=0;
 const note={id:'N',status:'packing'},card={dataset:{documentCard:'N'},querySelector:()=>null};
 const ctx=vm.createContext({me:{user_id:'packer'},salesDeliveryNotes:[note],deliveryLines:()=>[],document:{querySelectorAll:selector=>selector==='[data-document-card]'?[card]:[],querySelector:()=>card},salesRowsFor:async()=>{serialReads++;return {data:[]}},client:{from:()=>({select:async()=>({data:[]})}),rpc:()=>new Promise(resolve=>{release=resolve})}});
 vm.runInContext(fs.readFileSync(new URL('../serial-numbers.js',import.meta.url),'utf8'),ctx);
 const old=ctx.decorateDeliverySerials();await new Promise(setImmediate);
 if(invalidate==='same-ID actor replacement')ctx.me={user_id:'packer'};
 else{ctx.client.rpc=async()=>({data:[]});await ctx.decorateDeliverySerials();}
 vm.runInContext("plannedSerialLines=new Set(['current-line']);deliverySerials=[{id:'current-serial'}]",ctx);
 const before=serialReads;release({data:[{delivery_line_id:'old-line'}]});await old;
 assert.equal(serialReads,before);assert.deepEqual(Array.from(vm.runInContext('plannedSerialLines',ctx)),['current-line']);assert.equal(vm.runInContext('deliverySerials[0].id',ctx),'current-serial');
});
