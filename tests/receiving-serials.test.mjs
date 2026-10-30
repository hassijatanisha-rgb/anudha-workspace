import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function context(){
 const calls=[],ctx=vm.createContext({calls,esc:s=>String(s??'').replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`),inventoryProduct:id=>({name:id==='M'?'Analyzer <X>':'Reagent'}),salesProduct:id=>({name:id}),inventoryClassification:id=>({category:id==='M'?'machines':'reagents'}),
 inventoryLots:[{id:'L',product_id:'M',pack_definition_id:'P',sealed_cartons:1,loose_units:2}],inventoryPacks:[{id:'P',product_id:'M',units_per_carton:3}],client:{rpc:async(name,args)=>{calls.push({name,args});return {data:{id:'L'}};}}});
 for(const file of ['serial-numbers.js','receiving-serials.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),ctx);
 return ctx;
}
const args={p_lot_id:'L',p_expected_version:1,p_product_id:'M',p_pack_definition_id:'P',p_sealed_cartons:2,p_loose_units:2};
test('receiving captures one real serial for each added unit including sealed carton contents',async()=>{
 const ctx=context();assert.equal(ctx.receivingSerialCount(ctx.inventoryPacks[0],ctx.inventoryLots[0],2,2),3);
 await ctx.saveInventoryCountWithSerials(args,' NEW-1\nNEW-2;NEW-3 ');assert.equal(ctx.calls[0].name,'receive_serialized_inventory');assert.deepEqual([...ctx.calls[0].args.p_serials],['NEW-1','NEW-2','NEW-3']);assert.equal(ctx.calls[0].args.p_loose_units,2);
});
test('bad counts and duplicate serials stop before a stock RPC',async()=>{
 const ctx=context();await assert.rejects(ctx.saveInventoryCountWithSerials(args,'ONE'),/exactly 3/);await assert.rejects(ctx.saveInventoryCountWithSerials(args,'ONE\none\nTHREE'),/entered twice/);
 await assert.rejects(ctx.saveInventoryCountWithSerials({...args,p_sealed_cartons:0},''),/reviewed serial adjustment/);assert.equal(ctx.calls.length,0);
});
test('untracked stock keeps the existing count RPC and tracked packaging-only changes keep the total',async()=>{
 const ctx=context();await ctx.saveInventoryCountWithSerials({...args,p_product_id:'R'},'');assert.equal(ctx.calls[0].name,'set_inventory_opening_balance');
 await ctx.saveInventoryCountWithSerials({...args,p_sealed_cartons:0,p_loose_units:5},'');assert.equal(ctx.calls[1].name,'set_inventory_opening_balance');
});
test('legacy stock confirmation is explicit, unchecked, and sent only from the chosen checkbox',async()=>{
 const ctx=context();let fields,submit,payload;
 ctx.me={user_id:'owner'};ctx.document={activeElement:null};ctx.salesEditing='';ctx.salesLoadRequest=0;ctx.salesProformaPageKey='';ctx.salesDeliveryPageKey='';ctx.customerReturnContext=()=>({actor:ctx.me,current:()=>true});ctx.invalidateReturnStockCaches=()=>{};ctx.refreshSavedDeliverySerials=async()=>{};
 ctx.actionForm=(_title,html,fn)=>{fields=html;submit=fn};ctx.deliveryLines=()=>[{id:'DL',product_id:'M',quantity:1}];ctx.salesDeliveryWorkspace=async()=>{};ctx.message=()=>{};
 ctx.openRecordSerials({id:'DN',version:3,delivery_number:'DN-1'});assert.match(fields,/name="legacy_DL"/);assert.doesNotMatch(fields,/<input[^>]*\schecked(?:[\s=>])/);assert.match(fields,/audited and limited/);
 await submit({serials_DL:'LEGACY-1'});payload=ctx.calls.at(-1).args.p_lines[0];assert.equal(payload.legacyConfirmed,false);
 await submit({serials_DL:'LEGACY-1',legacy_DL:'on'});assert.equal(ctx.calls.at(-1).args.p_lines[0].legacyConfirmed,true);
});
test('receiving identity search escapes serial and product text and identifies legacy provenance',async()=>{
 const ctx=context();const query={select(){return this},ilike(){return this},order(){return this},limit:async()=>({data:[{product_id:'M',serial_number:'<SN>',source:'legacy_stock',recorded_at:'2026-10-20T08:00:00Z'}]})};ctx.client.from=()=>query;
 const html=await ctx.receivingSerialSearchHtml('SN');assert.match(html,/&#60;SN&#62;/);assert.match(html,/Analyzer &#60;X&#62;/);assert.match(html,/Verified legacy stock/);assert.match(html,/2026-10-20/);
});
test('transfer dispatch and arrival send exact independently scanned serial lists',async()=>{
 const ctx=context();ctx.inventoryTransfers=[{id:'T',product_id:'M',expected_units:3}];
 await ctx.saveInventoryTransferWithSerials('dispatch',{p_id:'T',p_expected_version:1,p_expected_lot_version:2,p_reason:'Verified cartons'},'A\nB\nC',true);
 assert.equal(ctx.calls[0].name,'dispatch_serialized_inventory_transfer');assert.deepEqual([...ctx.calls[0].args.p_serials],['A','B','C']);assert.equal(ctx.calls[0].args.p_legacy_confirmed,true);
 await ctx.saveInventoryTransferWithSerials('receive',{p_id:'T',p_expected_version:2,p_actual_units:1,p_inspection:'damaged',p_note:'Only one arrived'},'B',false);
 assert.equal(ctx.calls[1].name,'receive_serialized_inventory_transfer');assert.deepEqual([...ctx.calls[1].args.p_serials],['B']);assert.equal(ctx.calls[1].args.p_actual_units,1);assert.equal(ctx.calls[1].args.p_legacy_confirmed,false);
 await assert.rejects(ctx.saveInventoryTransferWithSerials('receive',{p_id:'T',p_actual_units:1},'A\nB',false),/exactly 1/);assert.equal(ctx.calls.length,2);
});
test('transfer forms require dispatch serials, explain arrived subset and leave legacy confirmation unchecked',()=>{
 const ctx=context(),transfer={cartons:2,expected_units:4};const dispatch=ctx.transferSerialFieldsHtml(transfer,'dispatch'),arrival=ctx.transferSerialFieldsHtml(transfer,'receive');
 assert.match(dispatch,/4 units/);assert.match(dispatch,/<textarea[^>]*required/);assert.match(dispatch,/available in the source lot/);
 assert.match(arrival,/only the units that actually arrived/);assert.match(arrival,/missing or quarantined units cannot be sold/);assert.doesNotMatch(arrival,/<input[^>]*\schecked(?:[\s=>])/);
});
test('untracked transfers retain the existing quantity RPCs without serial inputs',async()=>{
 const ctx=context();ctx.inventoryTransfers=[{id:'T',product_id:'R',expected_units:3}];
 const dispatch={p_id:'T',p_expected_version:1,p_expected_lot_version:2,p_reason:'Move cartons'};
 const receipt={p_id:'T',p_expected_version:2,p_actual_units:3,p_inspection:'pass',p_note:'Count checked'};
 await ctx.saveInventoryTransferWithSerials('dispatch',dispatch,'',false);
 await ctx.saveInventoryTransferWithSerials('receive',receipt,'',false);
 assert.equal(ctx.calls[0].name,'dispatch_inventory_transfer');assert.deepEqual(ctx.calls[0].args,dispatch);
 assert.equal(ctx.calls[1].name,'receive_inventory_transfer');assert.deepEqual(ctx.calls[1].args,receipt);
});
test('retained receiving forms bind once and refresh against current stock without losing entered serials',()=>{
 const ctx=context(),listeners=[],field={value:'KEEP-1\nKEEP-2'},label={},summary={},panel={querySelector:selector=>selector==='textarea'?field:label},form={dataset:{inventoryAction:'correct',lot:'L'},elements:{sealedCartons:{value:'2'},looseUnits:{value:'2'}},querySelector:()=>panel,closest:()=>({querySelector:()=>summary}),addEventListener:(type,fn)=>listeners.push({type,fn})};
 ctx.document={querySelectorAll:selector=>selector.startsWith('form[data-inventory-action="opening"]')?[form]:[]};ctx.bindReceivingSerialForms();ctx.bindReceivingSerialForms();assert.deepEqual(listeners.map(row=>row.type),['input','change']);assert.equal(panel.hidden,false);assert.equal(field.required,true);assert.match(label.textContent,/3 additional units/);assert.equal(field.value,'KEEP-1\nKEEP-2');
 ctx.inventoryLots=[{...ctx.inventoryLots[0],sealed_cartons:2}];ctx.bindReceivingSerialForms();assert.equal(listeners.length,2);assert.equal(field.required,false);assert.match(label.textContent,/0 additional units/);assert.equal(field.value,'KEEP-1\nKEEP-2');
 ctx.inventoryPacks=[{...ctx.inventoryPacks[0],product_id:'R'}];listeners[0].fn();assert.equal(panel.hidden,true);assert.equal(field.disabled,true);assert.equal(field.value,'KEEP-1\nKEEP-2');assert.equal(summary.textContent,'Correct this physical count');
});
