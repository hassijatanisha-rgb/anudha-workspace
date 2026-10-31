import {workspacePageHeader} from './helpers/page-header.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const c=vm.createContext({workspacePageHeader,});vm.runInContext(readFileSync(new URL('../inventory-domain.js',import.meta.url),'utf8'),c);
const today='2026-10-27',hub={id:'hub',active:true,is_dispatch_hub:true};
const lot=(values={})=>({id:'lot',location_id:'hub',product_id:'product',pack_definition_id:'pack',stock_status:'available',sealed_cartons:2,loose_units:1500,reserved_units:200,expiry_date:null,...values});
test('on-hand, reserved and free quantities remain separate from invoice eligibility',()=>{
 const result=c.inventoryStockTotals([lot(),lot({stock_status:'quarantine',sealed_cartons:10,loose_units:500,reserved_units:0}),lot({location_id:'warehouse',sealed_cartons:1,loose_units:100,reserved_units:0}),lot({expiry_date:'2026-10-26',sealed_cartons:3,loose_units:80,reserved_units:20})],[hub,{id:'warehouse',active:true,is_dispatch_hub:false}],today);
 assert.deepEqual(JSON.parse(JSON.stringify(result)),{cartons:16,loose:2180,reserved:220,freeLoose:1960,invoiceableLoose:1300});
});
for(const [label,change,place] of [
 ['expired',{expiry_date:'2026-10-26'},hub],['quarantined',{stock_status:'quarantine'},hub],['non-dispatch',{}, {...hub,is_dispatch_hub:false}],['inactive',{}, {...hub,active:false}],['missing location',{},undefined],['zero',{sealed_cartons:0,loose_units:0,reserved_units:0},hub],['fully reserved',{sealed_cartons:0,loose_units:200},hub],['sealed only',{loose_units:0,reserved_units:0},hub]
])test(`${label} stock is not invoiceable`,()=>{
 const result=c.inventoryLotAvailability(lot(change),place,today);assert.equal(result.invoiceableLoose,0);assert.doesNotMatch(result.reason,/\b(Eligible|available)\b/i);
});
test('expiry today remains eligible and sealed cartons are never counted as loose units',()=>{
 const result=c.inventoryLotAvailability(lot({expiry_date:today}),hub,today);assert.equal(result.invoiceableLoose,1300);assert.equal(result.canOpenCartons,true);
});
test('invalid reservations and unsafe totals cannot become plausible counts',()=>{
 for(const change of [{reserved_units:1501},{reserved_units:-1},{loose_units:1.1},{sealed_cartons:NaN}])assert.throws(()=>c.inventoryStockTotals([lot(change)],[hub],today),/reservation/i);
 assert.throws(()=>c.inventoryStockTotals([lot({loose_units:Number.MAX_SAFE_INTEGER,reserved_units:0}),lot()],[hub],today),/supported range/);
});
function ui(){
 const calls=[],links=[],content={isConnected:true};
 const ctx=vm.createContext({workspacePageHeader,$:selector=>selector==='#content'?content:null,document:{addEventListener(){},querySelectorAll:()=>[]},esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),companyDate:()=>today,me:{user_id:'actor',role:'staff',access:['stock','deliveries']},organizations:[],run:fn=>fn(),salesDeliveryWorkspace:async()=>{calls.push('open delivery');}});
 for(const file of ['staff-access.js','status-ui.js','inventory-domain.js','inventory-operations.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),ctx);
 vm.runInContext("inventoryActor=me;inventoryProduct=()=>({name:'Reagent'});inventoryLocations=[{id:'hub',name:'Haadi',code:'HAA',active:true,is_dispatch_hub:true}];inventoryPacks=[{id:'pack',units_per_carton:100,base_unit:'bottle'}];let salesFocusedDelivery='',salesFocusedProforma='',salesSection='',salesEditing='',view='inventory';",ctx);
 const target={innerHTML:'',insertAdjacentHTML(position,text){this.innerHTML+=text},querySelectorAll(){return links}};
 const button={dataset:{inventoryReserved:'lot'},parentElement:target,isConnected:true,disabled:false};
 return {ctx,calls,links,target,button,setLot:value=>vm.runInContext('inventoryLots='+JSON.stringify([value]),ctx),read:code=>vm.runInContext(code,ctx)};
}
test('stock cards show grouped exact counts and owner-only corrections with raw numeric input bounds',()=>{
 const {ctx}=ui();let html=ctx.inventoryLotCard(lot());
 assert.match(html,/Loose bottle on hand<\/small>1,500/);assert.match(html,/Reserved loose bottle<\/small>200/);assert.match(html,/Free loose bottle<\/small>1,300/);assert.match(html,/Total individual units on hand<\/small>1,700/);assert.match(html,/max="1300"/);assert.doesNotMatch(html,/data-inventory-action="correct"/);
 ctx.me={role:'owner'};html=ctx.inventoryLotCard(lot({version:7}));assert.match(html,/data-inventory-action="correct" data-lot="lot" data-version="7"/);assert.match(html,/value="1500"/);
});
test('zero, reserved, expired and non-dispatch cards do not expose issue controls',()=>{
 const {ctx}=ui();for(const change of [{sealed_cartons:0,loose_units:0,reserved_units:0},{loose_units:200},{expiry_date:'2026-10-26'},{location_id:'warehouse'},{stock_status:'quarantine'}]){
  const html=ctx.inventoryLotCard(lot(change));assert.doesNotMatch(html,/data-inventory-action="issue"/);assert.doesNotMatch(html,/<span class="tag">available<\/span>/);
 }
 assert.match(ctx.inventoryLotCard(lot({sealed_cartons:0,loose_units:0,reserved_units:0})),/Out of stock/);
});
test('summary and selected lot chips use the same eligibility reason and semantic tone without inventing low stock',()=>{
 const {ctx}=ui();
 for(const [changes,place,reason,tone]of [
  [{},hub,'Eligible for invoice reservation','success'],
  [{sealed_cartons:0,loose_units:1,reserved_units:0},hub,'Eligible for invoice reservation','success'],
  [{sealed_cartons:0,loose_units:200},hub,'Fully reserved','info'],
  [{sealed_cartons:0,loose_units:0,reserved_units:0},hub,'Out of stock','danger'],
  [{expiry_date:'2026-10-26'},hub,'Expired','danger'],
  [{stock_status:'quarantine'},hub,'Quarantined','warning'],
  [{}, {...hub,active:false},'Location inactive or unavailable','warning'],
  [{}, {...hub,is_dispatch_hub:false},'Transfer to dispatch hub','warning'],
  [{loose_units:0,reserved_units:0},hub,'Open cartons before invoicing','warning']
 ]){
  ctx.place={name:'Haadi',code:'HAA',...place};vm.runInContext('inventoryLocations=[place]',ctx);
  const value=lot(changes),before=JSON.stringify(value),stock=ctx.inventoryLotAvailability(value,ctx.place,today);
  assert.equal(stock.reason,reason);const chip=`<span class="tag chip chip--${tone}">${reason}</span>`;
  for(const html of [ctx.inventoryStockRow(value),ctx.inventoryLotCard(value)])assert.ok(html.includes(chip),reason+' remains the visible label in both renderers');
  assert.equal(JSON.stringify(value),before);assert.equal(stock.invoiceableLoose,reason==='Eligible for invoice reservation'?stock.freeLoose:0);
 }
});
test('unrecognized availability text remains escaped and uses the neutral not-counted tone',()=>{
 const {ctx}=ui();assert.equal(ctx.inventoryAvailabilityChip({reason:'<Unknown condition>'}),'<span class="tag chip chip--neutral">&lt;Unknown condition></span>');
});
test('reservation details read only this lot, exclude inactive deliveries and navigate by exact delivery ID',async()=>{
 const f=ui();f.setLot(lot());f.links.push({dataset:{inventoryDelivery:'delivery'}});
 f.ctx.all=async(table,columns,filter)=>{
  const predicates=[];const query={eq:(...args)=>{predicates.push(['eq',...args]);return query},is:(...args)=>{predicates.push(['is',...args]);return query},in:(...args)=>{predicates.push(['in',...args]);return query}};filter(query);f.calls.push({table,columns,predicates});
  return table==='sales_delivery_lines'?[{delivery_note_id:'delivery',quantity:150},{delivery_note_id:'delivery',quantity:50},{delivery_note_id:'cancelled',quantity:100}]:[{id:'delivery',delivery_number:'DN-<script>',status:'packing'},{id:'cancelled',delivery_number:'CANCELLED',status:'cancelled'}];
 };
 await f.ctx.showInventoryReservations(f.button);
 assert.deepEqual(f.calls[0].predicates,[['eq','lot_id','lot'],['is','inventory_issue_id',null]]);assert.match(f.target.innerHTML,/DN-&lt;script>/);assert.match(f.target.innerHTML,/200 reserved/);assert.doesNotMatch(f.target.innerHTML,/CANCELLED|do not match/);
 await f.links[0].onclick();assert.equal(f.read('salesFocusedDelivery'),'delivery');assert.equal(f.read('view'),'sales');
});
test('delivery access is required before reads and links are hidden without it',async()=>{
 const f=ui();f.ctx.me.access=['stock'];f.ctx.all=async()=>{throw Error('must not read')};f.setLot(lot());
 assert.match(f.ctx.inventoryLotCard(lot()),/Delivery details require Deliveries access/);assert.doesNotMatch(f.ctx.inventoryLotCard(lot()),/data-inventory-reserved/);
 await assert.rejects(f.ctx.showInventoryReservations(f.button),/Deliveries access/);
});
test('partial visible reservations show the mismatch instead of claiming a complete allocation',async()=>{
 const f=ui();f.setLot(lot());f.ctx.all=async table=>table==='sales_delivery_lines'?[{delivery_note_id:'visible',quantity:150}]:[{id:'visible',delivery_number:'DN-1',status:'ready'}];
 await f.ctx.showInventoryReservations(f.button);assert.match(f.target.innerHTML,/150 reserved/);assert.match(f.target.innerHTML,/do not match this stock snapshot/);
});
test('reservation details ignore responses after session change or inventory refresh',async()=>{
 for(const changed of ['actor','refresh']){
  const f=ui();f.setLot(lot());let release;f.ctx.all=()=>new Promise(resolve=>{release=resolve});const pending=f.ctx.showInventoryReservations(f.button);
  if(changed==='actor')f.ctx.me={role:'owner'};else f.ctx.clearInventoryOperations();release([{delivery_note_id:'old',quantity:200}]);await pending;assert.equal(f.target.innerHTML,'');
 }
});

test('stale issue and carton-opening forms cannot submit ineligible stock',async()=>{
 const f=ui();f.ctx.FormData=class{constructor(form){this.fields=form.fields}get(key){return this.fields[key]||''}};f.ctx.client={rpc:async()=>{throw Error('must not write')}};
 for(const change of [{expiry_date:'2026-10-26'},{location_id:'warehouse'},{stock_status:'quarantine'}]){
  f.setLot(lot(change));for(const action of ['issue','open'])await assert.rejects(f.ctx.submitInventoryForm({dataset:{inventoryAction:action,lot:'lot',version:'1'},fields:{quantity:'1',cartons:'1'}}),/eligible loose|cannot be opened/);
 }
 f.setLot(lot({sealed_cartons:0,loose_units:200}));await assert.rejects(f.ctx.submitInventoryForm({dataset:{inventoryAction:'issue',lot:'lot',version:'1'},fields:{quantity:'1'}}),/eligible loose/);
});
