import {installDisclosureMotion} from './helpers/disclosure-motion.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../work-assignments.js',import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture(){
 class Element{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.parent=null;this.open=false;this.dataset={};this.className='';this.html='';this.textContent='';this.rootConnected=false;this.classList={add:name=>{this.className+=' '+name;}};}
  setAttribute(name,value){(this.attrs??={})[name]=value;}
  addEventListener(name,fn){(this.events??={})[name]=fn;}
  get isConnected(){return this.parent?this.parent.isConnected:this.rootConnected;}
  set innerHTML(html){for(const child of this.children)child.parent=null;this.children=[];this.html=html;
   const summary=html.match(/<summary>(.*?)<\/summary>/s);if(summary){const node=new Element('summary');node.textContent=summary[1];this.append(node);}
   for(const [,key] of html.matchAll(/<div data-([\w-]+)>/g)){const node=new Element();node.dataset[key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]='';this.append(node);}
   for(const [,content] of html.matchAll(/<li>(.*?)<\/li>/gs)){const li=new Element('li');this.append(li);for(const [,key,value] of content.matchAll(/<button[^>]*data-([\w-]+)="([^"]*)"/g)){const button=new Element('button');button.dataset[key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;li.append(button);}}
  }
  get innerHTML(){return this.html;}
  append(child){child.parent=this;this.children.push(child);}
  prepend(child){child.parent=this;this.children.unshift(child);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}
  closest(tag){return this.tagName===tag?this:this.parent?.closest(tag);}
  querySelectorAll(selector){const key=selector.match(/^\[data-([\w-]+)\]$/)?.[1]?.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());return this.children.flatMap(child=>[...((key?Object.hasOwn(child.dataset,key):selector.startsWith('.')?child.className.split(' ').includes(selector.slice(1)):child.tagName===selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 }
 const target=new Element();target.rootConnected=true;const calls=[],actions=[];let pending=null;
 const notice=i=>({id:'notice-'+i,record_type:'delivery',record_id:'delivery-'+i,record_label:'DN <'+i+'>',message:'Update <'+i+'>',created_at:'2026-10-28T12:00:00Z'});
 const unowned=i=>({record_type:'service',record_id:'service-'+i,record_label:'SC <'+i+'>',status:'waiting_for_parts',waiting_since:'2026-10-28T12:00:00Z'});
 const responses={notices:{data:Array.from({length:50},(_,i)=>notice(i))},unowned:{data:Array.from({length:500},(_,i)=>unowned(i))},dismiss:{data:true}};
 const client={from(table){const call={name:table,steps:[]};calls.push(call);const query={};for(const method of ['select','eq','is','order'])query[method]=(...args)=>{call.steps.push([method,...args]);return query;};query.limit=number=>{call.steps.push(['limit',number]);return responses.notices;};return query;},rpc(name,args){calls.push({name,args});return name==='unowned_work'?responses.unowned:responses.dismiss;}};
 const ctx=vm.createContext({me:{user_id:'actor',role:'owner'},document:{createElement:tag=>new Element(tag)},client,esc:value=>String(value??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),run:fn=>(pending=Promise.resolve().then(fn))});
 installDisclosureMotion(ctx);vm.runInContext(source,ctx);ctx.workOpenRecord=async row=>actions.push(['open',row]);ctx.openWorkHandoff=({origin,refresh,...row})=>actions.push(['assign',row]);
 return {ctx,target,calls,actions,responses,notice,unowned,get notices(){return target.querySelector('.work-notices');},get unownedBox(){return target.querySelector('.unowned-work');},open(box){box.open=true;return box.ontoggle?.();},async click(box,selector,index=0){box.querySelectorAll(selector)[index].onclick();await pending;}};
}
test('cold ancillary reads preserve filters and limits while mounting only native disclosure summaries',async()=>{
 const f=fixture();await Promise.all([f.ctx.renderWorkNotices(f.target),f.ctx.renderUnownedWork(f.target)]);
 assert.equal(f.calls.length,2);assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0])),{name:'work_notices',steps:[['select','id,record_type,record_id,record_label,message,created_at'],['eq','user_id','actor'],['is','read_at',null],['order','created_at',{ascending:false}],['limit',50]]});assert.equal(f.calls[1].name,'unowned_work');
 for(const box of [f.notices,f.unownedBox]){assert.equal(box.tagName,'details');assert.equal(box.open,false);assert.equal(box.querySelectorAll('li').length,0);assert.equal(box.querySelectorAll('button').length,0);assert.doesNotMatch(box.innerHTML,/DN|SC|Update &#60;|waiting for parts/);}
 assert.equal(f.notices.querySelector('summary').textContent,'Updates · latest 50');assert.equal(f.unownedBox.querySelector('summary').textContent,'Nobody responsible · at least 500');assert.match(f.unownedBox.className,/attention/);
});
test('opening notices mounts all 50 escaped records once without another read and keeps Open actions',async()=>{
 const f=fixture();await f.ctx.renderWorkNotices(f.target);const box=f.notices;f.open(box);const panel=box.querySelector('[data-work-notice-items]');
 assert.equal(box.querySelectorAll('li').length,50);assert.equal(box.querySelectorAll('button').length,100);assert.match(panel.innerHTML,/DN &#60;49&#62;.*Update &#60;49&#62;/);assert.doesNotMatch(panel.innerHTML,/<49>/);
 await f.click(box,'[data-notice-open]',49);assert.deepEqual(JSON.parse(JSON.stringify(f.actions)),[['open',{record_type:'delivery',record_id:'delivery-49',record_label:'DN <49>'}]]);
 const first=box.querySelector('li');box.open=false;box.ontoggle();f.open(box);assert.equal(box.querySelector('li'),first);assert.equal(f.calls.length,1);
});
test('opening unowned work preserves the first 100 rows, truncation disclosure, status and both actions',async()=>{
 const f=fixture();await f.ctx.renderUnownedWork(f.target);const box=f.unownedBox;f.open(box);const panel=box.querySelector('[data-unowned-items]');
 assert.equal(box.querySelectorAll('li').length,100);assert.equal(box.querySelectorAll('button').length,200);assert.match(panel.innerHTML,/Showing the first 100 of 500 returned records/);assert.match(panel.innerHTML,/SC &#60;99&#62;.*Service \/ installation.*waiting for parts/);assert.doesNotMatch(panel.innerHTML,/SC &#60;100&#62;/);
 await f.click(box,'[data-unowned-open]',99);await f.click(box,'[data-unowned-assign]',99);assert.deepEqual(JSON.parse(JSON.stringify(f.actions)),[['open',f.unowned(99)],['assign',{type:'service',id:'service-99',label:'SC <99>',current:null}]]);assert.equal(f.calls.length,1);
 const first=box.querySelector('li');box.open=false;box.ontoggle();f.open(box);assert.equal(box.querySelector('li'),first);
});
test('verified dismissal updates only its row and bounded summary, then removes an empty pane',async()=>{
 const f=fixture();f.responses.notices={data:[f.notice(0),f.notice(1)]};await f.ctx.renderWorkNotices(f.target);const box=f.notices;f.open(box);
 assert.equal(box.querySelector('summary').textContent,'Updates · 2');const other=box.querySelectorAll('li')[1];await f.click(box,'[data-notice-dismiss]');assert.equal(box.querySelector('li'),other);assert.equal(box.querySelector('summary').textContent,'Updates · 1');assert.equal(f.calls.at(-1).name,'dismiss_work_notice');assert.equal(f.calls.at(-1).args.p_id,'notice-0');
 await f.click(box,'[data-notice-dismiss]');assert.equal(f.notices,null);
 const capped=fixture();await capped.ctx.renderWorkNotices(capped.target);capped.open(capped.notices);await capped.click(capped.notices,'[data-notice-dismiss]');assert.equal(capped.notices.querySelector('summary').textContent,'Updates · latest 49');
});
test('failed dismissal retains the row and count, while stale completions cannot change the pane',async()=>{
 const f=fixture();f.responses.notices={data:[f.notice(0)]};await f.ctx.renderWorkNotices(f.target);const box=f.notices;f.open(box);f.responses.dismiss={error:{message:'Denied'}};await assert.rejects(f.click(box,'[data-notice-dismiss]'),/Denied/);assert.equal(box.querySelectorAll('li').length,1);assert.equal(box.querySelector('summary').textContent,'Updates · 1');
 for(const change of [g=>{g.ctx.me={user_id:'actor'};},g=>g.ctx.clearWorkAssignments(),g=>g.target.rootConnected=false,g=>g.notices.remove()]){
  const g=fixture();await g.ctx.renderWorkNotices(g.target);const current=g.notices;g.open(current);const wait=deferred();g.responses.dismiss=wait.promise;const saving=g.click(current,'[data-notice-dismiss]');await Promise.resolve();change(g);wait.resolve({data:true});await saving;assert.equal(current.querySelectorAll('li').length,50);assert.equal(current.querySelector('summary').textContent,'Updates · latest 50');
 }
});
test('replacement actors, cleared epochs and detached roots reject pending reads and stale disclosure controls',async()=>{
 for(const name of ['renderWorkNotices','renderUnownedWork'])for(const change of [f=>{f.ctx.me={user_id:'actor'};},f=>f.ctx.clearWorkAssignments(),f=>f.target.rootConnected=false]){
  const f=fixture(),wait=deferred(),key=name==='renderWorkNotices'?'notices':'unowned';f.responses[key]=wait.promise;const loading=f.ctx[name](f.target);change(f);wait.resolve({data:[key==='notices'?f.notice(0):f.unowned(0)]});await loading;assert.equal(f.target.children.length,0);
  const g=fixture();await g.ctx[name](g.target);const box=name==='renderWorkNotices'?g.notices:g.unownedBox;change(g);g.open(box);assert.equal(box.querySelectorAll('li').length,0);
 }
 for(const name of ['renderWorkNotices','renderUnownedWork']){
  const f=fixture();await f.ctx[name](f.target);const box=name==='renderWorkNotices'?f.notices:f.unownedBox;f.open(box);f.ctx.clearWorkAssignments();for(const button of box.querySelectorAll('button'))button.onclick();assert.equal(f.calls.length,1);assert.deepEqual(f.actions,[]);
 }
});
test('newer pane reads win and refresh retains each disclosure choice',async()=>{
 for(const name of ['renderWorkNotices','renderUnownedWork']){
  const f=fixture(),wait=deferred(),key=name==='renderWorkNotices'?'notices':'unowned',getBox=()=>key==='notices'?f.notices:f.unownedBox,row=key==='notices'?f.notice:f.unowned;
  f.responses[key]=wait.promise;const stale=f.ctx[name](f.target);f.responses[key]={data:[row(2)]};await f.ctx[name](f.target);const fresh=getBox();wait.resolve({data:[row(1)]});await stale;assert.equal(getBox(),fresh);assert.equal(fresh.open,false);
  f.open(fresh);await f.ctx[name](f.target);assert.equal(getBox().open,true);assert.equal(getBox().querySelectorAll('li').length,1);getBox().open=false;getBox().ontoggle();await f.ctx[name](f.target);assert.equal(getBox().open,false);assert.equal(getBox().querySelectorAll('li').length,0);
 }
});
test('queued Open and Got it actions recheck the actor before dispatch',async()=>{
 for(const selector of ['[data-notice-open]','[data-notice-dismiss]','[data-unowned-open]']){
  const f=fixture(),notices=selector.includes('notice');await f.ctx[notices?'renderWorkNotices':'renderUnownedWork'](f.target);const box=notices?f.notices:f.unownedBox;f.open(box);const clicking=f.click(box,selector);f.ctx.me={user_id:'actor'};await clicking;assert.equal(f.calls.length,1);assert.deepEqual(f.actions,[]);
 }
});
test('empty results remove previous panes; existing read-error behavior remains visible or retained',async()=>{
 const f=fixture();await Promise.all([f.ctx.renderWorkNotices(f.target),f.ctx.renderUnownedWork(f.target)]);const notices=f.notices;f.responses.notices={error:{message:'Unread unavailable'}};f.responses.unowned={error:{message:'Unavailable <now>'}};await Promise.all([f.ctx.renderWorkNotices(f.target),f.ctx.renderUnownedWork(f.target)]);
 assert.equal(f.notices,notices);f.open(notices);await f.click(notices,'[data-notice-open]');assert.equal(f.actions[0][1].record_id,'delivery-0');assert.equal(f.unownedBox.open,true);assert.match(f.unownedBox.innerHTML,/role="alert"/);assert.match(f.unownedBox.innerHTML,/Unavailable &#60;now&#62;/);assert.doesNotMatch(f.unownedBox.innerHTML,/<now>/);
 f.responses.notices={data:[]};f.responses.unowned={data:[]};await Promise.all([f.ctx.renderWorkNotices(f.target),f.ctx.renderUnownedWork(f.target)]);assert.equal(f.target.children.length,0);
});


test('My tasks defers unowned work without deferring unread notices or inventing an unchecked count',async()=>{
 const f=fixture();await Promise.all([f.ctx.renderWorkNotices(f.target),f.ctx.renderUnownedWork(f.target,'',true)]);
 assert.deepEqual(f.calls.map(call=>call.name),['work_notices']);assert.equal(f.unownedBox.open,false);assert.equal(f.unownedBox.querySelector('summary').textContent,'Nobody responsible · open to check');assert.equal(f.unownedBox.querySelectorAll('li').length,0);assert.equal(f.notices.querySelector('summary').textContent,'Updates · latest 50');
});
test('opening a deferred pane reads once, preserves all existing row limits and keeps assignment actions',async()=>{
 const f=fixture();await f.ctx.renderUnownedWork(f.target,'',true);const placeholder=f.unownedBox,wait=deferred();f.responses.unowned=wait.promise;
 const opening=f.open(placeholder);await Promise.resolve();assert.deepEqual(f.calls.map(call=>call.name),['unowned_work']);assert.match(placeholder.querySelector('[data-unowned-items]').innerHTML,/Checking unassigned work/);f.open(placeholder);assert.equal(f.calls.length,1);
 wait.resolve({data:Array.from({length:500},(_,i)=>f.unowned(i))});await opening;const box=f.unownedBox;assert.equal(box.open,true);assert.equal(box.querySelector('summary').textContent,'Nobody responsible · at least 500');assert.equal(box.querySelectorAll('li').length,100);assert.equal(box.querySelectorAll('button').length,200);
 await f.click(box,'[data-unowned-assign]',99);assert.equal(f.actions[0][1].id,'service-99');box.open=false;box.ontoggle();await f.open(box);assert.equal(f.calls.length,1);
});
test('expanded refresh and saved assignment recovery bypass deferral, while collapsed refresh waits',async()=>{
 const f=fixture();await f.ctx.renderUnownedWork(f.target,'',true);await f.open(f.unownedBox);await f.ctx.renderUnownedWork(f.target,'',true);assert.equal(f.calls.length,2);assert.equal(f.unownedBox.open,true);
 f.unownedBox.open=false;await f.ctx.renderUnownedWork(f.target,'',true);assert.equal(f.calls.length,2);assert.match(f.unownedBox.innerHTML,/open to check/);
 await f.ctx.renderUnownedWork(f.target,'Order handed to Fatima.',true);assert.equal(f.calls.length,3);assert.match(f.unownedBox.innerHTML,/Saved\./);assert.match(f.unownedBox.innerHTML,/Order handed to Fatima/);
});
test('a deferred pane rejects stale actors, session clears, detached roots and replaced disclosures before dispatch',async()=>{
 for(const change of [f=>{f.ctx.me={user_id:'actor'};},f=>f.ctx.clearWorkAssignments(),f=>f.target.rootConnected=false,f=>f.unownedBox.remove()]){
  const f=fixture();await f.ctx.renderUnownedWork(f.target,'',true);const box=f.unownedBox;change(f);await f.open(box);assert.equal(f.calls.length,0);assert.equal(box.querySelectorAll('li').length,0);
 }
});
test('a deferred refresh supersedes an in-flight check, and older responses never restore old rows',async()=>{
 const f=fixture();await f.ctx.renderUnownedWork(f.target,'',true);const wait=deferred();f.responses.unowned=wait.promise;const opening=f.open(f.unownedBox);await Promise.resolve();f.unownedBox.open=false;
 await f.ctx.renderUnownedWork(f.target,'',true);const replacement=f.unownedBox;wait.resolve({data:[f.unowned(9)]});await opening;assert.equal(f.unownedBox,replacement);assert.match(replacement.innerHTML,/open to check/);assert.equal(replacement.querySelectorAll('li').length,0);assert.equal(f.calls.length,1);
});
test('closing a deferred pane while its check runs preserves the closed disclosure',async()=>{
 const f=fixture();await f.ctx.renderUnownedWork(f.target,'',true);const wait=deferred();f.responses.unowned=wait.promise;const opening=f.open(f.unownedBox);await Promise.resolve();f.unownedBox.open=false;wait.resolve({data:[f.unowned(0)]});await opening;
 assert.equal(f.unownedBox.open,false);assert.equal(f.unownedBox.querySelectorAll('li').length,0);await f.open(f.unownedBox);assert.equal(f.unownedBox.querySelectorAll('li').length,1);assert.equal(f.calls.length,1);
});
test('a failed deferred check exposes escaped error and retry rather than actionable unverified rows',async()=>{
 const f=fixture();f.responses.unowned={error:{message:'Denied <current>'}};await f.ctx.renderUnownedWork(f.target,'',true);await f.open(f.unownedBox);
 assert.equal(f.calls.length,1);assert.equal(f.unownedBox.open,true);assert.match(f.unownedBox.innerHTML,/Denied &#60;current&#62;/);assert.match(f.unownedBox.innerHTML,/data-unowned-retry/);assert.doesNotMatch(f.unownedBox.innerHTML,/data-unowned-assign/);
});
