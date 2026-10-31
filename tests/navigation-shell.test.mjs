import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mainPageFixture} from './helpers/main-page-budget-fixture.mjs';
import {parseCss} from '../scripts/audit-design-tokens.mjs';
const flush=()=>new Promise(setImmediate),deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(width=390,reduced=false,storedGroups=null){
 const f=mainPageFixture(),motions=[],calls=[];f.ctx.actor=f.actor;f.evaluate("me=actor;view='sales';salesSection='proformas';sessionLoadEpoch=1");
 const nav=f.document.querySelector('#nav'),originalNodes=nav.querySelectorAll('[data-view]');nav.hidden=false;
 f.ctx.matchMedia=query=>({matches:query.includes('max-width')?width<=Number(query.match(/max-width:([\d.]+)/)[1]):reduced});
 f.ctx.getComputedStyle=()=>({opacity:'1',transform:'none',getPropertyValue:key=>({'--m-base':'200ms','--m-menu':'120ms','--m-fast':'100ms','--m-fade':'150ms','--ease-out':'ease-out'}[key])});
 const proto=Object.getPrototypeOf(nav);proto.animate=function(frames,options){const pending=deferred(),motion={node:this,frames,options,pending,cancelled:false,finished:pending.promise,cancel(){this.cancelled=true;pending.reject(Error('cancelled'));}};motions.push(motion);return motion;};
 const popover=f.ctx.setWorkspacePopover;f.ctx.setWorkspacePopover=(panel,open,options)=>{calls.push({panel,open,options});return popover(panel,open,options);};
 if(storedGroups)f.ctx.localStorage.setItem('erp-nav-open',JSON.stringify(storedGroups));
 f.ctx.navDropdownSetup();
 const bar=f.document.querySelector('#workspaceShortcuts'),panel=f.document.querySelector('#workspaceMenuPanel'),more=f.document.querySelector('#workspaceMenuToggle');
 const original=(view,section='')=>nav.querySelectorAll('[data-view]').find(button=>button.dataset.view===view&&(button.dataset.workspaceSection||'')===section);
 const click=button=>{const event={target:button,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};return {event,promise:button.onclick(event)};};
 return {...f,nav,bar,panel,more,originalNodes,original,click,motions,calls,resize:value=>{width=value;f.ctx.navShellResize();}};
}
test('phone shortcuts use five permitted original destinations and never duplicate routing attributes',async()=>{
 const f=fixture(),shortcuts=f.bar.querySelectorAll('button').filter(button=>button!==f.more),originals=[f.original('personal','task'),f.original('contacts'),f.original('inventory','catalog'),f.original('sales','proformas'),f.original('service','installations')];
 assert.equal(shortcuts.length,5);assert.deepEqual(f.nav.querySelectorAll('[data-view]'),f.originalNodes);assert.equal(f.bar.querySelectorAll('[data-view]').length,0);
 const routed=[];f.ctx.navigateWorkspace=button=>routed.push(button);
 for(let index=0;index<5;index++){assert.ok(shortcuts[index].getAttribute('aria-label').includes(shortcuts[index].querySelector('.nav-label').textContent));assert.ok(shortcuts[index].getAttribute('aria-label').includes(originals[index].textContent));const pressed=f.click(shortcuts[index]);assert.equal(pressed.event.prevented,true);assert.equal(pressed.event.stopped,true);await pressed.promise;assert.equal(routed.at(-1),originals[index]);}
 assert.equal(f.original('books','invoices').hidden,true);assert.equal(f.original('staff').hidden,true);
 originals[3].hidden=true;const stale=shortcuts[3];f.ctx.navDropdownSync();assert.equal(stale.isConnected,false);await f.click(stale).promise;assert.equal(routed.length,5);
});
test('permission changes hide empty groups, refill shortcuts and keep same surviving nodes',()=>{
 const f=fixture(),first=f.bar.firstElementChild,accounts=f.nav.querySelector('.nav-accounts');assert.equal(accounts.hidden,true);
 f.original('books','invoices').hidden=false;f.ctx.navDropdownSync();assert.equal(accounts.hidden,false);assert.equal(f.bar.firstElementChild,first);
 const service=f.original('service','installations');service.hidden=true;f.ctx.navDropdownSync();assert.equal(f.bar.querySelectorAll('button').length,6);assert.equal(f.bar.firstElementChild,first);
 f.nav.hidden=true;f.ctx.navDropdownSync();assert.equal(f.bar.hidden,true);assert.equal(f.panel.hidden,true);assert.equal(f.more.getAttribute('aria-expanded'),'false');
 f.nav.hidden=false;f.ctx.navDropdownSync();assert.equal(f.bar.hidden,false);assert.equal(f.panel.hidden,true,'phone menu remains closed after signing in');
});
test('More reuses shared motion, preserves original visibility and Escape restores its trigger',async()=>{
 const f=fixture();f.more.focus();const opening=f.click(f.more).promise;assert.equal(f.more.getAttribute('aria-expanded'),'true');assert.equal(f.nav.hidden,false);assert.equal(f.panel.hidden,false);assert.equal(f.motions.at(-1).options.duration,120);
 f.motions.at(-1).pending.resolve();await opening;assert.equal(f.document.activeElement,f.original('dashboard'));
 const event={key:'Escape',preventDefault(){this.prevented=true;},stopPropagation(){}};f.nav.events.keydown[0].fn(event);assert.equal(event.prevented,true);assert.equal(f.panel.inert,true);assert.equal(f.motions.at(-1).options.duration,100);
 f.motions.at(-1).pending.resolve();await flush();assert.equal(f.panel.hidden,true);assert.equal(f.document.activeElement,f.more);assert.equal(f.nav.hidden,false);
});
test('menu animation completion does not steal focus moved by the user',async()=>{
 const f=fixture(),outside=f.document.createElement('input');f.document.body.append(outside);f.more.focus();const opening=f.ctx.navMobileSet(true);outside.focus();f.motions.at(-1).pending.resolve();await opening;assert.equal(f.document.activeElement,outside);
 f.original('contacts').focus();const closing=f.ctx.navMobileSet(false,true);outside.focus();f.motions.at(-1).pending.resolve();await closing;assert.equal(f.document.activeElement,outside);
});
test('interrupted More animation and sign-out cannot apply an old completion or focus',async()=>{
 const f=fixture(),first=f.ctx.navMobileSet(true),firstMotion=f.motions.at(-1),second=f.ctx.navMobileSet(false),secondMotion=f.motions.at(-1),third=f.ctx.navMobileSet(true),last=f.motions.at(-1);
 assert.equal(firstMotion.cancelled,true);assert.equal(secondMotion.cancelled,true);last.pending.resolve();await Promise.all([first,second,third]);assert.equal(f.panel.hidden,false);assert.equal(f.more.getAttribute('aria-expanded'),'true');
 const closing=f.ctx.navMobileSet(false,true);f.nav.hidden=true;f.ctx.navDropdownSync();await closing;assert.equal(f.panel.hidden,true);assert.equal(f.bar.hidden,true);assert.notEqual(f.document.activeElement,f.more);
});
test('resize uses a rail below1200, restores original controls and preserves group preferences',async()=>{
 const f=fixture(1200),sales=f.nav.querySelector('.nav-sales'),toggle=sales.querySelector('.nav-group-toggle');assert.equal(f.nav.dataset.shellMode,'wide');assert.equal(f.panel.hidden,false);
 toggle.onclick();const saved=f.ctx.localStorage.getItem('erp-nav-open');assert.match(saved,/Sales/);
 f.original('contacts').focus();f.resize(600);assert.equal(f.nav.dataset.shellMode,'phone');assert.equal(f.panel.hidden,true);assert.equal(f.document.activeElement,f.more);
 f.resize(601);assert.equal(f.nav.dataset.shellMode,'rail');assert.equal(f.panel.hidden,false);assert.equal(f.document.activeElement,f.original('dashboard'));assert.equal(f.ctx.localStorage.getItem('erp-nav-open'),saved);
 f.resize(1199.5);assert.equal(f.nav.dataset.shellMode,'rail');f.resize(1200);assert.equal(f.nav.dataset.shellMode,'wide');assert.equal(f.panel.hidden,false);
 f.nav.hidden=true;f.ctx.navDropdownSync();assert.equal(f.panel.hidden,true);f.nav.hidden=false;f.ctx.navDropdownSync();assert.equal(f.panel.hidden,false,'desktop original menu returns after sign-in');await flush();
});
test('shortcut keyboard movement respects disabled controls and retains native buttons',()=>{
 const f=fixture(),buttons=f.bar.querySelectorAll('button'),handle=f.bar.events.keydown[0].fn;buttons[1].disabled=true;
 const key=(target,value)=>{const event={target,key:value,preventDefault(){this.prevented=true;}};handle(event);return event;};
 assert.equal(key(buttons[0],'ArrowRight').prevented,true);assert.equal(f.document.activeElement,buttons[2]);key(buttons[2],'End');assert.equal(f.document.activeElement,f.more);key(f.more,'ArrowRight');assert.equal(f.document.activeElement,buttons[0]);key(buttons[2],'Home');assert.equal(f.document.activeElement,buttons[0]);
 assert.equal(key(buttons[0],'Enter').prevented,undefined);for(const button of buttons)assert.equal(button.type,'button');
});
test('shortcut navigation retains the existing busy queue and commits through one original',async()=>{
 const f=fixture(),renders=[],held=deferred();f.ctx.render=async()=>renders.push(f.evaluate('view'));const work=f.ctx.run(()=>held.promise),shortcut=f.bar.querySelectorAll('button')[4];
 await f.click(shortcut).promise;assert.equal(f.evaluate('navWhileBusy.button'),f.original('service','installations'));assert.deepEqual(renders,[]);held.resolve();await work;await flush();assert.deepEqual(renders,['service']);assert.equal(f.ctx.location.hash,'#/go/service/installations');
});
test('compact header help retains its original contextual handler and accessible name',()=>{
 const f=fixture(),help=f.document.createElement('button');help.id='howToUse';help.textContent='How to use';const handler=()=>{};help.onclick=handler;f.document.querySelector('#identity').append(help);
 f.ctx.navDropdownSync();assert.equal(help.onclick,handler);assert.equal(help.getAttribute('aria-label'),'How to use');assert.equal(help.title,'How to use');assert.equal(help.querySelector('.nav-icon').getAttribute('aria-hidden'),'true');const label=help.querySelector('.nav-label');f.ctx.navDropdownSync();assert.equal(help.querySelector('.nav-label'),label);
});
test('shell styles keep flexible compact headers, the brand rail, phone safe area and hidden originals',()=>{
 const css=readFileSync(new URL('../workspace-navigation.css',import.meta.url),'utf8'),polish=readFileSync(new URL('../ui-polish.css',import.meta.url),'utf8');
 assert.match(css,/min-height:var\(--header-height\)/);assert.match(css,/min-height:var\(--header-phone-height\)/);assert.match(css,/max-width:1199\.99px/);assert.match(css,/max-width:600px/);assert.match(css,/\.active::before\{[^}]*width:3px[^}]*background:var\(--brand\)/);
 assert.match(css,/grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,calc\(var\(--control-h\) \+ var\(--space-2\)\)\),1fr\)\)/);assert.match(css,/env\(safe-area-inset-bottom\)/);assert.match(css,/#workspaceMenuPanel #nav:not\(\[hidden\]\)/);assert.match(css,/workspace-shortcut-height/);
 assert.doesNotMatch(polish,/#nav\[data-mobile-open="false"\]/);assert.doesNotMatch(polish,/min-height:4\.75rem/);assert.match(polish,/#identity>#howToUse>\.nav-label\{[^}]*clip-path:inset\(50%\)/);
 // Match the legacy :last-child rule's specificity; normal 44px controls fit the 52px minimum without forced extra height.
 assert.match(css,/grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,calc\(var\(--control-h\) \+ var\(--space-2\)\)\),1fr\)\);gap:var\(--space-2\)/);assert.match(css,/body>header \.brand>span:last-child\{display:none\}/);assert.match(polish,/body>header\{min-height:52px;[^}]*padding:0 var\(--space-2\)/);
 // Resolve only this exact selector's equal-specificity padding cascade in authored stylesheet order.
 const index=readFileSync(new URL('../index.src.html',import.meta.url),'utf8'),paths=[...index.matchAll(/<link rel="stylesheet" href="([^"?]+)/g)].map(match=>match[1]);
 const padding=paths.flatMap(path=>parseCss(readFileSync(new URL('../'+path,import.meta.url),'utf8')).declarations).filter(row=>row.selector==='body:has(#nav:not([hidden]))>main'&&['padding','padding-bottom'].includes(row.property));
 for(const width of [360,600]){
  let sides,bottom;
  for(const rule of padding){if(rule.media.some(media=>/print/.test(media)||[...media.matchAll(/(max|min)-width:([\d.]+)px/g)].some(([,kind,bound])=>kind==='max'?width>Number(bound):width<Number(bound))))continue;
   if(rule.property==='padding-bottom'){bottom=rule.value;continue;}
   const parts=[];let value='',depth=0;for(const char of rule.value){if(char==='(')depth++;if(char===')')depth--;if(char===' '&&!depth){if(value)parts.push(value);value='';}else value+=char;}if(value)parts.push(value);
   sides=parts[1]||parts[0];bottom=parts[2]||parts[0];
  }
  assert.equal(sides,'var(--space-4)',width+'px keeps 16px side gutters');assert.equal(bottom,'calc(var(--workspace-shortcut-height,var(--shortcut-height)) + var(--space-5))',width+'px reserves the measured shortcut height');
 }
});

