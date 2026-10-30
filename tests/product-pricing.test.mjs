import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../product-pricing.js',import.meta.url),'utf8'),domain=readFileSync(new URL('../sales-domain.js',import.meta.url),'utf8');
function load(extra={}){
 const ctx=vm.createContext({workspaceLoading(){},workspaceRefreshRetaining:()=>false,me:{user_id:'sales',role:'staff'},view:'prices',esc:s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),inventoryProductFromChoice:value=>value==='machine'?{id:'machine'}:null,crypto:{randomUUID:()=> 'request-1'},...extra});
 vm.runInContext(domain+'\n'+source+';Object.assign(globalThis,{pricingDiscount,pricingMinorText,pricingLineFields,pricingReadLine,pricingRefreshRow,pricingRefreshForm,pricingBindForm,pricingLoad,pricesWorkspace,clearProductPricing,setPrices:rows=>{productPricingActor=me;productSalePrices=new Map(rows.map(r=>[pricingKey(r.product_id,r.currency),r]));}})',ctx);return ctx;
}
function lineForm({price='100.00',percent='10',amount='',mode='percent',currency='TZS',kind='sale',quantity='2'}={}){
 const input=value=>({value,validity:'',setCustomValidity(value){this.validity=value;}}),nodes=new Map(Object.entries({productChoice:'machine',unitPrice:price,discount:percent,discountAmount:amount,discountMode:mode,quantity}).map(([name,value])=>[`[name="${name}"]`,input(value)]));
 for(const selector of ['[data-discount-percent]','[data-discount-amount]','[data-pricing-feedback]'])nodes.set(selector,{});
 const listeners={},form={dataset:{},querySelector:selector=>selector==='[name="currency"]'?input(currency):selector==='[name="commercialKind"]'?input(kind):selector==='#pricingHelp'?{}:null,querySelectorAll:()=>[row],addEventListener:(event,fn)=>{listeners[event]=fn;}},row={querySelector:selector=>nodes.get(selector),closest:()=>form};
 return {row,form,nodes,listeners};
}
const price=(minor=10000,currency='TZS')=>({product_id:'machine',currency,unit_price_minor:minor,version:1});
test('amount discounts retain the exact rounded amount and calculate their supported percentage',()=>{
 const ctx=load(),a=ctx.pricingDiscount(2,10000,'amount','20.00');assert.deepEqual({...a},{discountBasisPoints:1000,discountMinor:2000,grossMinor:20000});
 assert.equal(ctx.pricingDiscount(3,101,'percent','10').discountMinor,30,'matches SQL round of the whole-line gross');
 assert.throws(()=>ctx.pricingDiscount(1,1000000,'amount','0.01'),/cannot be represented.*nearest percentage.*0\.00/);
 assert.throws(()=>ctx.pricingDiscount(1,100,'amount','1.01'),/cannot exceed/);
 assert.throws(()=>ctx.pricingDiscount(1,0,'amount','0.01'),/cannot exceed/);
 assert.equal(ctx.pricingDiscount(1,0,'amount','0').discountMinor,0);
 assert.throws(()=>ctx.pricingDiscount(1,100,'percent','10.001'),/two decimal places/);
 assert.throws(()=>ctx.pricingDiscount(1,100,'percent','100.01'),/between 0% and 100%/);
 assert.throws(()=>ctx.pricingDiscount(1000000,9000000000000000,'percent','1'),/too large/);
});
test('integer arithmetic matches PostgreSQL half-up rounding through the supported money range',()=>{
 const ctx=load();
 for(const gross of [1,49,50,99,101,10001,999999999999999,9000000000000000])for(const bp of [0,1,999,1000,1001,3333,9999,10000]){
  const expected=Number((BigInt(gross)*BigInt(bp)+5000n)/10000n),result=ctx.pricingDiscount(1,gross,'percent',String(bp/100));assert.equal(result.discountMinor,expected);
  const amount=ctx.pricingMinorText(expected);assert.equal(ctx.pricingDiscount(1,gross,'amount',amount).discountMinor,expected);
 }
 assert.equal(ctx.pricingMinorText(8999999999999999),'89999999999999.99');
});
test('line fields keep a read-only unit price and a canonical discount percentage for existing totals',()=>{
 const ctx=load(),html=ctx.pricingLineFields({unit_price_minor:12345,discount_basis_points:1250});
 assert.match(html,/name="unitPrice"[^>]+readonly/);assert.match(html,/name="discount"[^>]+value="12.5"/);assert.match(html,/name="discountMode"/);assert.match(html,/Amount for this line/);
 const {row,nodes}=lineForm({mode:'amount',amount:'20.00'});ctx.setPrices([price()]);const result=ctx.pricingReadLine(row,{quantity:2,unitPriceMinor:10000});assert.deepEqual({...result},{unitPriceMinor:10000,discountBasisPoints:1000});assert.equal(nodes.get('[name="discount"]').value,'10');
 nodes.get('[name="discountAmount"]').value='0.01';ctx.setPrices([price(1000000)]);assert.throws(()=>ctx.pricingReadLine(row,{quantity:1,unitPriceMinor:1000000}),/cannot be represented/);
});
test('configured prices handle product, currency and placement without fabricating a missing price',()=>{
 const ctx=load();ctx.setPrices([price()]);const {row,form,nodes}=lineForm();ctx.pricingRefreshRow(row,form);assert.equal(nodes.get('[name="unitPrice"]').value,'100.00');assert.match(nodes.get('[data-pricing-feedback]').textContent,/Actual discount: TZS\s*20 \(10%\)/);
 const missing=lineForm({currency:'USD'});ctx.pricingRefreshRow(missing.row,missing.form);assert.equal(missing.nodes.get('[name="unitPrice"]').value,'');assert.match(missing.nodes.get('[data-pricing-feedback]').textContent,/No configured USD price/);assert.match(missing.nodes.get('[name="productChoice"]').validity,/No configured USD/);assert.equal(missing.nodes.get('[name="discount"]').validity,'');
 ctx.setPrices([price(0,'USD')]);ctx.pricingRefreshRow(missing.row,missing.form);assert.equal(missing.nodes.get('[name="unitPrice"]').value,'0.00');
 const placement=lineForm({kind:'placement'});ctx.pricingRefreshRow(placement.row,placement.form);assert.equal(placement.nodes.get('[name="unitPrice"]').value,'0.00');
 assert.throws(()=>ctx.pricingReadLine(row,{quantity:2,unitPriceMinor:10000}),/No configured TZS/);
});
test('opening an older draft does not silently replace its base price; invalid amounts remain blocked',()=>{
 const ctx=load(),{row,form,nodes,listeners}=lineForm({price:'80.00'});ctx.setPrices([price()]);ctx.pricingBindForm(form);
 assert.equal(nodes.get('[name="unitPrice"]').value,'80.00');assert.match(nodes.get('[name="productChoice"]').validity,/Saved unit price differs/);assert.equal(nodes.get('[name="discount"]').validity,'');
 listeners.change({target:{name:'productChoice',closest:()=>row}});assert.equal(nodes.get('[name="unitPrice"]').value,'100.00');assert.equal(nodes.get('[name="discount"]').validity,'');
 nodes.get('[name="discountMode"]').value='amount';listeners.change({target:{name:'discountMode',value:'amount',closest:()=>row}});assert.equal(nodes.get('[name="discountAmount"]').value,'20.00');
 nodes.get('[name="discountAmount"]').value='999.99';listeners.input({target:{name:'discountAmount',closest:()=>row}});assert.match(nodes.get('[name="discountAmount"]').validity,/cannot exceed/);assert.equal(nodes.get('[name="discount"]').value,'10','bad amount never misstates percentage');
});
test('clearing the session discards price authority and rejects stale forms',()=>{
 const ctx=load(),{row}=lineForm();ctx.setPrices([price()]);ctx.clearProductPricing();assert.throws(()=>ctx.pricingReadLine(row,{quantity:2,unitPriceMinor:10000}),/not loaded for this login/);
 ctx.setPrices([price()]);ctx.me={user_id:'sales',role:'staff'};assert.throws(()=>ctx.pricingReadLine(row,{quantity:2,unitPriceMinor:10000}),/not loaded for this login/);
});
function backend(pages){let calls=0;return {rpc:async()=>({data:false}),from:()=>{const query={select:()=>query,order:()=>query,range:()=>typeof pages[calls]==='function'?pages[calls++]():Promise.resolve(pages[calls++])};return query;},calls:()=>calls};}
test('price loading pages by product and currency and ignores late results after a session change',async()=>{
 const first=Array.from({length:1000},(_,i)=>({...price(),product_id:String(i)})),client=backend([{data:first},{data:[price()]}]),ctx=load({client});assert.equal((await ctx.pricingLoad()).length,1001);assert.equal(client.calls(),2);
 let resolve;ctx.client=backend([()=>new Promise(r=>{resolve=r;})]);const pending=ctx.pricingLoad();ctx.me={user_id:'other'};resolve({data:[price()]});assert.equal(await pending,null);
});
test('a price page finishing after navigation cannot overwrite the shared content area',async()=>{
 let resolve;const ctx=load({client:{rpc:()=>new Promise(r=>resolve=r)}}),target={innerHTML:'',isConnected:true};
 const pending=ctx.pricesWorkspace(target);ctx.view='contacts';target.innerHTML='Client page';resolve({data:{}});await pending;assert.equal(target.innerHTML,'Client page');
});
