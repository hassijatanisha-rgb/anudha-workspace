import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const catalog=[{id:id(1),name:'Analyzer'},{id:id(2),name:'Reagent'},{id:id(3),name:'Archived',deleted_at:'2026-10-19'}];
const prices=()=>new Map([[id(1)+':TZS',{product_id:id(1),currency:'TZS',version:4,unit_price_minor:12000}]]);
function load(extra={}){
 let sequence=0;const ctx=vm.createContext({Blob,Uint8Array,ArrayBuffer,DataView,TextDecoder,TextEncoder,crypto:{randomUUID:()=>id(++sequence+100)},me:{user_id:'owner',role:'owner'},view:'prices',products:catalog,esc:value=>String(value??'').replace(/[&<>"']/g,char=>'&#'+char.charCodeAt(0)+';'),...extra});
 for(const file of ['vendor/xlsx.full.min.js','sales-domain.js','accounting-ledger.js','product-pricing.js','financial-import.js','product-price-import.js'])vm.runInContext(read(file),ctx,{filename:file});
 vm.runInContext('globalThis.setPrices=rows=>{productSalePrices=new Map(rows.map(row=>[pricingKey(row.product_id,row.currency),row]));productPricingActor=me;}',ctx);ctx.setPrices([...prices().values()]);return ctx;
}
const data=(extra=[])=>[[id(1),'Old display name','TZS','1.00','150.25','Approved annual update'],...extra];
function sheet(ctx,rows){ctx.sourceRows=rows;return vm.runInContext('XLSX.utils.aoa_to_sheet([productPriceImportHeaders,...sourceRows])',ctx);}
const preview=(ctx,rows=data())=>ctx.productPriceImportPreview(sheet(ctx,rows),catalog,prices());
const reply=args=>({data:{product_id:args.p_product_id,currency:args.p_currency,unit_price_minor:args.p_unit_price_minor,version:args.p_expected_version+1}});
test('template pages use active exact UUIDs and current currency price but contain no proposed changes',()=>{
 const ctx=load(),rows=ctx.productPriceImportTemplateRows(catalog,prices(),'TZS');assert.equal(rows.length,2);assert.deepEqual(Array.from(rows[0]),[id(1),'Analyzer','TZS','120.00','','']);assert.equal(rows[1][3],'');
 assert.equal(ctx.productPriceImportTemplateRows(catalog,prices(),'USD')[0][3],'');assert.throws(()=>ctx.productPriceImportTemplateRows(catalog,prices(),'GBP'),/currency/);
 const many=Array.from({length:203},(_,i)=>({id:id(i+1),name:String(i).padStart(3,'0')}));assert.equal(ctx.productPriceImportTemplateRows(many,prices(),'TZS').length,200);assert.equal(ctx.productPriceImportTemplateRows(many,prices(),'TZS',1).length,3);
});
test('vendored XLSX workbook and CSV roundtrip the strict price template',async()=>{
 const ctx=load();ctx.source=sheet(ctx,data());const bytes=vm.runInContext("(()=>{const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,source,'Prices');return XLSX.write(book,{type:'array',bookType:'xlsx'});})()",ctx);
 const book=await ctx.financialImportRead({name:'approved.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes});const result=ctx.productPriceImportPreview(book.Sheets.Prices,catalog,prices());assert.equal(result.errors.length,0);assert.equal(result.rows[0].unitPriceMinor,15025);assert.equal(result.rows[0].expectedVersion,4);assert.equal(result.rows[0].beforeMinor,12000);assert.equal(result.rows[0].productName,'Analyzer');
 const csv='\uFEFFProduct ID,Product Name,Currency,Current Price,New Price,Reason\r\n'+id(1)+',"Analyzer, name",TZS,1.00,125.50,"Reviewed\nprice change"';
 const imported=await ctx.financialImportRead({name:'approved.csv',size:csv.length,text:async()=>csv});const resultCsv=ctx.productPriceImportPreview(imported.Sheets[imported.SheetNames[0]],catalog,prices());assert.equal(resultCsv.errors.length,0);assert.equal(resultCsv.rows[0].unitPriceMinor,12550);assert.equal(resultCsv.rows[0].reason,'Reviewed\nprice change');
});
test('exact decimal conversion includes explicit zero and rejects precision loss or out-of-range values',()=>{
 const ctx=load();assert.equal(ctx.productPriceImportMinor('0'),0);assert.equal(ctx.productPriceImportMinor('001.20'),120);assert.equal(ctx.productPriceImportMinor('89999999999999.99'),8999999999999999);assert.equal(ctx.productPriceImportMinor('90000000000000.00'),9000000000000000);
 for(const amount of ['-1','+1','1e3','1,000.00','1.001','NaN','Infinity','','90000000000000.01'])assert.throws(()=>ctx.productPriceImportMinor(amount));assert.throws(()=>ctx.productPriceImportMinor(89999999999999.99),/as text/);
 const result=preview(ctx,[[id(2),'Reagent','USD','','0','Approved zero price']]);assert.equal(result.errors.length,0);assert.equal(result.rows[0].expectedVersion,0);assert.equal(result.rows[0].unitPriceMinor,0);
});
test('UUID-only matching rejects names, archived products, duplicate product/currency and invalid currency/reason',()=>{
 const ctx=load();for(const [column,value,pattern] of [[0,'Analyzer',/active product UUID/],[0,id(3),/active product UUID/],[2,'usd',/Currency must/],[2,'GBP',/Currency must/],[4,'',/Enter New Price/],[5,'x',/Reason must/]]){const rows=data();rows[0][column]=value;assert.match(preview(ctx,rows).errors.join(' '),pattern);}
 const duplicate=preview(ctx,data([[id(1),'Another name','TZS','','100','Approved change']]));assert.match(duplicate.errors.join(' '),/Row 2: Duplicate.*Row 3: Duplicate/);
 const currencies=preview(ctx,data([[id(1),'Another name','USD','','10','Approved change']]));assert.equal(currencies.errors.length,0);
});
test('blank proposals and unchanged prices are skipped without fabricating a missing configured price',()=>{
 const ctx=load(),result=preview(ctx,data([[id(2),'Reagent','TZS','','',''],[id(1),'Analyzer','USD','','0','Approved zero price']]));assert.equal(result.errors.length,0);assert.equal(result.rows[1].status,'not entered');assert.equal(result.rows[1].beforeMinor,null);
 const unchanged=preview(ctx,[[id(1),'Analyzer','TZS','','120.00','Reviewed price']]);assert.equal(unchanged.rows[0].status,'unchanged');assert.match(unchanged.errors[0],/No price changes/);
});
test('formulas, extra columns and over-limit rows fail before saving, including truncated Excel ranges',()=>{
 const ctx=load();let source=sheet(ctx,data());source.E2.f='SUM(100,50.25)';assert.match(ctx.productPriceImportPreview(source,catalog,prices()).errors.join(' '),/Formulas/);
 source=sheet(ctx,data());source.G2={t:'s',v:'Hidden data'};source['!ref']='A1:G2';assert.match(ctx.productPriceImportPreview(source,catalog,prices()).errors.join(' '),/after the Reason/);
 source=sheet(ctx,data());source['!fullref']='A1:F202';assert.match(ctx.productPriceImportPreview(source,catalog,prices()).errors[0],/at most 200/);
 source=sheet(ctx,data());source.A1.f='"Product ID"';assert.match(ctx.productPriceImportPreview(source,catalog,prices()).errors[0],/Row 1/);
});
test('an explicit valid review is required before any RPC, and saves use current preview versions only',async()=>{
 const ctx=load(),p=preview(ctx),calls=[],backend={rpc:async(name,args)=>{calls.push({name,args});return reply(args);}};
 await assert.rejects(ctx.productPriceImportApply(backend,p,()=>true),/Review/);assert.equal(calls.length,0);p.reviewed=true;const result=await ctx.productPriceImportApply(backend,p,()=>true);
 assert.deepEqual({...result},{saved:1,rejected:0,unconfirmed:0,pending:0});assert.equal(calls[0].name,'set_product_sale_price');assert.equal(calls[0].args.p_expected_version,4);assert.equal(calls[0].args.p_product_id,id(1));assert.equal(calls[0].args.p_unit_price_minor,15025);assert.equal(calls[0].args.p_reason,'Approved annual update');
});
test('sequential saves stop on an unconfirmed result and retry the same request while skipping confirmed rows',async()=>{
 const ctx=load(),p=preview(ctx,data([[id(2),'Reagent','USD','','5','Approved update']]));p.reviewed=true;const calls=[];let failures=1,active=0,maxActive=0;
 const backend={rpc:async(name,args)=>{active++;maxActive=Math.max(maxActive,active);calls.push({name,args});await Promise.resolve();active--;if(args.p_product_id===id(2)&&failures-->0)throw Error('Connection lost');return reply(args);}};
 const first=await ctx.productPriceImportApply(backend,p,()=>true);assert.equal(first.saved,1);assert.equal(first.unconfirmed,1);assert.equal(maxActive,1);
 const second=await ctx.productPriceImportApply(backend,p,()=>true);assert.equal(second.saved,2);assert.equal(calls.length,3);assert.deepEqual(calls[1].args,calls[2].args);assert.equal(calls.filter(call=>call.args.p_product_id===id(1)).length,1);
});
test('a confirmed rejection retains previous successes, stops pending rows and requires a fresh review',async()=>{
 const ctx=load(),p=preview(ctx,data([[id(2),'Reagent','USD','','5','Approved update'],[id(2),'Reagent','EUR','','6','Approved update']]));p.reviewed=true;let calls=0;
 const backend={rpc:async(_,args)=>++calls===2?{error:{code:'P0001',message:'Product price changed; refresh before saving'}}:reply(args)};
 const result=await ctx.productPriceImportApply(backend,p,()=>true);assert.deepEqual({...result},{saved:1,rejected:1,unconfirmed:0,pending:1});assert.equal(calls,2);assert.equal(p.rows[1].status,'rejected');await assert.rejects(ctx.productPriceImportApply(backend,p,()=>true),/fresh prices/);assert.equal(calls,2);
});
test('permission rejection after a lost response cannot falsely declare the earlier attempt unsaved',async()=>{
 const ctx=load(),p=preview(ctx);p.reviewed=true;await ctx.productPriceImportApply({rpc:async()=>{throw Error('Lost response');}},p,()=>true);
 const result=await ctx.productPriceImportApply({rpc:async()=>({error:{code:'42501',message:'Access revoked'}})},p,()=>true);assert.equal(result.unconfirmed,1);assert.equal(result.rejected,0);
});
test('malformed success remains unconfirmed and stale session prevents all later writes or UI success',async()=>{
 const ctx=load(),p=preview(ctx);p.reviewed=true;assert.equal((await ctx.productPriceImportApply({rpc:async()=>({data:{product_id:id(1)}})},p,()=>true)).unconfirmed,1);
 const next=preview(ctx,data([[id(2),'Reagent','USD','','5','Approved update']]));next.reviewed=true;let current=true,release,started;const begun=new Promise(resolve=>started=resolve),calls=[];
 const pending=ctx.productPriceImportApply({rpc:(_,args)=>{calls.push(args);started();return new Promise(resolve=>release=resolve);}},next,()=>current);await begun;current=false;release(reply(calls[0]));assert.equal(await pending,null);assert.equal(calls.length,1);assert.equal(next.rows.filter(row=>row.status==='saved').length,0);
});
function uiFixture({allowed=true,actor={user_id:'owner',role:'owner'}}={}){
 const nodes=new Map(),calls=[],get=selector=>{if(!nodes.has(selector))nodes.set(selector,{value:'',files:[],checked:false,disabled:false,innerHTML:'',textContent:''});return nodes.get(selector);},panel={isConnected:true,querySelector:get};
 const target={innerHTML:'',insertAdjacentHTML(_,html){this.innerHTML+=html;},querySelector:()=>panel};let active=true;
 const ctx=load({me:actor,client:{rpc:async(name,args)=>{calls.push({name,args});return name==='accounting_access'?{data:allowed}:reply(args);}}});
 ctx.pricingLoad=async()=>{ctx.setPrices([...prices().values()]);return [...prices().values()];};ctx.bindProductPriceImport(target,()=>active);
 return {ctx,target,panel,get,calls,setActive:value=>active=value};
}
test('import UI performs no price writes at upload/preview and requires the explicit review checkbox',async()=>{
 const f=uiFixture(),text='Product ID,Product Name,Currency,Current Price,New Price,Reason\n'+id(1)+',Analyzer,TZS,1,150.25,Approved update';
 f.get('[data-price-import-file]').files=[{name:'prices.csv',size:text.length,text:async()=>text}];await f.get('[data-price-import-file]').onchange();f.get('[data-price-import-sheet]').value='Sheet1';await f.get('[data-price-import-preview]').onclick();
 assert.match(f.get('[data-price-import-results]').innerHTML,/120.00/);assert.equal(f.calls.filter(call=>call.name==='set_product_sale_price').length,0);assert.equal(f.get('[data-price-import-apply]').disabled,true);
 f.get('[data-price-import-reviewed]').checked=true;f.get('[data-price-import-reviewed]').onchange();assert.equal(f.get('[data-price-import-apply]').disabled,false);await f.get('[data-price-import-apply]').onclick();
 assert.equal(f.calls.filter(call=>call.name==='set_product_sale_price').length,1);assert.match(f.get('[data-price-import-status]').textContent,/1 confirmed saved/);assert.equal(f.get('[data-price-import-apply]').disabled,true);
});
test('import UI rechecks accounting authority and fences late file reads after navigation',async()=>{
 const denied=uiFixture({allowed:false,actor:{user_id:'seller',role:'staff'}});denied.get('[data-price-import-file]').files=[{name:'prices.csv',size:1,text:()=>assert.fail('Unauthorized file parse')}];await denied.get('[data-price-import-file]').onchange();assert.match(denied.get('[data-price-import-status]').textContent,/Only the owner/);
 const f=uiFixture();let release,started;const begun=new Promise(resolve=>started=resolve);f.get('[data-price-import-file]').files=[{name:'prices.csv',size:100,text:()=>{started();return new Promise(resolve=>release=resolve);}}];const pending=f.get('[data-price-import-file]').onchange();await begun;f.setActive(false);release('Product ID,Product Name,Currency,Current Price,New Price,Reason');await pending;assert.equal(f.get('[data-price-import-results]').innerHTML,'');assert.equal(f.calls.filter(call=>call.name==='set_product_sale_price').length,0);
});
test('CSV template export uses the existing formula-escaping helper for product names',()=>{
 const ctx=load(),rows=ctx.productPriceImportTemplateRows([{id:id(1),name:'=HYPERLINK("bad")'}],prices(),'TZS');ctx.rows=rows;
 const csv=vm.runInContext('booksCsv(productPriceImportHeaders.map((header,index)=>[index,header]),rows)',ctx);assert.match(csv,/'=HYPERLINK/);
});