test('Escape closes More when keyboard focus is on the bottom bar',async()=>{
 const f=fixture();const open=f.ctx.navMobileSet(true);f.motions.at(-1).pending.resolve();await open;f.more.focus();
 const event={target:f.more,key:'Escape',preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};
 const close=f.bar.events.keydown[0].fn(event);assert.equal(event.prevented,true);assert.equal(event.stopped,true);assert.equal(f.more.getAttribute('aria-expanded'),'false');
 f.motions.at(-1).pending.resolve();await close;assert.equal(f.panel.hidden,true);assert.equal(f.document.activeElement,f.more);
});

test('role groups preserve all43 original destinations and permission attributes',()=>{
 const f=fixture(1200),groups=f.nav.querySelectorAll('.nav-group'),expected={
  Workspace:['dashboard','personal:task','reports','personal:note','personal:event','travel'],
  Sales:['contacts','leads:leads','requests:inquiries','requests:complaints','sales:proformas','contracts','prices'],
  Stores:['inventory:catalog','sales:delivery','packing:queue','packing:screen','pending','purchasing:orders','purchasing:suppliers','inventory:stock','inventory:transfers','inventory:locations','stockcount:count','stockcount:review','inventory:review'],
  Service:['service:installations','service:schedule','service:forms'],
  Accounts:['accounting','books:overview','books:invoices','books:receipts','books:journal','books:accounts','books:reports','books:import','books:opening'],
  Admin:['guide','staff','settings','recycle','approvals']
 };
 assert.deepEqual(groups.map(group=>group.getAttribute('aria-label')),Object.keys(expected));assert.equal(f.originalNodes.length,43);assert.deepEqual(f.nav.querySelectorAll('[data-view]'),f.originalNodes);
 const key=node=>node.dataset.view+(node.dataset.workspaceSection?':'+node.dataset.workspaceSection:'');
 for(const group of groups){const name=group.getAttribute('aria-label'),panel=group.querySelector('.nav-group-items'),toggle=group.querySelector('.nav-group-toggle');assert.deepEqual(panel.querySelectorAll('[data-view]').map(key),expected[name]);assert.equal(toggle.getAttribute('aria-controls'),panel.id);assert.equal(toggle.getAttribute('aria-label'),name);assert.equal(panel.hidden,name!=='Workspace');}
 assert.deepEqual(f.originalNodes.filter(node=>node.hasAttribute('data-owner-only')).map(key).sort(),['staff','approvals','recycle','stockcount:review','inventory:review'].sort());
 assert.deepEqual(f.originalNodes.filter(node=>node.hasAttribute('data-accounting-only')).map(key),expected.Accounts);assert.equal(f.original('staff').id,'staffNav');
});
test('group disclosure keeps original controls and moves focus out before its200ms close',async()=>{
 const f=fixture(1200),group=f.nav.querySelector('.nav-sales'),toggle=group.querySelector('.nav-group-toggle'),panel=group.querySelector('.nav-group-items'),original=f.original('contacts');
 const opening=f.click(toggle).promise;assert.equal(panel.hidden,false);assert.equal(panel.inert,false);assert.equal(toggle.getAttribute('aria-expanded'),'true');assert.equal(f.motions.at(-1).options.duration,200);assert.match(f.motions.at(-1).frames[0].transform,/translateY/);assert.equal(f.motions.at(-1).frames[0].opacity,0);f.motions.at(-1).pending.resolve();await opening;
 original.focus();const closing=f.click(toggle).promise;assert.equal(panel.hidden,false);assert.equal(panel.inert,true);assert.equal(f.document.activeElement,toggle);assert.equal(toggle.getAttribute('aria-expanded'),'false');assert.equal(f.motions.at(-1).options.duration,200);f.motions.at(-1).pending.resolve();await closing;assert.equal(panel.hidden,true);assert.equal(panel.inert,true);assert.equal(f.original('contacts'),original);assert.equal(original.hidden,false);
});
test('group open-close-open reverses from rendered opacity and translation; stale exit cannot hide it',async()=>{
 const f=fixture(1200),group=f.nav.querySelector('.nav-sales'),toggle=group.querySelector('.nav-group-toggle'),panel=group.querySelector('.nav-group-items'),first=f.click(toggle).promise,firstMotion=f.motions.at(-1),style=f.ctx.getComputedStyle;
 f.ctx.getComputedStyle=node=>({...style(node),opacity:'.4',transform:'matrix(1, 0, 0, 1, 0, -3)'});
 const second=f.click(toggle).promise,exit=f.motions.at(-1),third=f.click(toggle).promise,last=f.motions.at(-1);
 assert.equal(firstMotion.cancelled,true);assert.equal(exit.cancelled,true);assert.equal(last.frames[0].opacity,'.4');assert.equal(last.frames[0].transform,'matrix(1, 0, 0, 1, 0, -3)');assert.equal(panel.inert,false);last.pending.resolve();assert.deepEqual(await Promise.all([first,second,third]),[false,false,true]);assert.equal(panel.hidden,false);assert.equal(toggle.getAttribute('aria-expanded'),'true');assert.equal(group.classList.contains('collapsed'),false);
});
test('reduced group motion keeps150ms fades without sliding',async()=>{
 const f=fixture(390,true),toggle=f.nav.querySelector('.nav-sales .nav-group-toggle');
 for(let step=0;step<2;step++){const pending=f.click(toggle).promise,motion=f.motions.at(-1);assert.equal(motion.options.duration,150);assert.ok(motion.frames.every(frame=>!Object.hasOwn(frame,'transform')));motion.pending.resolve();await pending;}
});
test('new visible current pages autoexpand their group without restarting motion on unrelated sync',async()=>{
 const f=fixture(),group=f.nav.querySelector('.nav-stores'),panel=group.querySelector('.nav-group-items'),product=f.original('inventory','catalog');product.classList.add('active');product.setAttribute('aria-current','page');f.ctx.navDropdownSync();const opening=f.motions.at(-1);assert.equal(panel.hidden,false);assert.equal(group.querySelector('.nav-group-toggle').getAttribute('aria-expanded'),'true');
 const count=f.motions.length;f.ctx.navDropdownSync();assert.equal(f.motions.length,count);opening.pending.resolve();await flush();
 // A deliberate collapse of the current group must remain reversible, not reopen on its own class mutation.
 const close=f.click(group.querySelector('.nav-group-toggle')).promise;f.ctx.navDropdownSync();assert.equal(f.motions.length,count+1);f.motions.at(-1).pending.resolve();await close;assert.equal(panel.hidden,true);
 product.classList.remove('active');f.original('packing','queue').classList.add('active');f.ctx.navDropdownSync();assert.equal(panel.hidden,false);f.motions.at(-1).pending.resolve();await flush();
});
test('permission changes during opening cancel old motion and keep hidden groups and items unreachable',async()=>{
 const f=fixture(),group=f.nav.querySelector('.nav-accounts'),panel=group.querySelector('.nav-group-items'),invoice=f.original('books','invoices');invoice.hidden=false;invoice.removeAttribute('hidden');invoice.classList.add('active');f.ctx.navDropdownSync();const opening=f.motions.at(-1);assert.equal(group.hidden,false);assert.equal(panel.inert,false);
 invoice.hidden=true;invoice.setAttribute('hidden','');f.ctx.navDropdownSync();assert.equal(opening.cancelled,true);assert.equal(group.hidden,true);assert.equal(panel.hidden,true);assert.equal(panel.inert,true);await flush();assert.ok(group.querySelectorAll('[data-view]').every(button=>button.hidden));
 invoice.hidden=false;invoice.removeAttribute('hidden');f.ctx.navDropdownSync();assert.equal(group.hidden,false);assert.equal(panel.hidden,false);assert.equal(panel.inert,false);f.motions.at(-1).pending.resolve();await flush();
});
test('group motion never restores focus after the user moves elsewhere',async()=>{
 const f=fixture(),group=f.nav.querySelector('.nav-sales'),toggle=group.querySelector('.nav-group-toggle'),outside=f.document.createElement('input');f.document.body.append(outside);const open=f.click(toggle).promise;f.motions.at(-1).pending.resolve();await open;f.original('contacts').focus();const close=f.click(toggle).promise;assert.equal(f.document.activeElement,toggle);outside.focus();f.motions.at(-1).pending.resolve();await close;assert.equal(f.document.activeElement,outside);
});

