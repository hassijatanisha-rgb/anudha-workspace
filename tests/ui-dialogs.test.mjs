import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';

const source=readFileSync(new URL('../ui-dialogs.js',import.meta.url),'utf8');
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture({reduced=false,phone=false}={}){
 const document=dom(),animations=[],create=document.createElement.bind(document);
 document.createElement=tag=>{
  const node=create(tag);node.style={setProperty:(key,value)=>node.style[key]=value,removeProperty:key=>delete node.style[key]};
  node.setPointerCapture=id=>node.pointerCapture=id;node.hasPointerCapture=id=>node.pointerCapture===id;node.releasePointerCapture=()=>{node.pointerCapture=null;};
  Object.defineProperty(node,'id',{get:()=>node.attrs.id||'',set:value=>node.attrs.id=value});
  Object.defineProperty(node,'className',{get:()=>node.attrs.class||'',set:value=>node.attrs.class=value});
  node.classList={add:token=>node.className=[...new Set([...node.className.split(' ').filter(Boolean),token])].join(' '),remove:token=>node.className=node.className.split(' ').filter(value=>value!==token).join(' ')};
  node.getBoundingClientRect=()=>node.rect||{left:200,top:100,width:400,height:200,right:600,bottom:300};
  node.animate=(frames,options)=>{let finish,reject;const finished=new Promise((yes,no)=>{finish=yes;reject=no});const animation={node,frames,options,finished,finish,cancel:()=>{animation.cancelled=true;reject(Error('Cancelled'));}};animations.push(animation);return animation;};
  node.fire=(type,extra={})=>{const event={target:node,preventDefault(){this.prevented=true;},...extra};for(const {fn} of node.events[type]||[])fn(event);return event;};
  return node;
 };
 document.documentElement=document.createElement('html');
 document.addEventListener=(type,fn)=>document.documentElement.addEventListener(type,fn);
 document.removeEventListener=(type,fn)=>{document.documentElement.events[type]=document.documentElement.events[type].filter(event=>event.fn!==fn);};
 const trigger=document.createElement('button');trigger.rect={left:20,top:20,width:44,height:44,right:64,bottom:64};document.body.append(trigger);trigger.focus();
 const context=vm.createContext({DOMMatrixReadOnly:class{constructor(value){this.m42=value?.startsWith('matrix(')?Number(value.slice(7,-1).split(',')[5]):0;}},document,me:{user_id:'owner'},matchMedia:query=>({matches:query.includes('reduced-motion')?reduced:phone}),getComputedStyle:node=>({opacity:node.style.opacity||node.renderedOpacity||'1',transform:node.style.transform||node.renderedTransform||'none',getPropertyValue:key=>({'--m-base':'200ms','--m-slow':'300ms','--m-fade':'150ms','--ease-in':'cubic-bezier(.2,.8,.2,1)','--ease-out':'cubic-bezier(.8,.2,.8,1)'}[key])})});
 vm.runInContext(readFileSync(new URL('../client-rules.js',import.meta.url),'utf8'),context);vm.runInContext(source,context);
 const dialogs=()=>document.querySelectorAll('dialog'),last=()=>animations.at(-1);
 const complete=async()=>{last().finish();await tick();};
 const submit=dialog=>dialog.querySelector('form').fire('submit');
 return {document,context,trigger,dialogs,animations,last,complete,submit};
}

test('confirmation uses text nodes, specific action and safe initial focus; resolves after exit and restores trigger',async()=>{
 const f=fixture(),answer=f.context.askConfirm({title:'Remove <img src=x>?',body:'Access stops.',confirmLabel:'Remove access',tone:'danger'}),dialog=f.dialogs()[0];
 assert.equal(dialog.querySelector('h2').textContent,'Remove <img src=x>?');assert.equal(dialog.querySelector('img'),null);
 assert.equal(dialog.getAttribute('aria-labelledby'),dialog.querySelector('h2').id);
 assert.equal(f.document.activeElement.textContent,'Cancel');assert.equal(dialog.querySelectorAll('button')[1].className,'button-destructive');
 assert.equal(f.last().options.duration,200);f.submit(dialog);assert.equal(dialog.open,true,'native dialog must remain open during exit');
 assert.equal(f.last().options.duration,150);await f.complete();assert.equal(await answer,true);assert.equal(f.dialogs().length,0);assert.equal(f.document.activeElement,f.trigger);
});

