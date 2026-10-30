import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {directoryFixture,plain,source} from './helpers/client-directory-fixture.mjs';
import {contactDom} from './helpers/contact-dom-fixture.mjs';
import {statusTone} from './helpers/status-ui.mjs';

const organization={id:'branch',name:'Asha Clinic',location:'Arusha',type:'Clinic',parent_id:null,approval_status:'review'};
const contact={id:'contact',organization_id:'branch',title:'Mr.',first_name:'Asha',last_name:'Mushi',position:'Lab',phone_country:'TZ',country_code:'+255',phone:'712345678',email:'',status:'kept',revision:1};
function crm(changes={}){
 const rows={organizations:[{...organization,...changes.organization}],contacts:[{...contact,...changes.contact}]},f=directoryFixture({rows});
 f.ctx.seed=plain(rows);f.run('organizations=seed.organizations;contacts=seed.contacts;scan();');return f;
}
function parsed(html){const document=contactDom();document.body.innerHTML=html;return document.body;}
function chip(root,tone,label){const node=root.querySelectorAll('.chip').find(node=>node.textContent===label);assert.ok(node,`Missing chip: ${label}`);assert.ok(node.getAttribute('class').split(/\s+/).includes('chip--'+tone),`${label}: ${tone}`);return node;}

test('contact revision and duplicate chips remain warnings while a complete reviewed contact is success',()=>{
 const f=crm(),original=JSON.stringify(f.rows.contacts[0]);let root=parsed(f.ctx.card(f.rows.contacts[0]));chip(root,'success','Complete');assert.equal(root.querySelector('[data-keep]'),null);
 const row={...contact,status:'review'};root=parsed(f.ctx.card(row));chip(root,'warning','Needs revision');assert.ok(root.querySelector('[data-keep]'));
 f.ctx.hit={reason:'Same <phone>',ids:['contact']};f.run("duplicates.set('contact',[hit])");root=parsed(f.ctx.card(f.rows.contacts[0]));chip(root,'warning','Needs revision');chip(root,'warning','Possible duplicate · Same <phone>');assert.equal(root.querySelector('phone'),null);assert.match(root.textContent,/Compare 1 matching record/);assert.equal(JSON.stringify(f.rows.contacts[0]),original);
});

test('review card keeps escaped reasons, client identity and edit permissions with its status label',()=>{
 const f=crm(),row={contact:{...contact,first_name:'<script>'},organization:{...organization,name:'<img>'},reasons:['Missing <name>']};
 for(const allowed of [true,false]){f.ctx.canEditRecords=()=>allowed;const root=parsed(f.ctx.contactReviewCard(row));chip(root,'warning','Needs revision');assert.equal(root.querySelector('script'),null);assert.equal(root.querySelector('img'),null);assert.equal(root.querySelector('name'),null);assert.equal(!!root.querySelector('[data-edit]'),allowed);assert.equal(!!root.querySelector('[data-delete-contact]'),allowed);assert.ok(root.querySelector('a'));}
});

test('approval chip reflects the recorded approval without weakening incomplete or unreviewed contact blockers',()=>{
 for(const [org,person,tone,label,disabled]of [
  [{},{},'warning','Needs approval',false],
  [{},{status:'review'},'warning','Needs approval',true],
  [{},{last_name:''},'warning','Needs approval',true],
  [{approval_status:'approved'},{},'success','Approved',true]
 ]){const f=crm({organization:org,contact:person}),before=JSON.stringify(f.rows);let root=parsed(f.ctx.profileApproval(f.rows.organizations[0]));chip(root,tone,label);assert.equal(root.querySelector('[data-approve-org]').disabled,disabled);f.ctx.canEditRecords=()=>false;root=parsed(f.ctx.profileApproval(f.rows.organizations[0]));chip(root,tone,label);assert.equal(root.querySelector('button'),null);assert.equal(JSON.stringify(f.rows),before);}
});

test('checklist does not equate implemented or verified with accepted and escapes an unknown status',async()=>{
 const f=crm(),states=['pending','implemented','verified','accepted','<unknown>'];
 f.ctx.fixtureClient.from=table=>{
  assert.equal(table,'feature_checklist');
  return {select:()=>({order:async()=>({data:states.map((status,n)=>({id:String(n),phase:'feature-1',status,title:'Item',notes:'',revision:1}))})})};
 };
 await f.ctx.checklist();const root=parsed(f.content.innerHTML);for(const [status,tone]of [['pending','neutral'],['implemented','info'],['verified','info'],['accepted','success'],['<unknown>','neutral']])chip(root,tone,status);assert.equal(root.querySelector('unknown'),null);assert.equal(root.querySelector('select'),null);
});

