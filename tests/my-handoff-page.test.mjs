import {installDisclosureMotion} from './helpers/disclosure-motion.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../work-assignments.js',import.meta.url),'utf8'),deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture(){
 const now=Date.parse('2026-10-29T21:30:00Z'),calls=[],actions=[],buttons=[],attributes=new Map(),manualPane={text:'Manual tasks stay mounted'},body={isConnected:true};let lastRun=null,attached=false;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const document={body,activeElement:body,createElement:()=>box},heading={isConnected:true,focus(){document.activeElement=this;}};
 const box={isConnected:true,html:'',setAttribute:(key,value)=>attributes.set(key,value),querySelectorAll(selector){const key=selector.match(/^\[data-([\w-]+)\]$/)?.[1]?.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());return buttons.filter(button=>Object.hasOwn(button.dataset,key));},querySelector(selector){if(selector==='h2')return heading;const [,name,value]=selector.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]/)||[];const key=name?.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());return buttons.find(button=>Object.hasOwn(button.dataset,key)&&(value===undefined||button.dataset[key]===value)&&(!selector.includes(':not(:disabled)')||!button.disabled))||null;}};
 Object.defineProperty(box,'innerHTML',{get:()=>box.html,set:html=>{box.html=html;for(const button of buttons){button.isConnected=false;if(document.activeElement===button)document.activeElement=body;}buttons.length=0;for(const [,attrs] of html.matchAll(/<button\b([^>]*)>/g)){const button={isConnected:true,dataset:{},disabled:/\bdisabled\b/.test(attrs),focus(options){assert.equal(options.preventScroll,true);document.activeElement=this;}};for(const [,key,value] of attrs.matchAll(/data-([\w-]+)(?:="([^"]*)")?/g))button.dataset[key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value||'';buttons.push(button);}}});
 const target={isConnected:true,querySelector:selector=>selector==='.my-handoffs'&&attached?box:null,prepend(node){assert.equal(node,box);attached=true;}};
 const row=i=>({id:'h'+i,record_type:'purchase',record_id:'po'+i,record_label:'PO <'+i+'>',task:'Check <stock>',assignee_user_id:'actor',assigned_by:'sender',due_on:i%2?'2026-10-29':null,status:'open',version:2,created_at:'2026-10-26T00:00:00Z',expected_on:i%3?'2026-10-30':null,age_level:i%3?'':'red',overdue:false,note:'PRIVATE NOTE',reason:'PRIVATE REASON'});
 const response=page=>({total:45,page:Math.min(page,2),pages:3,rows:Array.from({length:page<2?20:5},(_,i)=>row(Math.min(page,2)*20+i))});
 const ctx=vm.createContext({Date:Clock,me:{user_id:'actor',role:'staff'},view:'personal',personalSection:'task',document,esc:value=>String(value??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),employeeName:()=> 'Named <sender>',run:fn=>(lastRun=Promise.resolve().then(fn)),client:{from(){throw Error('Unexpected full read');},rpc:async(name,args)=>{calls.push({name,args:{...args}});return {data:response(args.p_page)};}}});
 installDisclosureMotion(ctx);vm.runInContext(source,ctx);ctx.workToday=()=> '2026-10-30';ctx.workOpenRecord=async row=>actions.push(['open',row]);ctx.openWorkClose=(row,action)=>actions.push(['close',row,action]);ctx.openWorkDelay=row=>actions.push(['delay',row]);
 const get=code=>vm.runInContext(code,ctx);
 return {ctx,get,calls,actions,attributes,box,target,manualPane,document,buttons,row,response,now,async click(selector){const button=box.querySelector(selector);assert.ok(button,selector);button.focus({preventScroll:true});button.onclick();await lastRun;}};
}
test('one RPC returns 20 compact handoffs, exact total and browser date inputs without note/delay narratives',async()=>{
 const f=fixture();assert.equal(await f.ctx.renderMyHandoffs(f.target),true);assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'my_handoff_page');assert.deepEqual(f.calls[0].args,{p_page:0,p_now:'2026-10-29T21:30:00.000Z',p_today:'2026-10-30',p_utc_today:'2026-10-29'});assert.match(f.box.html,/Work handed to me · 45/);assert.equal(f.buttons.filter(b=>b.dataset.workOpen).length,20);assert.equal(f.buttons.filter(b=>b.dataset.workFinish).length,20);assert.equal(f.buttons.filter(b=>b.dataset.workDelayRow).length,20);assert.doesNotMatch(f.box.html,/PRIVATE NOTE|PRIVATE REASON|<stock>|<sender>/);assert.equal(f.attributes.get('aria-busy'),'false');assert.ok((f.box.html.match(/<[^/!][^>]*>/g)||[]).length<2000);
});
test('independent next/previous changes only the handoff pane, preserves page on refresh, and returns logical focus',async()=>{
 const f=fixture(),manual=f.manualPane;await f.ctx.renderMyHandoffs(f.target);await f.click('[data-work-page="next"]');assert.equal(f.calls.length,2);assert.equal(f.calls[1].args.p_page,1);assert.match(f.box.html,/Page 2 of 3/);assert.equal(f.document.activeElement.dataset.workPage,'next');await f.click('[data-work-page="next"]');assert.equal(f.buttons.filter(b=>b.dataset.workOpen).length,5);assert.equal(f.document.activeElement.dataset.workPage,'previous');await f.ctx.renderMyHandoffs(f.target);assert.equal(f.calls.at(-1).args.p_page,2);await f.click('[data-work-page="previous"]');assert.equal(f.get('myHandoffPage'),1);assert.equal(f.manualPane,manual);assert.equal(manual.text,'Manual tasks stay mounted');
});
test('Open, Close and Report delay retain their original row identities and version',async()=>{
 const f=fixture();await f.ctx.renderMyHandoffs(f.target);await f.click('[data-work-open="h0"]');await f.click('[data-work-finish="h0"]');await f.click('[data-work-delay-row="h0"]');assert.deepEqual(f.actions.map(([action,row])=>[action,row.id,row.record_id,row.version]),[['open','h0','po0',2],['close','h0','po0',2],['delay','h0','po0',2]]);assert.equal(f.actions[1][2],'done');assert.equal(f.calls.length,1);
});
test('pending pane reads discard actor, epoch, route, section and detached-root results',async()=>{
 for(const change of [f=>{f.ctx.me={user_id:'actor'};},f=>f.ctx.clearWorkAssignments(),f=>{f.ctx.view='sales';},f=>{f.ctx.personalSection='other';},f=>{f.target.isConnected=false;},f=>{f.box.isConnected=false;}]){
  const f=fixture(),wait=deferred();f.ctx.client.rpc=()=>wait.promise;const loading=f.ctx.renderMyHandoffs(f.target);change(f);f.box.html='Replacement';wait.resolve({data:f.response(0)});assert.equal(await loading,false);assert.equal(f.box.html,'Replacement');
 }
});
test('newer pages win out of order and a replacement actor starts on page one',async()=>{
 const f=fixture(),wait=deferred();let count=0;f.ctx.client.rpc=async(name,args)=>{f.calls.push(args);if(++count===1)return wait.promise;return {data:f.response(args.p_page)};};const first=f.ctx.renderMyHandoffs(f.target);await f.ctx.renderMyHandoffs(f.target,1);wait.resolve({data:f.response(0)});assert.equal(await first,false);assert.equal(f.get('myHandoffPage'),1);f.ctx.me={user_id:'actor'};await f.ctx.renderMyHandoffs(f.target);assert.equal(f.calls.at(-1).p_page,0);
});
test('empty and shrinking pages use exact totals and disabled boundary controls',async()=>{
 const f=fixture();f.ctx.client.rpc=async()=>({data:{rows:[],total:0,page:0,pages:1}});await f.ctx.renderMyHandoffs(f.target);assert.match(f.box.html,/Work handed to me · 0/);assert.match(f.box.html,/Nothing is waiting/);assert.ok(f.buttons.filter(b=>b.dataset.workPage).every(b=>b.disabled));
 f.get('myHandoffPage=2');f.ctx.client.rpc=async()=>({data:{rows:[f.row(0)],total:1,page:0,pages:1}});await f.ctx.renderMyHandoffs(f.target);assert.equal(f.get('myHandoffPage'),0);
});
test('failed or malformed summaries give a retry, never a fake empty list or full-read fallback',async()=>{
 for(const mutate of [()=>null,d=>({...d,total:99}),d=>({...d,rows:[]}),d=>({...d,rows:d.rows.map(row=>({...row,id:'same'}))}),d=>({...d,rows:d.rows.map((row,i)=>i?row:{...row,assignee_user_id:'other'})}),d=>({...d,rows:d.rows.map((row,i)=>i?row:{...row,version:null})})]){
  const f=fixture();f.ctx.client.rpc=async()=>({data:mutate(f.response(0))});assert.equal(await f.ctx.renderMyHandoffs(f.target),false);assert.match(f.box.html,/complete handoff page/);assert.doesNotMatch(f.box.html,/Nothing is waiting/);assert.ok(f.box.querySelector('[data-work-retry]'));
 }
 const f=fixture();f.ctx.client.rpc=async()=>({error:{message:'Denied <request>'}});await f.ctx.renderMyHandoffs(f.target);assert.doesNotMatch(f.box.html,/<request>/);f.ctx.client.rpc=async()=>({data:f.response(0)});await f.click('[data-work-retry]');assert.match(f.box.html,/Work handed to me · 45/);
});
test('stale controls cannot act after navigation or actor replacement and paging cannot steal unrelated focus',async()=>{
 const f=fixture();await f.ctx.renderMyHandoffs(f.target);const button=f.box.querySelector('[data-work-finish="h0"]');f.ctx.me={user_id:'actor'};button.onclick();assert.deepEqual(f.actions,[]);await f.ctx.renderMyHandoffs(f.target);const wait=deferred();f.ctx.client.rpc=()=>wait.promise;const trigger=f.box.querySelector('[data-work-page="next"]');const work=f.ctx.renderMyHandoffs(f.target,1,trigger),other={isConnected:true};f.document.activeElement=other;wait.resolve({data:f.response(1)});await work;assert.equal(f.document.activeElement,other);
});