test('normal confirmation focuses the primary; Escape and backdrop cancel without writes',async()=>{
 for(const event of ['cancel','click']){
  const f=fixture(),answer=f.context.askConfirm({title:'Import products?',confirmLabel:'Import products'}),dialog=f.dialogs()[0];
  assert.equal(f.document.activeElement.textContent,'Import products');
  const dispatched=dialog.fire(event,{clientX:0,clientY:0});if(event==='cancel')assert.equal(dispatched.prevented,true);
  await f.complete();assert.equal(await answer,false);assert.equal(f.document.activeElement,f.trigger);
 }
});

test('a click inside the dialog does not dismiss it',()=>{
 const f=fixture();f.context.askConfirm({title:'Save?'});const dialog=f.dialogs()[0];dialog.fire('click',{clientX:300,clientY:150});assert.equal(f.animations.length,1);assert.equal(dialog.open,true);f.context.clearWorkspaceQuestions();
});

test('Cancel stays inside the confirmation instead of reaching the workspace busy-action gate',async()=>{
 const f=fixture(),answer=f.context.askConfirm({title:'Import rows?'}),dialog=f.dialogs()[0];let stopped=false;
 dialog.querySelectorAll('button')[0].onclick({stopPropagation(){stopped=true;}});assert.equal(stopped,true);await f.complete();assert.equal(await answer,false);
});

test('text validates on blur and submit, preserves input and focuses invalid field',async()=>{
 const f=fixture(),answer=f.context.askText({title:'Product name',label:'Name',value:'',validate:value=>value.trim()?'':'Enter a product name.'}),dialog=f.dialogs()[0],input=dialog.querySelector('input');
 input.fire('blur');assert.equal(input.getAttribute('aria-invalid'),'true');assert.equal(dialog.querySelector('[role="alert"]').textContent,'Enter a product name.');
 f.submit(dialog);assert.equal(dialog.open,true);assert.equal(f.document.activeElement,input);
 input.value='Analyzer';input.fire('blur');assert.equal(input.getAttribute('aria-invalid'),'false');f.submit(dialog);await f.complete();assert.equal(await answer,'Analyzer');
});

test('dirty text asks once before discard; declining keeps the original value and dialog',async()=>{
 const f=fixture(),answer=f.context.askText({title:'Name',label:'Name',value:'Original'}),dialog=f.dialogs()[0];dialog.querySelector('input').value='Changed';dialog.fire('cancel');dialog.fire('cancel');
 assert.equal(f.dialogs().length,2);let discard=f.dialogs()[1];assert.equal(discard.querySelector('h2').textContent,'Discard changes?');assert.equal(f.document.activeElement.textContent,'Cancel');discard.fire('cancel');await f.complete();
 assert.equal(f.dialogs().length,1);assert.equal(dialog.querySelector('input').value,'Changed');dialog.fire('cancel');discard=f.dialogs()[1];f.submit(discard);await f.complete();await f.complete();assert.equal(await answer,null);
});

test('actor change during confirmation or exit can never approve',async()=>{
 for(const duringExit of [false,true]){
  const f=fixture(),answer=f.context.askConfirm({title:'Remove access?'}),dialog=f.dialogs()[0];
  if(duringExit)f.submit(dialog);f.context.me={user_id:'owner'};if(!duringExit)f.submit(dialog);else await f.complete();
  assert.equal(await answer,false);assert.equal(f.dialogs().length,0);
 }
});

test('session clear immediately dismisses all nested questions and settles them as cancelled',async()=>{
 const f=fixture(),answer=f.context.askText({title:'Name',label:'Name',value:'Old'}),dialog=f.dialogs()[0];dialog.querySelector('input').value='New';dialog.fire('cancel');assert.equal(f.dialogs().length,2);f.context.clearWorkspaceQuestions();await tick();assert.equal(await answer,null);assert.equal(f.dialogs().length,0);
});

test('enter/exit can reverse from the current rendered position without closing a reopened dialog',async()=>{
 const f=fixture(),dialog=f.document.createElement('dialog');f.document.body.append(dialog);f.context.showWorkspaceDialog(dialog);dialog.renderedOpacity='.6';dialog.renderedTransform='matrix(.98,0,0,.98,0,0)';
 const closing=f.context.closeWorkspaceDialog(dialog);assert.equal(dialog.inert,true,'closing forms cannot accept another pointer or keyboard submit');assert.equal(f.last().frames[0].opacity,'.6');f.context.showWorkspaceDialog(dialog);await tick();assert.equal(await closing,false);assert.equal(dialog.inert,false);assert.equal(dialog.open,true);assert.equal(f.last().frames[0].opacity,'.6');
 const closed=f.context.closeWorkspaceDialog(dialog);await f.complete();assert.equal(await closed,true);assert.equal(dialog.open,false);
});