test('owner checklist keeps revision data inside its attribute',async()=>{
 const f=crm();f.actor.role='owner';
 const revision='1" autofocus onfocus="alert(1)" ><img src=x>';
 f.ctx.fixtureClient.from=()=>({select:()=>({order:async()=>({data:[{id:'one',phase:'feature-1',status:'pending',title:'Item',notes:'',revision}]})})});
 await f.ctx.checklist();const root=parsed(f.content.innerHTML),select=root.querySelector('[data-checklist]');
 assert.ok(select);assert.equal(root.querySelector('img'),null);assert.equal(select.getAttribute('autofocus'),null);assert.equal(select.getAttribute('onfocus'),null);
 assert.ok(f.content.innerHTML.includes('data-revision="1&quot; autofocus onfocus=&quot;alert(1)&quot; &gt;&lt;img src=x&gt;"'));
});

function inventory(){
 const c=vm.createContext({statusTone,me:{role:'owner'},products:[{id:'product',name:'Reviewed <product>',sku:'SKU',source:{}}],esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),rowById:(rows,id)=>rows.find(row=>row.id===id),reviewedCatalogProduct:row=>row});
 vm.runInContext(source('inventory-operations.js'),c);vm.runInContext("inventoryHeader=()=>'';inventoryLocations=[{id:'from',name:'From'},{id:'to',name:'To'}];inventoryPacks=[{id:'pack',base_unit:'bottle'}];inventoryLots=[{id:'lot',version:9}];inventorySection='transfers'",c);return c;
}
test('transfer summaries and details share status tones while preserving exact workflow controls and version attributes',()=>{
 const c=inventory();for(const [status,tone]of [['requested','warning'],['in_transit','info'],['received','success'],['quarantine','danger'],['cancelled','neutral'],['<unknown>','neutral']]){
  const row={id:'transfer',product_id:'product',source_lot_id:'lot',from_location_id:'from',to_location_id:'to',pack_definition_id:'pack',cartons:2,expected_units:20,expected_at:'2026-10-30',status,reason:'<reason>',version:7},before=JSON.stringify(row),detail=parsed(c.inventoryTransferCard(row));chip(detail,tone,status==='in_transit'?'in transit':status);
  assert.equal(!!detail.querySelector('[data-inventory-action="dispatch"]'),status==='requested');assert.equal(!!detail.querySelector('[data-inventory-action="receive"]'),status==='in_transit');if(detail.querySelector('form'))assert.equal(detail.querySelector('form').getAttribute('data-version'),'7');if(status==='requested')assert.equal(detail.querySelector('form').getAttribute('data-lot-version'),'9');if(status==='quarantine')assert.match(detail.textContent,/isolated and unavailable/);assert.equal(detail.querySelector('reason'),null);assert.equal(detail.querySelector('unknown'),null);
  c.page={rows:[{...row,product_name:'Reviewed <product>',from_name:'From',to_name:'To',base_unit:'bottle'}],page:0,pages:1,total:1,totals:{all:1,requested:1,in_transit:0,quarantine:0}};vm.runInContext('inventoryOperationsData=page',c);const summary=parsed(c.inventoryOperationsScreen());chip(summary,tone,status==='in_transit'?'in transit':status);assert.equal(summary.querySelector('[data-inventory-action]'),null);assert.ok(summary.querySelector('[data-inventory-transfer="transfer"]'));assert.equal(summary.querySelector('product'),null);assert.equal(JSON.stringify(row),before);
 }
});

test('location active and inactive chips retain storage labels and owner-only creation controls',()=>{
 const c=inventory(),rows=[{id:'active',name:'<name>',code:'A',active:true,is_dispatch_hub:true},{id:'inactive',name:'Old',code:'B',active:false,is_dispatch_hub:false}],before=JSON.stringify(rows);
 for(const role of ['owner','staff']){c.me={role};const root=parsed(c.inventoryLocationsScreen(rows));chip(root,'success','Active');chip(root,'neutral','Inactive');assert.match(root.textContent,/Dispatch hub; cartons can be opened here/);assert.match(root.textContent,/Godown; sealed-carton storage/);assert.equal(root.querySelector('name'),null);assert.equal(!!root.querySelector('[data-inventory-action="location"]'),role==='owner');}assert.equal(JSON.stringify(rows),before);
});
