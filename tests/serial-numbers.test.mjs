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
  inventoryClassification:id=>({category:id==='M'?'machines':'reagents'}),inventoryProduct:id=>({name:id==='M'?'Analyzer':'Reagent'}),
  $:selector=>selector==='#content'?content:selector==='#inventoryRefresh'?{}:selector==='#serialSearch'?{}:null,
  client:{from:()=>({select:async()=>({data:[{product_id:'M',serial_required:false},{product_id:'R',serial_required:true}]})})}});
 vm.runInContext(fs.readFileSync(new URL('../serial-numbers.js',import.meta.url),'utf8'),ctx);await ctx.decorateSerialTools();
 assert.match(html,/Analyzer <small>Required for machines<\/small>/);assert.doesNotMatch(html,/data-serial-unflag="M"/);assert.match(html,/data-serial-unflag="R"/);
});