test('exit restores the original inert state and cancellation does not leave a form locked',async()=>{
 for(const original of [true,false]){
  const f=fixture(),dialog=f.document.createElement('dialog');f.document.body.append(dialog);dialog.inert=original;f.context.showWorkspaceDialog(dialog);const closing=f.context.closeWorkspaceDialog(dialog);assert.equal(dialog.inert,true);f.last().cancel();assert.equal(await closing,false);assert.equal(dialog.inert,original);assert.equal(dialog.open,true);
  const closed=f.context.closeWorkspaceDialog(dialog);await f.complete();assert.equal(await closed,true);assert.equal(dialog.inert,original);
 }
});

test('reduced motion retains gentle 150ms fades without translation or scale',async()=>{
 const f=fixture({reduced:true}),answer=f.context.askConfirm({title:'Save?'}),dialog=f.dialogs()[0];assert.equal(f.last().options.duration,150);assert.ok(f.last().frames.every(frame=>!('transform'in frame)));f.submit(dialog);assert.ok(f.last().frames.every(frame=>!('transform'in frame)));await f.complete();assert.equal(await answer,true);
});

test('phone sheets enter from and exit to the bottom edge',async()=>{
 const f=fixture({phone:true}),answer=f.context.askConfirm({title:'Save?'}),dialog=f.dialogs()[0];assert.equal(f.last().frames[0].transform,'translateY(100%)');assert.equal(f.last().options.duration,300);f.submit(dialog);assert.equal(f.last().frames.at(-1).transform,'translateY(100%)');await f.complete();assert.equal(await answer,true);
});

test('bound dismissal blocks working forms and confirms only dirty forms',async()=>{
 const f=fixture(),dialog=f.document.createElement('dialog');f.document.body.append(dialog);let busy=true,dirty=true;
 const dismiss=f.context.bindWorkspaceDialogDismiss(dialog,{isBusy:()=>busy,isDirty:()=>dirty});f.context.showWorkspaceDialog(dialog);
 assert.equal(await dismiss(),false);assert.equal(f.dialogs().length,1);busy=false;
 const waiting=dismiss();assert.equal(f.dialogs().length,2);f.dialogs()[1].fire('cancel');await f.complete();assert.equal(await waiting,false);assert.equal(dialog.open,true);
 dirty=false;const clean=dismiss();await f.complete();assert.equal(await clean,true);assert.equal(dialog.open,false);
});

test('a dirty form cannot close a replacement form or a newly busy form after approval',async()=>{
 for(const change of ['reopen','busy','actor']){
  const f=fixture(),dialog=f.document.createElement('dialog');f.document.body.append(dialog);let busy=false;
  const dismiss=f.context.bindWorkspaceDialogDismiss(dialog,{isBusy:()=>busy,isDirty:()=>true});f.context.showWorkspaceDialog(dialog);const closing=dismiss(),question=f.dialogs()[1];
  if(change==='reopen')f.context.showWorkspaceDialog(dialog);if(change==='busy')busy=true;if(change==='actor')f.context.me={user_id:'owner'};
  f.submit(question);if(change!=='actor')await f.complete();await tick();assert.equal(await closing,false);assert.equal(dialog.open,true);f.context.clearWorkspaceQuestions();
 }
});

