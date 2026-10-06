'use strict';
// Who can use which part of the software. The owner has everything; a department head or staff member has the areas
// ticked on their staff record (migration 060). The database refuses reads and saves outside those areas, so hiding
// menu items here only keeps the screen tidy. A head manages the staff of their own department and can only give
// areas they have themselves.
const accessAreas=[
 ['leads','Leads','Record inquiries and follow them up'],
 ['proformas','Pro formas & current orders','Create, send and follow Pro formas'],
 ['deliveries','Deliveries','Packing and delivery progress'],
 ['service','Service jobs','Installations, service schedule and forms'],
 ['purchasing','Purchasing & suppliers','Purchase requests and the supplier list'],
 ['stock','Stock & availability','Stock levels, moving stock, godowns'],
 ['stock_count','Stock counts','Counting stock'],
 ['travel','Travel requests','Request and see trips'],
 ['reports','Reports','Work and activity reports']
];
// Starting ticks for a new account in each department; the head or owner changes them before saving.
const departmentAccess={
 sales:['leads','proformas','deliveries','stock','travel','reports'],
 accounts:['proformas','deliveries','purchasing','stock','travel','reports'],
 stores:['deliveries','purchasing','stock','stock_count','travel'],
 service:['service','deliveries','stock','travel','reports'],
 management:accessAreas.map(([key])=>key),
 '':['travel']
};
const departmentLabels=[['','Choose'],['sales','Sales'],['accounts','Accounts'],['stores','Stores & delivery'],['service','Service'],['management','Management']];
const roleLabels={owner:'Owner',head:'Department head',staff:'Staff'};
function departmentLabel(key){return departmentLabels.find(([k])=>k===key)?.[1]||'No department'}
function isHead(){return me?.role==='head'}
// area may be a list: any one of them is enough.
function hasArea(area,person=me){if(Array.isArray(area))return area.some(a=>hasArea(a,person));return !area||person?.role==='owner'||(person?.access||[]).includes(area)}
// Areas the signed-in person may hand out.
function grantableAreas(){return accessAreas.filter(([key])=>hasArea(key))}
function canManagePerson(row){
 if(!row||!me)return false;
 if(me.role==='owner')return true;
 return isHead()&&!!me.department&&row.role==='staff'&&row.department===me.department&&row.user_id!==me.user_id;
}
// Menu entry or open screen → area. null means everyone (or owner-only, handled elsewhere).
function viewArea(target,section){
 if(target==='leads')return 'leads';
 if(target==='sales')return section==='delivery'?'deliveries':'proformas';
 if(target==='purchasing')return 'purchasing';
 if(target==='service')return 'service';
 if(target==='inventory')return section==='catalog'||section==='review'?null:'stock';
 if(target==='stockcount')return section==='review'?null:'stock_count';
 if(target==='reports')return 'reports';
 if(target==='travel')return 'travel';
 if(target==='requests')return section==='complaints'?['leads','service']:'leads';
 return null;
}
function applyAccessNavigation(){
 document.querySelectorAll('#nav [data-view]').forEach(button=>{
  if(button.hasAttribute('data-owner-only')&&me?.role!=='owner')return;
  const area=viewArea(button.dataset.view,button.dataset.workspaceSection);
  if(area)button.hidden=!hasArea(area);
 });
}
function currentSection(){return view==='sales'?(salesEditing==='new'?'new':salesSection):view==='inventory'?inventorySection:view==='stockcount'&&typeof countTab!=='undefined'?countTab:view==='requests'&&typeof requestSection!=='undefined'?requestSection:null}
// Shown instead of a screen the person has no access to (for example a link from a task).
function accessBlocked(){
 const area=viewArea(view,currentSection());
 if(!area||hasArea(area))return false;
 const first=Array.isArray(area)?area[0]:area,label=accessAreas.find(([key])=>key===first)?.[1]||first;
 $('#content').innerHTML=`<section class="card"><h1>${esc(label)}</h1><p>You do not have access to this part yet. Ask your department head to tick <strong>${esc(label)}</strong> for you on the Staff page.</p></section>`;
 return true;
}
function accessSummary(row){
 if(row.role==='owner')return 'Everything';
 const names=accessAreas.filter(([key])=>(row.access||[]).includes(key)).map(([,label])=>label);
 return names.length?names.join(', '):'Nothing yet';
}
// Checkbox list. Only areas the signed-in person has can be ticked; others are shown greyed out with the reason.
function accessCheckboxes(selected){
 return `<fieldset class="access-areas"><legend>What this person can use</legend><p class="muted">Everyone always has My tasks, notes and reminders, calendar, client accounts, product search and How to use.</p>${accessAreas.map(([key,label,hint])=>{const allowed=hasArea(key);return `<label class="access-area${allowed?'':' muted'}"><input type="checkbox" name="access" value="${key}" ${selected.includes(key)?'checked':''} ${allowed?'':'disabled'}> <span><strong>${esc(label)}</strong> · ${esc(hint)}${allowed?'':' · only someone who has it can give it'}</span></label>`}).join('')}</fieldset>`;
}
function checkedAreas(form){return [...form.querySelectorAll('[name="access"]:checked')].map(input=>input.value).filter(key=>hasArea(key))}
function startingAccess(department){return (departmentAccess[department]||departmentAccess['']).filter(key=>hasArea(key))}
function openStaffAccess(row,onSaved){
 if(!canManagePerson(row)||row.role==='owner')throw Error('You can only change access for people in your own department.');
 const name=employeeName(row.user_id);
 actionForm(`Access for ${name}`,accessCheckboxes(row.access||[]),async()=>{
  const actor=me?.user_id,areas=checkedAreas(actionEditorForm);
  const result=await client.rpc('set_staff_access',{p_user_id:row.user_id,p_access:areas});
  if(me?.user_id!==actor)throw Error('Login changed. Nothing else was saved.');
  if(result.error)throw Error(result.error.message);
  await onSaved?.();message(`Access saved for ${name}.`);
 });
}
async function setStaffActive(row,active,onSaved){
 const name=employeeName(row.user_id);
 if(!active&&!confirm(`Switch off the login for ${name}? They will not be able to sign in until it is switched on again. Their records stay.`))return;
 const result=await client.rpc('set_staff_active',{p_user_id:row.user_id,p_active:active});
 if(result.error)throw Error(result.error.message);
 await onSaved?.();message(`${name}: login switched ${active?'on':'off'}.`);
}
async function setStaffRole(row,role,onSaved){
 const name=employeeName(row.user_id);
 const result=await client.rpc('manage_staff',{p_user_id:row.user_id,p_role:role,p_active:row.active});
 if(result.error)throw Error(result.error.message);
 await onSaved?.();message(`${name} is now ${roleLabels[role]}.`);
}
// Staff page for a department head: the whole staff list (read only for other departments) and tools for their own.
async function headStaffPage(){
 const actor=me.user_id,dept=departmentLabel(me.department);
 $('#content').innerHTML=`<h1>Staff</h1><section class="card"><h2>${esc(dept)} team</h2>${me.department?`<div class="actions"><button type="button" id="addEmployee" class="primary-action">+ Add employee</button></div><p class="muted">Add people to ${esc(dept)}, choose what each person can use, reset a forgotten password, and switch a login off when someone leaves. You can only give access you have yourself.</p>`:'<p role="alert">Ask the owner to set your department first. Then you can add your team here.</p>'}<div id="staffList"><p role="status">Loading staff…</p></div></section>`;
 $('#addEmployee')?.addEventListener('click',()=>run(async()=>openStaffOnboarding()));
 const r=await client.from('staff').select('user_id,role,active,phone,department,access');
 if(me?.user_id!==actor||view!=='staff')return;
 if(r.error){$('#staffList').innerHTML=`<p role="alert">Staff could not load: ${esc(r.error.message)}</p>`;return;}
 const mine=r.data.filter(row=>row.department===me.department),others=r.data.filter(row=>row.department!==me.department);
 $('#staffList').innerHTML=staffListHtml(mine)+(others.length?`<details><summary>Other departments · ${others.length}</summary>${staffListHtml(others)}</details>`:'');
 bindStaffList(r.data);
 if(typeof decorateStaffTwoStep==='function')decorateStaffTwoStep().catch(()=>{});
}