test('renamed saved group preferences reopen only when the original permission gate allows them',async()=>{
 const f=fixture(1200,false,['Orders','Inventory','System','Accounts']);for(const name of ['sales','stores','admin'])assert.equal(f.nav.querySelector('.nav-'+name+' .nav-group-items').hidden,false);
 const group=f.nav.querySelector('.nav-accounts'),panel=group.querySelector('.nav-group-items');assert.equal(group.hidden,true);assert.equal(panel.hidden,true);const invoice=f.original('books','invoices');invoice.hidden=false;invoice.removeAttribute('hidden');f.ctx.navDropdownSync();assert.equal(panel.hidden,false);f.motions.at(-1).pending.resolve();await flush();
 const pending=f.click(f.nav.querySelector('.nav-sales .nav-group-toggle')).promise;f.motions.at(-1).pending.resolve();await pending;assert.deepEqual(JSON.parse(f.ctx.localStorage.getItem('erp-nav-open')).sort(),['Accounts','Admin','Stores']);
});

test('steady hidden permission groups do not rewrite observed hidden attributes on every sync',()=>{
 const f=fixture(),panel=f.nav.querySelector('.nav-accounts .nav-group-items');let hidden=panel.hidden,writes=0;Object.defineProperty(panel,'hidden',{get:()=>hidden,set:value=>{hidden=value;writes++;}});f.ctx.navDropdownSync();f.ctx.navDropdownSync();assert.equal(writes,0);assert.equal(panel.hidden,true);assert.equal(panel.inert,true);
});

