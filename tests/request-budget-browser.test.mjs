// Request budget: opening a main page may not ask the database more often, or wait on it more times in a row, than
// it did when this test was written. Each wait in a row costs ~310 ms from Tanzania whatever its size, so `rounds`
// is the number that users feel; `requests` catches pages that start fetching more.
//
// How it is measured (tests/helpers/request-budget-harness.mjs): the built app runs in Chrome, signed in as the
// owner, against a fake EMPTY database. Each page is opened from the Dashboard of a fresh sign-in, with the client,
// contact and product lists already loaded (as after sign-in). Requests are answered in batches, so a request that
// had to wait for an earlier answer lands in a later round. The notification bell is measured on its own, as
// pages share it (it checks at most every 10 s on a page change).
//
// Limits: the figures measured on sprint/speed-phase1c (30 Oct 2026), lowered as later changes remove requests.
// With real data a few pages ask for more (all() fetches tables over 4,000 rows in a second round); the empty
// database gives the fixed part, which is what code changes move. To change a limit, change it here with the reason.
//
// Run: PLAYWRIGHT_MODULE=… CHROME_EXECUTABLE=… node --test tests/request-budget-browser.test.mjs
// REQUEST_BUDGET_REPORT=1 prints every page's figures and requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {launch,openApp} from './helpers/request-budget-harness.mjs';

// [requests, rounds] per page (menu address), plus sign-in (boot: up to the Dashboard with its numbers) and the bell.
export const budget={
 'boot':[25,7],
 '#/go/dashboard':[2,1],
 '#/go/personal/task':[20,4],
 '#/go/contacts':[0,0],
 '#/go/inventory/catalog':[30,1],
 '#/go/reports':[17,2],
 '#/go/personal/note':[1,1],
 '#/go/personal/event':[1,1],
 '#/go/travel':[1,1],
 '#/go/leads/leads':[8,1],
 '#/go/requests/inquiries':[4,1],
 '#/go/requests/complaints':[4,1],
 '#/go/sales/proformas':[33,3],
 '#/go/contracts':[1,1],
 '#/go/prices':[2,1],
 '#/go/sales/delivery':[33,3],
 '#/go/packing/queue':[1,1],
 '#/go/packing/screen':[1,1],
 '#/go/pending':[20,1],
 '#/go/purchasing/orders':[8,1],
 '#/go/purchasing/suppliers':[8,1],
 '#/go/accounting':[4,4],
 '#/go/books/overview':[10,3],
 '#/go/books/invoices':[8,2],
 '#/go/books/receipts':[8,2],
 '#/go/books/journal':[9,3],
 '#/go/books/accounts':[9,3],
 '#/go/books/reports':[9,3],
 '#/go/books/import':[10,3],
 '#/go/books/opening':[10,3],
 '#/go/service/installations':[25,2],
 '#/go/service/schedule':[25,2],
 '#/go/service/forms':[25,2],
 '#/go/inventory/stock':[31,2],
 '#/go/inventory/transfers':[31,2],
 '#/go/inventory/locations':[31,2],
 '#/go/stockcount/count':[12,1],
 '#/go/stockcount/review':[12,1],
 '#/go/inventory/review':[39,3],
 '#/go/guide':[0,0],
 '#/go/staff':[4,2],
 '#/go/settings':[3,2],
 '#/go/recycle':[4,2],
 '#/go/approvals':[2,1],
 'bell':[6,3]
};

const browser=await launch();
test.after(()=>browser.close());
const report=process.env.REQUEST_BUDGET_REPORT==='1';

// Every page in a fresh sign-in, four at a time (each has its own fake database and batching).
async function measureAll(){
 const first=await openApp(browser),pages=[...first.pages.map(p=>p.hash),'bell'],results={boot:{...first.boot,errors:first.errors}};
 await first.page.close();
 const queue=[...pages];
 await Promise.all(Array.from({length:4},async()=>{
  for(let hash;(hash=queue.shift());){
   const app=await openApp(browser);
   try{results[hash]={...await app.measure(hash),errors:app.errors};}finally{await app.page.close();}
  }
 }));
 return {pages,results};
}

test('every main page stays within its request budget',{timeout:300000},async()=>{
 const {pages,results}=await measureAll();
 assert.deepEqual(pages.filter(hash=>!(hash in budget)),[],'a new menu page needs a budget line');
 const over=[];
 for(const [hash,[requests,rounds]] of Object.entries(budget)){
  const m=results[hash];
  assert.ok(m,`${hash} was not measured (menu item removed? remove its budget line)`);
  assert.deepEqual(m.errors,[],`${hash} opened without script errors`);
  if(report)console.log(`${hash.padEnd(30)} requests ${String(m.count).padStart(3)}/${requests}  rounds ${m.rounds}/${rounds}${m.notice?'  notice: '+m.notice:''}\n${m.requests.map(r=>`   ${r.round} ${r.method} ${r.path} ${r.query.slice(0,100)}`).join('\n')}`);
  if(m.count>requests||m.rounds>rounds)over.push(`${hash}: ${m.count} requests in ${m.rounds} rounds (budget ${requests} in ${rounds})\n${m.requests.map(r=>`   ${r.round} ${r.method} ${r.path}`).join('\n')}`);
 }
 assert.deepEqual(over,[],'pages over budget');
});