test('rebinding dismissal uses the current form callbacks and installs one cancel handler',async()=>{
 const f=fixture(),dialog=f.document.createElement('dialog');f.document.body.append(dialog);
 f.context.bindWorkspaceDialogDismiss(dialog,{isBusy:()=>true});f.context.bindWorkspaceDialogDismiss(dialog);f.context.showWorkspaceDialog(dialog);
 assert.equal(dialog.events.cancel.length,1);dialog.fire('cancel');await f.complete();assert.equal(dialog.open,false);
});

 test('phone handle tracks a drag and a short drag returns without dismissing',async()=>{
 const f=fixture({phone:true}),dialog=f.document.createElement('dialog');f.document.body.append(dialog);let dismisses=0;f.context.bindWorkspaceDialogDrag(dialog,()=>dismisses++);f.context.showWorkspaceDialog(dialog);const handle=dialog.querySelector('.dialog-drag-handle');handle.fire('pointerdown',{pointerId:1,button:0,clientY:100});handle.fire('pointermove',{pointerId:1,clientY:120});assert.equal(dialog.style.transform,'translateY(20px)');handle.fire('pointerup',{pointerId:1});assert.equal(dismisses,0);assert.equal(f.last().frames[0].transform,'translateY(20px)');await f.complete();assert.equal(dialog.style.transform,undefined);assert.equal(dialog.open,true);
 });
 test('a long phone drag requests guarded dismissal; cancellation, busy and stale actor do not',async()=>{
 for(const mode of ['long','cancel','busy','actor','desktop']){const f=fixture({phone:mode!=='desktop'}),dialog=f.document.createElement('dialog');f.document.body.append(dialog);let dismisses=0,busy=false;f.context.bindWorkspaceDialogDrag(dialog,()=>dismisses++,()=>!busy);f.context.showWorkspaceDialog(dialog);const handle=dialog.querySelector('.dialog-drag-handle');if(mode==='busy')busy=true;handle.fire('pointerdown',{pointerId:1,button:0,clientY:100});handle.fire('pointermove',{pointerId:1,clientY:210});if(mode==='actor')f.context.me={user_id:'owner'};handle.fire(mode==='cancel'?'pointercancel':'pointerup',{pointerId:1});assert.equal(dismisses,mode==='long'?1:0,mode);assert.equal(dialog.style.transform,undefined,mode);}
 });
 test('reduced-motion drag uses opacity only and lost capture restores the sheet',async()=>{
 const f=fixture({phone:true,reduced:true}),dialog=f.document.createElement('dialog');f.document.body.append(dialog);let dismisses=0;f.context.bindWorkspaceDialogDrag(dialog,()=>dismisses++);f.context.showWorkspaceDialog(dialog);const handle=dialog.querySelector('.dialog-drag-handle');handle.fire('pointerdown',{pointerId:1,button:0,clientY:100});handle.fire('pointermove',{pointerId:1,clientY:160});assert.equal(dialog.style.transform,undefined);assert.equal(dialog.style.opacity,'0.7');handle.fire('lostpointercapture',{pointerId:1});assert.equal(dismisses,0);assert.equal(f.last().options.duration,150);assert.ok(f.last().frames.every(frame=>!('transform'in frame)));await f.complete();
 });

 test('side sheets enter from the right and leave by the same path, while phones retain the bottom sheet',async()=>{
 for(const phone of [false,true]){const f=fixture({phone}),dialog=f.document.createElement('dialog');f.document.body.append(dialog);f.context.showWorkspaceDialog(dialog,{placement:'side',size:'large'});assert.equal(f.last().frames[0].transform,phone?'translateY(100%)':'translateX(24px)');assert.equal(f.last().options.duration,300);const closing=f.context.closeWorkspaceDialog(dialog);assert.equal(f.last().frames.at(-1).transform,phone?'translateY(100%)':'translateX(24px)');assert.equal(f.last().options.duration,phone?150:200);await f.complete();assert.equal(await closing,true);}
 });

 test('a dialog opened from an account action returns focus to the visible account summary',async()=>{
 const f=fixture(),menu=f.document.createElement('details'),summary=f.document.createElement('summary'),button=f.document.createElement('button');menu.id='accountMenu';menu.append(summary,button);f.document.body.append(menu);menu.open=true;button.focus();const dialog=f.document.createElement('dialog');f.document.body.append(dialog);f.context.showWorkspaceDialog(dialog);menu.open=false;const closing=f.context.closeWorkspaceDialog(dialog);await f.complete();await closing;assert.equal(f.document.activeElement,summary);
 });
 test('regrabbing a sheet mid-animation tracks from the rendered offset without a jump',()=>{
 const f=fixture({phone:true}),dialog=f.document.createElement('dialog');f.document.body.append(dialog);let dismisses=0;f.context.bindWorkspaceDialogDrag(dialog,()=>dismisses++);f.context.showWorkspaceDialog(dialog);dialog.renderedTransform='matrix(1,0,0,1,0,20)';dialog.renderedOpacity='.8';const handle=dialog.querySelector('.dialog-drag-handle');handle.fire('pointerdown',{pointerId:1,button:0,clientY:100});assert.equal(dialog.style.transform,'translateY(20px)');assert.equal(dialog.style.opacity,'0.8');handle.fire('pointermove',{pointerId:1,clientY:105});assert.equal(dialog.style.transform,'translateY(25px)');assert.equal(dialog.style.opacity,'0.775');handle.fire('pointerup',{pointerId:1});assert.equal(dismisses,0);
 });