test('opening More focuses the visible toggle of a deliberately collapsed active group',async()=>{
 const f=fixture(),group=f.nav.querySelector('.nav-sales'),toggle=group.querySelector('.nav-group-toggle'),original=f.original('sales','proformas');original.classList.add('active');original.setAttribute('aria-current','page');f.ctx.navDropdownSync();f.motions.at(-1).pending.resolve();await flush();const collapse=f.click(toggle).promise;f.motions.at(-1).pending.resolve();await collapse;
 f.more.focus();const open=f.ctx.navMobileSet(true);f.motions.at(-1).pending.resolve();await open;assert.equal(f.document.activeElement,toggle);assert.equal(group.querySelector('.nav-group-items').hidden,true);assert.equal(original.getAttribute('aria-current'),'page');
});
test('resizing restores the shortcut destination when expanded, or its visible group toggle when collapsed',async()=>{
 for(const expanded of [true,false]){
  const f=fixture(),group=f.nav.querySelector('.nav-sales'),toggle=group.querySelector('.nav-group-toggle'),original=f.original('sales','proformas'),shortcut=f.bar.querySelectorAll('button')[3];
  if(expanded){const open=f.click(toggle).promise;f.motions.at(-1).pending.resolve();await open;}
  shortcut.focus();f.resize(601);assert.equal(f.document.activeElement,expanded?original:toggle);assert.equal(f.nav.dataset.shellMode,'rail');
 }
});
test('focus resolution skips disconnected, disabled and permission-hidden destinations and groups',()=>{
 const f=fixture(1200),original=f.original('sales','proformas'),group=original.closest('.nav-group'),toggle=group.querySelector('.nav-group-toggle');assert.equal(f.ctx.navFocusDestination(original),toggle);
 group.hidden=true;assert.equal(f.ctx.navFocusDestination(original),null);group.hidden=false;original.hidden=true;assert.equal(f.ctx.navFocusDestination(original),null);original.hidden=false;toggle.disabled=true;assert.equal(f.ctx.navFocusDestination(original),null);toggle.disabled=false;original.disabled=true;assert.equal(f.ctx.navFocusDestination(original),null);original.disabled=false;f.nav.hidden=true;assert.equal(f.ctx.navFocusDestination(original),null);f.nav.hidden=false;original.remove();assert.equal(f.ctx.navFocusDestination(original),null);
});

