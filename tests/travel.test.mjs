import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const load=()=>{const ctx=vm.createContext({orgIndex:new Map([['o',{name:'Aga Khan',location:'Dar'}]]),Date,Math});vm.runInContext(readFileSync(new URL('../travel.js',import.meta.url),'utf8'),ctx);return ctx;};
const h=n=>new Date(Date.UTC(2026,9,10,n)).toISOString();
test('trip length, place and state read plainly',()=>{
 const ctx=load();
 assert.equal(ctx.travelDuration(h(8),h(17)),'9 h');assert.equal(ctx.travelDuration(h(8),h(8+33)),'1 day 9 h');assert.equal(ctx.travelDuration(h(8),h(8+48)),'2 days');
 assert.equal(ctx.travelPlace({organization_id:'o'}),'Aga Khan · Dar');assert.equal(ctx.travelPlace({destination:'Dodoma'}),'Dodoma');
 const now=Date.parse(h(10));
 assert.equal(ctx.travelState({status:'approved',depart_at:h(8),return_at:h(17)},now)[1],'Away now');
 assert.equal(ctx.travelState({status:'requested',depart_at:h(8),return_at:h(17)},now)[1],'Waiting for approval');
});
test('filters: upcoming, waiting, mine and past',()=>{
 const ctx=load(),now=Date.parse(h(10));
 const rows=[{id:'a',status:'requested',created_by:'me',travellers:['me'],depart_at:h(20),return_at:h(22)},{id:'b',status:'approved',created_by:'x',travellers:['y'],depart_at:h(8),return_at:h(17)},{id:'c',status:'done',created_by:'x',travellers:['me'],depart_at:h(1),return_at:h(2)},{id:'d',status:'approved',created_by:'x',travellers:['y'],depart_at:h(1),return_at:h(2)}];
 const ids=f=>ctx.travelVisible(rows,f,'me',now).map(r=>r.id);
 assert.deepEqual(ids('upcoming'),['b','a']);assert.deepEqual(ids('waiting'),['a']);assert.deepEqual(ids('mine'),['c','a']);assert.deepEqual(ids('past'),['c','d']);
});
test('menu and router include Travel requests',()=>{
 assert.match(readFileSync(new URL('../workspace-navigation.js',import.meta.url),'utf8'),/\['Travel requests','travel'\]/);
 assert.match(readFileSync(new URL('../app.js',import.meta.url),'utf8'),/view==='travel'\)return travelWorkspace\(\)/);
});
test('travel report counts approved and finished trips per traveller',()=>{
 const ctx=vm.createContext({products:[],employeeName:id=>id,Date,Math,Number,String,Object,Map,Set});
 vm.runInContext(readFileSync(new URL('../reports.js',import.meta.url),'utf8'),ctx);
 const rows=ctx.reportTravel([{status:'approved',travellers:['a','b'],organization_id:'o',depart_at:h(0),return_at:h(36)},{status:'done',travellers:['a'],destination:'Dodoma',depart_at:h(0),return_at:h(12)},{status:'declined',travellers:['a'],depart_at:h(0),return_at:h(99)}]);
 assert.deepEqual({...rows[0]},{actor:'a',trips:2,days:2,places:2});assert.deepEqual({...rows[1]},{actor:'b',trips:1,days:1.5,places:1});
});