test('text correction cannot move Save or Cancel during blur; submit still validates',async()=>{
 for(const targetIndex of [0,1]){
  const f=fixture(),answer=f.context.askText({title:'Product name',label:'Name',value:'',validate:value=>value.trim()?'':'Enter a product name.'}),dialog=f.dialogs()[0],input=dialog.querySelector('input'),error=dialog.querySelector('[role="alert"]');input.fire('blur');input.value='Analyzer';input.fire('blur',{relatedTarget:dialog.querySelectorAll('button')[targetIndex]});assert.equal(error.textContent,'Enter a product name.');assert.equal(input.getAttribute('aria-invalid'),'true');f.submit(dialog);await f.complete();assert.equal(await answer,'Analyzer');
 }
});

function phoneSheetDrag(options={}){
 const f=fixture({phone:true}),dialog=f.document.createElement('dialog');
 f.document.body.append(dialog);f.context.bindWorkspaceDialogDismiss(dialog,options);f.context.showWorkspaceDialog(dialog);
 const handle=dialog.querySelector('.dialog-drag-handle');
 const pointer=(type,delta,time)=>handle.fire(type,{button:0,pointerId:1,clientY:100+delta,timeStamp:time});
 return {...f,dialog,pointer};
}

test('a short downward flick projects to dismissal and carries its released position and velocity into the spring',async()=>{
 const f=phoneSheetDrag();f.pointer('pointerdown',0,0);f.pointer('pointermove',24,35);f.pointer('pointerup',25,36);
 assert.equal(f.dialog.inert,true);const {frames,options}=f.last();
 assert.equal(frames[0].transform,'translateY(25px)');assert.ok(parseFloat(frames[1].transform.slice(11))>25);
 assert.equal(frames.at(-1).transform,'translateY(200px)');assert.equal(options.easing,'linear');
 await f.complete();assert.equal(f.dialog.open,false);assert.equal(f.document.activeElement,f.trigger);
});

test('a tiny flick, paused drag or last-moment reversal settles back to the open endpoint',async()=>{
 for(const [moves,release] of [
  [[[6,10]],[6,11]],
  [[[75,30]],[75,250]],
  [[[145,130],[110,164]],[109,165]]
 ]){
  const f=phoneSheetDrag();f.pointer('pointerdown',0,0);
  for(const [offset,time] of moves)f.pointer('pointermove',offset,time);
  f.pointer('pointerup',...release);
  assert.ok(!f.dialog.inert);assert.equal(f.last().frames.at(-1).transform,'translateY(0px)');
  if(release[0]===109)assert.ok(parseFloat(f.last().frames[1].transform.slice(11))<109);
  await f.complete();assert.equal(f.dialog.open,true);
 }
});

test('pulling above the upper edge increases resistance and a regrab resumes at the rendered negative offset',()=>{
 const f=phoneSheetDrag();f.pointer('pointerdown',0,0);f.pointer('pointermove',-50,80);
 assert.equal(f.dialog.style.transform,'translateY(-25px)');f.pointer('pointermove',-200,160);
 assert.equal(f.dialog.style.transform,'translateY(-40px)');f.pointer('pointercancel',-200,180);
 const returning=f.last();f.dialog.renderedTransform='matrix(1,0,0,1,0,-25)';
 f.pointer('pointerdown',0,200);f.pointer('pointermove',0,208);
 assert.equal(returning.cancelled,true);assert.equal(f.dialog.style.transform,'translateY(-25px)');
});

test('an outward flick on a dirty sheet keeps the editor open behind the discard question',async()=>{
 const f=phoneSheetDrag({isDirty:()=>true});
 f.pointer('pointerdown',0,0);f.pointer('pointermove',28,27);f.pointer('pointerup',29,28);
 assert.equal(f.dialog.open,true);assert.ok(!f.dialog.inert);
 const question=f.dialogs()[1];assert.equal(question.querySelector('h2').textContent,'Discard changes?');
 assert.equal(f.last().frames.at(-1).transform,'translateY(0px)');
 question.querySelector('button').onclick();await f.complete();
 assert.equal(f.dialogs().length,1);assert.equal(f.dialog.open,true);
});