// These assertions resolve authored dimensions, not native layout or text metrics.
test('phone icon geometry stays fixed while relative shortcut tracks accommodate doubled text',()=>{
 const polish=parseCss(readFileSync(new URL('../ui-polish.css',import.meta.url),'utf8')).declarations,nav=parseCss(readFileSync(new URL('../workspace-navigation.css',import.meta.url),'utf8')).declarations,tokens=new Map(parseCss(readFileSync(new URL('../tokens.css',import.meta.url),'utf8')).declarations.filter(row=>row.selector===':root').map(row=>[row.property,row.value]));
 const mobile=rows=>rows.filter(row=>row.media.some(media=>media.includes('max-width:600px'))),values=(rows,selector)=>new Map(mobile(rows).filter(row=>row.selector===selector).map(row=>[row.property,row.value]));
 const header=values(polish,'body>header'),identity=values(polish,'#identity'),brand=values(polish,'body>header .brand-logo'),controls=values(polish,'#identity>#workspaceSearch,#identity>#howToUse,#identity>.bell>.bell-button,#identity .account-menu>summary');
 assert.equal(header.get('min-height'),'52px');assert.equal(header.get('flex-wrap'),'nowrap');assert.equal(header.get('padding'),'0 var(--space-2)');assert.equal(identity.get('flex-wrap'),'nowrap');
 for(const property of ['width','min-width','height','min-height'])assert.equal(controls.get(property),'44px');assert.equal(controls.get('padding'),'0');
 const icons=values(polish,'#identity>#workspaceSearch>.workspace-search-icon,#identity>#howToUse>.nav-icon,#identity>.bell>.bell-button>svg'),accountIcon=values(polish,'#identity .account-menu .identity-icon'),barIcon=values(nav,'#workspaceShortcuts .nav-icon');
 for(const icon of [icons,accountIcon,barIcon])for(const property of ['width','height'])assert.equal(icon.get(property),'20px');
 assert.equal(brand.get('width'),'88px');assert.equal(brand.get('max-width'),'24vw');
 const bar=values(nav,'#workspaceShortcuts:not([hidden])'),button=values(nav,'#workspaceShortcuts>button'),label=values(nav,'#workspaceShortcuts .nav-label');
 assert.equal(bar.get('grid-template-columns'),'repeat(auto-fit,minmax(min(100%,calc(var(--control-h) + var(--space-2))),1fr))');assert.equal(bar.get('gap'),'var(--space-2)');assert.equal(button.get('font-size'),'var(--t-caption)');assert.equal(button.get('min-width'),'44px');assert.equal(button.get('min-height'),'52px');assert.equal(button.get('padding'),'0');assert.equal(button.get('overflow-wrap'),'normal');assert.equal(label.get('overflow-wrap'),'normal');assert.equal(label.get('word-break'),'normal');
 const rem=(name,rootSize)=>{assert.match(tokens.get(name),/^[.\d]+rem$/);return parseFloat(tokens.get(name))*rootSize;};
 for(const [rootSize,columns] of [[16,6],[32,3]]){
  const width=360,gap=rem('--space-2',rootSize),track=rem('--control-h',rootSize)+gap,barPadding=2*rem('--space-1',rootSize),available=width-barPadding;
  assert.equal(Math.min(6,Math.floor((available+gap)/(track+gap))),columns,rootSize+'px root preserves all six shortcuts in usable rows');assert.ok(track>=44);assert.ok(gap>=8);
  const headerPadding=2*gap,brandWidth=Math.min(88,width*.24),headerContents=brandWidth+4*44+4*gap;assert.ok(headerContents<=width-headerPadding,rootSize+'px root keeps the four icon controls in one header row');
 }
});