test('a settling gesture runs to position and velocity tolerance with finite work',()=>{
 const f=fixture({phone:true}),dialog=f.document.createElement('dialog');
 const run=offset=>{f.context.workspaceSheetSpring(dialog,{height:600,offset,opacity:1,velocity:0},false);return f.last();};
 const small=run(12),large=run(480);
 assert.ok(small.options.duration<large.options.duration);
 for(const animation of [small,large]){
  const offsets=animation.frames.map(frame=>parseFloat(frame.transform.slice(11)));
  assert.ok(animation.options.duration<=1000);assert.ok(offsets.length<=251);
  assert.ok(Math.abs(offsets.at(-2))<.25);assert.ok(Math.abs(offsets.at(-2)-offsets.at(-3))/4<.006);
  assert.ok(offsets.every((v,i)=>i===0||v<=offsets[i-1]&&v>=0));
 }
});

test('regrabbing a clean gesture exit keeps the complete dialog inert through the return',async()=>{
 const f=phoneSheetDrag();f.pointer('pointerdown',0,0);f.pointer('pointermove',24,35);f.pointer('pointerup',25,36);
 const exit=f.last(),root=f.document.documentElement;
 root.fire('pointerdown',{pointerId:1,button:0,clientX:12,clientY:12,timeStamp:47});
 assert.ok(!exit.cancelled);
 f.dialog.renderedTransform='matrix(1,0,0,1,0,45)';
 root.fire('pointerdown',{pointerId:1,button:0,clientX:300,clientY:150,timeStamp:60});
 assert.equal(exit.cancelled,true);assert.equal(f.dialog.style.transform,'translateY(45px)');
 assert.equal(f.dialog.inert,true);f.pointer('pointermove',3,92);f.pointer('pointerup',2,94);
 assert.equal(f.dialog.inert,true);assert.equal(f.last().frames.at(-1).transform,'translateY(0px)');
 await f.complete();assert.equal(f.dialog.open,true);assert.equal(f.dialog.inert,false);assert.equal(root.events.pointerdown.length,0);
});

test('confirmation and explicitly accepted discard exits cannot be intercepted by a handle press',async()=>{
 const f=fixture({phone:true}),answer=f.context.askConfirm({title:'Confirm adjustment?',tone:'danger'}),dialog=f.dialogs()[0];
 f.submit(dialog);assert.equal(dialog.inert,true);assert.equal(f.document.documentElement.events.pointerdown?.length||0,0);
 await f.complete();assert.equal(await answer,true);
 const dirty=phoneSheetDrag({isDirty:()=>true});dirty.pointer('pointerdown',0,0);dirty.pointer('pointermove',28,26);dirty.pointer('pointerup',30,28);
 dirty.submit(dirty.dialogs()[1]);await dirty.complete();
 assert.equal(dirty.dialog.inert,true);assert.equal(dirty.document.documentElement.events.pointerdown?.length||0,0);
 await dirty.complete();assert.equal(dirty.dialog.open,false);
});

test('programmatic reopen interrupts a gesture exit and cleans up its temporary listener',async()=>{
 const f=phoneSheetDrag();f.pointer('pointerdown',0,0);f.pointer('pointermove',24,35);f.pointer('pointerup',25,36);
 f.dialog.renderedTransform='matrix(1,0,0,1,0,60)';
 f.context.showWorkspaceDialog(f.dialog);await f.complete();
 assert.equal(f.dialog.open,true);assert.equal(f.dialog.inert,false);assert.equal(f.document.documentElement.events.pointerdown.length,0);
 assert.equal(f.last().frames[0].transform,'matrix(1,0,0,1,0,60)');
});

test('a root-retargeted press cannot intercept a lower pane while another modal is open',async()=>{
 const f=phoneSheetDrag();f.pointer('pointerdown',0,0);f.pointer('pointermove',24,35);f.pointer('pointerup',25,36);
 const exit=f.last(),other=f.document.createElement('dialog');f.document.body.append(other);other.showModal();
 f.document.documentElement.fire('pointerdown',{pointerId:1,button:0,clientX:300,clientY:150,timeStamp:60});
 assert.ok(!exit.cancelled);await f.complete();assert.equal(f.dialog.open,false);assert.equal(other.open,true);
});
