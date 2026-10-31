'use strict';

let serviceSection='installations',serviceLoaded=false,serviceLoadError='',serviceCases=[],serviceAssets=[],serviceEvents=[],serviceReports=[],serviceAccessories=[],serviceAttendees=[],serviceTeam=[];
let serviceEpoch=0,serviceHandoffsLoading=null,serviceHistoryErrors=new Map(),serviceSavedReads=new Map();
let serviceActor=null,servicePageRequest=0,servicePage=0,servicePageKey='',servicePageData=null,serviceSelectedId='',serviceFocusId='',serviceIntakeOpen=false;
function clearServiceWorkflow(){servicePageRequest++;serviceActor=null;servicePage=0;servicePageKey='';servicePageData=null;serviceSelectedId='';serviceFocusId='';serviceIntakeOpen=false;serviceEpoch++;serviceLoaded=false;serviceLoadError='';serviceCases=[];serviceAssets=[];serviceEvents=[];serviceReports=[];serviceAccessories=[];serviceAttendees=[];serviceTeam=[];serviceHandoffsLoading=null;serviceHistoryErrors.clear();serviceSavedReads.clear();}
const serviceTabs=[['installations','Installations'],['schedule','Service schedule'],['forms','Official forms']];
function syncServiceActor(){if(serviceActor!==me){clearServiceWorkflow();serviceActor=me;}}
function serviceCase(id){return serviceCases.find(row=>row.id===id)||servicePageData?.rows.find(row=>row.id===id)}
function serviceAsset(id){return serviceAssets.find(row=>row.id===id)||{model:'',serial_number:'',installation_location:''}}
function serviceReport(caseId){return serviceReports.find(row=>row.case_id===caseId)}
function serviceTeamLabel(id){return id?employeeName(id):'Not assigned'}
// Only people who can open Service jobs can be given one; anyone else could not see the job they were given.
function serviceTeamOptions(selected=''){return serviceTeam.filter(row=>row.active&&(row.role==='owner'||Array.isArray(row.access)&&row.access.includes('service'))).map(row=>inventoryOption(row.user_id,serviceTeamLabel(row.user_id),row.user_id===selected)).join('')}
function serviceDate(offset=0){return companyDate(offset)}
function serviceMoney(minor,currency){const digits=(currency||'TZS')==='TZS'?0:2;return new Intl.NumberFormat('en-TZ',{style:'currency',currency:currency||'TZS',minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(minor||0)/100)}
async function loadServiceWorkflow(){
 syncServiceActor();servicePageKey='';
 const epoch=++serviceEpoch,actor=me;serviceLoadError='';
 try{
  const rows=await Promise.all(['equipment_assets','service_cases','service_case_events','service_reports','service_report_accessories','service_training_attendees'].map(table=>all(table,'*')));
  const team=await client.from('staff').select('user_id,role,active,access').order('role');
  if(epoch!==serviceEpoch||me!==actor)return false;if(team.error)throw team.error;
  [serviceAssets,serviceCases,serviceEvents,serviceReports,serviceAccessories,serviceAttendees]=rows;serviceTeam=team.data||[];serviceHistoryErrors.clear();serviceSavedReads.clear();serviceLoaded=true;return true;
 }catch(error){if(epoch!==serviceEpoch||me!==actor)return false;serviceLoaded=false;serviceLoadError=error.message||'Service data could not load.';return false;}
}
function serviceHeader(){return workspacePageHeader({title:({installations:'Machines to install',schedule:'Service & maintenance schedule',forms:'Service forms'})[serviceSection]||'Service',subtitle:serviceSection==='installations'?'Plan engineers and work dates for installation jobs.':'',back:serviceFocusId&&serviceSection!=='forms'?'<button id="serviceAllJobs" type="button">Back to all jobs</button>':'',actions:'<button id="serviceRefresh" type="button">Refresh list</button>'})}
function serviceUnavailable(){return `${serviceHeader()}<section class="card"><h2>Service could not load</h2><p role="alert">${esc(serviceLoadError)}</p><p>Check your connection and access, then refresh. Contact your administrator if this continues.</p></section>`}
function serviceProgressRail(record){return `<ol class="service-progress" aria-label="${esc(record.case_type)} progress">${serviceProgress(record.status).map((step,index)=>`<li class="${step.state}" ${step.state==='current'?'aria-current="step"':''}><span>${step.state==='complete'?'✓':index+1}</span><small>${esc(step.label)}</small></li>`).join('')}</ol>`}
function serviceHistory(record){const rows=serviceEvents.filter(row=>row.case_id===record.id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));return `<details class="workflow-history"><summary>Who handled this job and when</summary>${serviceHistoryErrors.has(record.id)?`<p role="alert">The job was saved, but recent history could not load. Refresh the list. ${esc(serviceHistoryErrors.get(record.id))}</p>`:''}${rows.map(row=>`<div><strong>${esc(serviceStatusLabel(row.to_status))}</strong><small>${esc(employeeName(row.actor_user_id))} · ${esc(new Date(row.created_at).toLocaleString('en-TZ'))} · ${esc(row.note)}</small></div>`).join('')}</details>`}
function serviceCaseActions(record){
 const recovery=serviceSavedReads.get(record.id);if(recovery)return `<button class="primary-action" data-service-retry-saved="${esc(record.id)}" ${recovery.loading?'disabled':''}>${recovery.loading?'Loading saved job…':'Retry saved job'}</button>`;
 if(record.reused_case_id)return `<button class="primary-action" data-service-reused="${esc(record.reused_case_id)}">Open existing installation</button>`;
 const buttons=serviceNextActions(record.status,record).map((action,index)=>`<button${index===0?' class="primary-action"':''} data-service-action="${action}" data-id="${record.id}">${({assign:'Assign engineer',reassign:'Change engineer',schedule:record.status==='scheduled'?'Change work date':'Set work date',start:'Start on-site work',submit_report:'Work finished · complete report'})[action]}</button>`);
 if(record.status==='report_required'&&record.delivery_ready!==false)buttons.push(`<button class="primary-action" data-service-report="${record.id}">Complete official report</button>`);
 if(['new','assigned','scheduled'].includes(record.status))buttons.push(`<button class="danger" data-service-action="cancel" data-id="${record.id}">Cancel job</button>`);
 if(serviceReport(record.id))buttons.push(`<button data-print-service="${record.id}">Print official report</button>`);
 return buttons.join('');
}
function serviceNextStep(record){
 const recovery=serviceSavedReads.get(record.id);if(recovery)return recovery.loading?'The job was saved. Loading its current details and list counts…':'The job was saved, but its details or list could not reload. Use Retry saved job before continuing.';
 if(record.reused_case_id)return 'Continue in the existing installation. This duplicate planned job is closed.';
 if(record.status==='cancelled')return 'This job is cancelled.';
 if(record.status==='completed')return 'Work is complete. The signed report is available below.';
 if(!record.assigned_user_id)return 'Assign an engineer. The coordinator handoff does not assign the engineer.';
 if(!record.scheduled_for)return 'Confirm the engineer’s work date.';
 if(record.delivery_ready===false)return 'Await signed delivery before starting on-site work or completing a report. The engineer and work date can be planned now.';
 return ({scheduled:'Start on-site work when the engineer reaches the machine.',on_site:'Finish the work and complete the official report.',report_required:'Complete the official report and record both signatures.'})[record.status]||'Review the engineer and work date.';
}
function serviceAgeDays(record,today=serviceDate()){
 const created=new Date(record.created_at);if(Number.isNaN(created.getTime()))return null;
 return Math.max(0,Math.floor((Date.parse(today)-Date.parse(companyDate(0,created)))/86400000));
}
function serviceCaseCard(record){
 const asset=serviceAsset(record.asset_id),organization=orgIndex.get(record.site_organization_id||record.organization_id)||{name:'Client unavailable',location:''},product=inventoryProduct(record.product_id),report=serviceReport(record.id),age=serviceAgeDays(record);
 return `<article class="card service-case ${record.status==='report_required'?'attention':''}" data-service-card="${record.id}"><div class="heading"><div><small>${record.case_type==='installation'?'INSTALLATION':'SERVICE'} · ${esc(record.case_number)}</small><h2>${esc(product.name)}</h2><p>${esc(organization.name)} · ${esc(record.site_location||asset.installation_location||organization.location||'Location to be confirmed')}</p>${record.site_organization_id&&record.site_organization_id!==record.organization_id?`<p>Customer: ${esc(orgIndex.get(record.organization_id)?.name||'Client unavailable')}</p>`:''}<p class="muted">${esc(serviceSourceLabel(record.intake_source,record))}${record.project_name?' · '+esc(record.project_name):''}${record.planned_unit_number?' · Machine unit '+esc(record.planned_unit_number):''}</p></div><span class="tag chip chip--${statusTone(record.status)}">${esc(serviceStatusLabel(record.status))}</span></div>
 <p><strong>Next step:</strong> ${esc(serviceNextStep(record))}${serviceNeedsPlanning(record)&&age!==null?` <span class="muted">Waiting ${age} ${age===1?'day':'days'} since this job was created.</span>`:''}</p><div class="actions no-print">${serviceCaseActions(record)}</div>
 ${serviceProgressRail(record)}<div class="service-facts"><div><small>Serial number</small><strong>${esc(asset.serial_number||(record.delivery_ready===false?'Awaiting signed delivery':'Record on report'))}</strong></div><div><small>Assigned engineer</small><strong>${esc(serviceTeamLabel(record.assigned_user_id))}</strong></div><div><small>Work date</small><strong>${esc(record.scheduled_for||'Not scheduled')}</strong></div><div><small>${record.case_type==='service'?'Request':'Source'}</small><strong>${esc(record.problem_summary||serviceSourceLabel(record.intake_source,record))}</strong></div></div>${report?`<div class="notice"><strong>Completed ${esc(report.actual_work_date)}</strong> · Next maintenance ${esc(report.next_maintenance_date)} · ${esc(serviceMoney(report.service_charge_minor,report.currency))}</div>`:''}${serviceHistory(record)}</article>`;
}
function serviceMetricValues(rows){
 const today=serviceDate(),soon=serviceDate(30),planning=rows.filter(serviceNeedsPlanning),unassigned=planning.filter(row=>!row.assigned_user_id),unscheduled=planning.filter(row=>!row.scheduled_for);
 const oldest=items=>{const ages=items.map(row=>serviceAgeDays(row,today)).filter(age=>age!==null);return ages.length?ages.reduce((oldest,age)=>Math.max(oldest,age),0):null;};
 return {awaiting_engineer:unassigned.length,awaiting_date:unscheduled.length,oldest_engineer_days:oldest(unassigned),oldest_date_days:oldest(unscheduled),due_30:rows.filter(row=>row.status==='scheduled'&&row.scheduled_for>=today&&row.scheduled_for<=soon).length,overdue:rows.filter(row=>row.status==='scheduled'&&row.scheduled_for<today).length};
}
function serviceMetrics(rows){
 const values=Array.isArray(rows)?serviceMetricValues(rows):rows,oldest=days=>days===null?'':`<small>Oldest: ${esc(days)} days</small>`;
 return `<div class="inventory-metrics service-metrics"><div><small>Awaiting engineer</small><strong>${values.awaiting_engineer}</strong>${oldest(values.oldest_engineer_days)}</div><div><small>Awaiting work date</small><strong>${values.awaiting_date}</strong>${oldest(values.oldest_date_days)}</div><div><small>Due in 30 days</small><strong>${values.due_30}</strong></div><div><small>Overdue work date</small><strong>${values.overdue}</strong></div></div>`;
}
function serviceSummaryCard(record){
 const display=record.display;
 // Keep handoff history lazy until the job is opened.
 return `<article class="card service-case" data-service-card="${esc(record.id)}"><div class="heading" data-work-handoff><div><small>${esc(record.case_number)}</small><h2>${esc(display.product_name)}</h2><p>${esc(display.customer_name||display.organization_name)}</p></div><span class="tag chip chip--${statusTone(record.status)}">${esc(serviceStatusLabel(record.status))}</span></div><p class="muted">Work date: ${esc(record.scheduled_for||'Not scheduled')}</p><div class="actions"><button class="primary-action" data-service-open="${esc(record.id)}">Open job</button></div></article>`;
}
function servicePageControls(data){return `<div class="heading"><div><h2>${serviceSection==='schedule'?'Service schedule':'Installation jobs'}</h2>${serviceSection==='schedule'?'<p class="muted">Jobs awaiting an engineer or date appear first, oldest first. Open a job for its complete history and actions.</p>':''}</div><span>${data.total} jobs</span></div>${data.total||serviceSection==='schedule'?`<div class="actions"><button data-service-page="${data.page-1}" ${data.page===0?'disabled':''}>Previous</button><span>Page ${data.page+1} of ${data.pages}</span><button data-service-page="${data.page+1}" ${data.page+1>=data.pages?'disabled':''}>Next</button></div>`:''}`;}
function servicePageScreen(caseType){
 const data=servicePageData,selected=serviceSelectedId&&serviceCases.find(row=>row.id===serviceSelectedId&&row.case_type===caseType);
 return `${serviceHeader()}${caseType==='installation'?'<details><summary>How this page works</summary><p>Jobs awaiting an engineer or work date appear first, oldest first. Open a job for its history and actions. Engineer and date planning can begin before delivery; on-site work and reports require signed delivery.</p></details>':''}<section id="servicePageMetrics">${serviceMetrics(data.metrics)}</section><section id="serviceIntake">${serviceIntakeOpen&&serviceLoaded?serviceIntakeForm(caseType):`<button id="serviceOpenIntake" type="button"${caseType==='installation'?' class="primary-action"':''}>${caseType==='installation'?'Record an installation request':'Record a repair or service request'}</button>`}</section><section id="servicePageControls">${servicePageControls(data)}</section><div id="servicePageReadError" role="status"></div><section id="servicePageRows">${data.rows.map(row=>selected?.id===row.id?serviceCaseCard(selected):serviceSummaryCard(row)).join('')||(caseType==='installation'?'<div class="empty">Installation requests will appear here.</div>':'<div class="empty">No jobs found.</div>')}${selected&&!data.rows.some(row=>row.id===selected.id)?serviceCaseCard(selected):''}</section>`;
}
function serviceOrganizationOptions(selected=''){return organizations.filter(row=>!row.deleted_at).map(row=>inventoryOption(row.id,row.name,row.id===selected)).join('')}
function serviceAssetOptions(){return serviceAssets.filter(asset=>asset.status!=='retired').map(asset=>{const organization=orgIndex.get(asset.organization_id),product=inventoryProduct(asset.product_id);return inventoryOption(asset.id,`${product.name} · ${asset.serial_number||'Serial unknown'} · ${organization?.name||'Client'}`)}).join('')}
function serviceContactOptions(organizationId){return contacts.filter(row=>row.organization_id===organizationId&&!row.deleted_at&&row.status!=='incorrect').map(row=>inventoryOption(row.id,salesContactName(row.id))).join('')}
function serviceIntakeForm(caseType){return `<details class="card"${serviceIntakeOpen?' open':''}><summary>${caseType==='installation'?'Record an installation request':'Record a repair or service request'}</summary><p>No previous sale is required. Choose an existing machine when it is already recorded. Record the real serial, or mark it unknown until the engineer identifies it.</p><form id="newServiceCase" data-case-type="${caseType}"><p data-service-intake-errors class="error" role="alert"></p><p class="muted">Complete the required fields before creating the job.</p><div class="grid"><label class="wide"><span>Machine record · optional</span><select name="assetId"><option value="">Equipment not yet recorded</option>${serviceAssetOptions()}</select></label><label><span>Customer · required</span><select name="organizationId" required><option value="">Choose customer</option>${serviceOrganizationOptions()}</select></label><label><span>Destination site · if different from customer</span><select name="siteOrganizationId"><option value="">Same as customer</option>${serviceOrganizationOptions()}</select></label><label><span>Site contact · optional</span><select name="contactId" disabled><option value="">Choose a customer first</option></select></label><label><span>Equipment source · required</span><select name="source" required><option value="">Choose source</option><option value="third_party">Bought from another supplier</option><option value="legacy">Older equipment / historical sale</option><option value="distributor">Distributor supplied · installation later</option><option value="customer_request">Customer request</option></select></label><label><span>Equipment product · required</span><select name="productId" required><option value="">Choose equipment</option>${products.filter(row=>!row.deleted_at).map(row=>inventoryOption(row.id,row.name)).join('')}</select></label><label><span>Equipment model · required</span><input name="model" required maxlength="200"></label><label><span>Serial number · required unless unknown</span><input name="serial" required maxlength="200"></label><label><span><input name="serialUnknown" type="checkbox"> Serial number is not yet known</span></label><label class="wide"><span>Machine site / location · required</span><input name="location" required minlength="2" maxlength="300"></label><label><span>Project · optional</span><input name="projectName" maxlength="200"></label><label class="wide"><span>Reported problem or requested work · required</span><textarea name="problem" required minlength="2" maxlength="4000"></textarea></label></div><button type="submit">Create ${caseType==='installation'?'installation':'service'} job</button></form></details>`}
function installationScreen(){return servicePageScreen('installation')}
function serviceScheduleScreen(){return servicePageScreen('service')}
function serviceFormsScreen(){return `${serviceHeader()}<div class="official-document-grid"><article class="card"><small>OFFICIAL · REV 2</small><h2>Equipment handover and installation report</h2><p>Fill in the machine details, accessories, who was trained and both signatures.</p><a class="button" href="official-documents/equipment-handover-installation-report.pdf" target="_blank" rel="noopener">Open blank official PDF</a></article><article class="card"><small>OFFICIAL · REV 2</small><h2>Service work report</h2><p>Fill in the fault, the work done, parts, charges and both signatures.</p><a class="button" href="official-documents/service-work-report.pdf" target="_blank" rel="noopener">Open blank official PDF</a></article></div><p class="notice">Completed records have a <strong>Print official report</strong> button in their job card. The printout is exactly what was signed.</p>`}
function parseServiceRows(text,fields,max){const rows=String(text||'').split(/\r?\n/).map(row=>row.trim()).filter(Boolean);if(rows.length>max)throw Error(`Enter no more than ${max} rows. All your input has been kept.`);return rows.map(row=>{const values=row.split('|').map(value=>value.trim()),result={};fields.forEach((field,index)=>result[field]=values[index]||'');return result})}
function openServiceAction(record,action){if(record.delivery_ready===false&&['start','submit_report'].includes(action))throw Error('Record signed delivery before starting on-site work or completing a report.');const actor=me,epoch=serviceEpoch,section=serviceSection,current=()=>me===actor&&serviceEpoch===epoch&&view==='service'&&serviceSection===section;const assign=action==='assign'||action==='reassign',schedule=action==='schedule',canAssignSelf=assign&&serviceTeam.some(row=>row.user_id===actor.user_id&&row.active&&(row.role==='owner'||Array.isArray(row.access)&&row.access.includes('service')));const fields=`<p><strong>${esc(record.case_number)}</strong> · ${esc(inventoryProduct(record.product_id).name)}</p>${assign?`<label><span>Engineer</span><select name="assignee" required><option value="">Choose active employee</option>${serviceTeamOptions(record.assigned_user_id)}</select></label>${canAssignSelf?'<button type="button" data-service-assign-me>Assign engineer to me</button>':''}`:''}${schedule?`<label><span>Confirmed work date</span><input name="scheduledFor" type="date" min="${serviceDate()}" value="${record.scheduled_for||serviceDate()}" required></label>`:''}<label><span>Progress note</span><textarea name="note" required minlength="2" maxlength="2000"></textarea></label>`;const form=actionForm(({assign:'Assign engineer',reassign:'Change engineer',schedule:record.status==='scheduled'?'Change work date':'Set work date',start:'Start on-site work',submit_report:'Move to report required',cancel:'Cancel job'})[action],fields,async values=>{if(!current())throw Error('The workspace changed. Reopen this service job.');const result=await client.rpc('advance_service_case',{p_id:record.id,p_expected_version:record.version,p_action:action,p_assigned_user_id:values.assignee||null,p_scheduled_for:values.scheduledFor||null,p_note:values.note});if(!current())return;if(result.error)throw result.error;const saved=Array.isArray(result.data)?result.data[0]:result.data;if(!saved||saved.id!==record.id||!Number.isSafeInteger(saved.version)||saved.version<=record.version||!Object.hasOwn(serviceStatusLabels,saved.status)||!saved.updated_at)throw Error('The saved service job could not be confirmed. Refresh the list before continuing.');if(!serviceLoaded){serviceSavedReads.set(saved.id,{record:saved,report:false,statusOnly:true,page:servicePageData,loading:false,error:''});await retryServiceSavedCase(saved.id);return;}const updated=await updateServiceCase(saved,current);if(!updated)return;message('Service job updated: '+serviceStatusLabel(saved.status)+'.'+(updated.historyError?' Recent history could not load; refresh the list.':''),!!updated.historyError)});if(canAssignSelf)form.querySelector('[data-service-assign-me]').onclick=()=>{if(!current())return;form.elements.namedItem('assignee').value=actor.user_id;form.elements.namedItem('note').focus()};return form}
function reportFields(record){const asset=serviceAsset(record.asset_id),organization=orgIndex.get(record.site_organization_id||record.organization_id)||{},contact=contacts.find(row=>row.id===record.contact_id),today=serviceDate();return `<p>${esc(record.case_number)} · ${esc(organization.name||'Client')} · ${esc(inventoryProduct(record.product_id).name)}</p><div class="grid"><label><span>Actual work date</span><input name="actualWorkDate" type="date" max="${today}" value="${today}" required></label><label><span>Actual engineer</span><select name="engineerId" required><option value="">Choose engineer</option>${serviceTeamOptions(record.assigned_user_id)}</select></label><label><span>Engineer full name</span><input name="engineerName" value="${esc(record.assigned_user_id?serviceTeamLabel(record.assigned_user_id):'')}" required maxlength="200"></label><label><span>Project · optional</span><input name="projectName" value="${esc(record.project_name||'')}" maxlength="200"></label><label><span>Equipment model</span><input name="model" value="${esc(asset.model||'')}" required maxlength="200"></label><label><span>Serial number</span><input name="serial" value="${esc(asset.serial_number||'')}" ${asset.serial_number?'readonly':''} required maxlength="200"></label><label class="wide"><span>Installation / machine location</span><input name="location" value="${esc(record.site_location||asset.installation_location||organization.location||'')}" required maxlength="300"></label><label class="wide"><span>Subject / request category</span><input name="subject" value="${esc(record.case_type==='installation'?'Equipment installation and handover':'Service work')}" maxlength="300"></label><label class="wide"><span>Work completed</span><textarea name="workCompleted" required maxlength="8000"></textarea></label><label class="wide"><span>Parts used · optional</span><textarea name="partsUsed" maxlength="4000"></textarea></label><label class="wide"><span>Accessories · maximum 100 rows: description | serial number</span><textarea name="accessories" placeholder="Accessory name | serial number"></textarea></label>${record.case_type==='installation'?`<label><span>Training completed</span><select name="training" required><option value="yes">Yes</option><option value="no">No</option></select></label><label><span>QC training</span><select name="qcTraining" required><option value="completed">Completed</option><option value="not_applicable">Not applicable</option></select></label><label class="wide"><span>Training attendees · maximum 10 rows: name | telephone | designation</span><textarea name="attendees" required placeholder="Full name | 0712 345 678 | Nurse"></textarea></label>`:''}<label><span>Engineer signing date</span><input name="engineerSignedDate" type="date" value="${today}" required></label><label><span>Customer representative</span><input name="customerRepresentative" value="${esc(contact?[contact.first_name,contact.last_name].filter(Boolean).join(' '):'')}" required maxlength="200"></label><label><span>Customer signing date</span><input name="customerSignedDate" type="date" value="${today}" required></label><label><span>Customer signed-document reference</span><input name="customerReference" required maxlength="500"></label><label><span>Anudha representative</span><input name="anudhaRepresentative" required maxlength="200"></label><label><span>Anudha signing date</span><input name="anudhaSignedDate" type="date" value="${today}" required></label><label class="wide"><span>Anudha signed-document reference</span><input name="anudhaReference" required maxlength="500"></label><label><span>Machine collected?</span><select name="machineCollected"><option value="no">No</option><option value="yes">Yes</option></select></label><label><span>Collection representative · if collected</span><input name="collectionRepresentative" maxlength="200"></label><label><span>Collection signing date · if collected</span><input name="collectionSignedDate" type="date"></label><label><span>Collection reference · if collected</span><input name="collectionReference" maxlength="500"></label><label><span>Currency</span><select name="currency"><option>TZS</option><option>USD</option><option>EUR</option></select></label><label><span>Service charge</span><input name="serviceCharge" type="number" min="0" step="0.01" value="0" required></label><label class="wide"><span>Charge / invoice reference · optional</span><input name="chargeReference" maxlength="300"></label><label><span>Service every</span><select name="interval" required><option value="3">3 months</option><option value="6">6 months</option><option value="12">12 months</option><option value="24">24 months</option><option value="36">36 months</option></select></label></div>`}
function openServiceReport(record){if(record.delivery_ready===false)throw Error('Record signed delivery before completing the official report.');const actor=me,epoch=serviceEpoch,section=serviceSection,pageRequest=servicePageRequest,target=$('#content'),current=()=>me===actor&&serviceEpoch===epoch&&servicePageRequest===pageRequest&&view==='service'&&serviceSection===section&&target.isConnected&&$('#content')===target;actionForm(record.case_type==='installation'?'Complete installation report':'Complete service report',reportFields(record),async values=>{if(!current())throw Error('The workspace changed. Reopen this report.');const attendees=parseServiceRows(values.attendees,['full_name','telephone','designation'],10),accessories=parseServiceRows(values.accessories,['description','serial_number'],100),charge=Number(values.serviceCharge);if(record.case_type==='installation'&&values.training!=='yes')throw Error('Confirm that installation training was completed.');if(record.case_type==='installation'&&attendees.some(row=>!row.full_name||!row.telephone||!row.designation))throw Error('Every attendee needs a name, telephone and designation separated by |.');if(values.machineCollected==='yes'&&(!values.collectionRepresentative||!values.collectionSignedDate||!values.collectionReference))throw Error('Complete all machine collection fields.');if(!Number.isFinite(charge)||charge<0)throw Error('Enter a valid service charge.');const result=await client.rpc('complete_service_report',{p_case_id:record.id,p_expected_version:record.version,p_actual_work_date:values.actualWorkDate,p_equipment_model:values.model,p_serial_number:values.serial,p_installation_location:values.location,p_project_name:values.projectName||'',p_subject:values.subject||'',p_work_completed:values.workCompleted,p_parts_used:values.partsUsed||'',p_actual_engineer_id:values.engineerId,p_actual_engineer_name:values.engineerName,p_engineer_signed_date:values.engineerSignedDate,p_customer_representative:values.customerRepresentative,p_customer_signed_date:values.customerSignedDate,p_customer_signoff_reference:values.customerReference,p_anudha_representative:values.anudhaRepresentative,p_anudha_signed_date:values.anudhaSignedDate,p_anudha_signoff_reference:values.anudhaReference,p_training_completed:record.case_type==='installation',p_qc_training_status:record.case_type==='installation'?values.qcTraining:null,p_machine_collected:values.machineCollected==='yes',p_collection_representative:values.collectionRepresentative||null,p_collection_signed_date:values.collectionSignedDate||null,p_collection_reference:values.collectionReference||null,p_currency:values.currency,p_service_charge_minor:Math.round(charge*100),p_charge_reference:values.chargeReference||'',p_maintenance_interval_months:Number(values.interval),p_accessories:accessories,p_attendees:attendees});if(!current())return;if(result.error)throw result.error;const saved=Array.isArray(result.data)?result.data[0]:result.data;if(!serviceSavedCaseValid(saved,record.id)||saved.version!==record.version+1||saved.status!=='completed')throw Error('The saved report could not be confirmed. Refresh this job before continuing.');await serviceAfterSavedCase(saved,true,current)})}
function servicePrintReport(record){const report=serviceReport(record.id);if(!report)return '';const accessories=serviceAccessories.filter(row=>row.report_id===report.id),attendees=serviceAttendees.filter(row=>row.report_id===report.id);return `<section class="service-report-print"><header><img src="assets/anudha-logo.svg" alt="Anudha Limited"><div><strong>ANUDHA LIMITED</strong><small>Medical and laboratory equipment</small><small>${typeof companyFormContact!=='undefined'?companyFormContact.phone+' · '+companyFormContact.service:''}</small></div><b>${record.case_type==='installation'?'EQUIPMENT HANDOVER & INSTALLATION REPORT':'SERVICE WORK REPORT'}<small>Rev 2</small></b></header><div class="print-grid"><p><small>Job number</small><strong>${esc(record.case_number)}</strong></p><p><small>Work date</small><strong>${esc(report.actual_work_date)}</strong></p><p><small>Customer / site</small><strong>${esc(report.customer_name)}</strong></p><p><small>Location</small><strong>${esc(report.installation_location)}</strong></p><p><small>Contact</small><strong>${esc(report.contact_name)} · ${esc(report.contact_phone)}</strong></p><p><small>Project</small><strong>${esc(report.project_name||'—')}</strong></p><p><small>Equipment</small><strong>${esc(report.equipment_name)}</strong></p><p><small>Model / serial</small><strong>${esc(report.equipment_model)} · ${esc(report.serial_number)}</strong></p></div><h3>${record.case_type==='installation'?'Handover work':'Request and work performed'}</h3><p><strong>${esc(report.subject||record.problem_summary||'')}</strong></p><p class="print-narrative">${esc(report.work_completed)}</p><p><strong>Parts used:</strong> ${esc(report.parts_used||'None recorded')}</p>${accessories.length?`<table><thead><tr><th>Accessory</th><th>Serial number</th></tr></thead><tbody>${accessories.map(row=>`<tr><td>${esc(row.description)}</td><td>${esc(row.serial_number||'—')}</td></tr>`).join('')}</tbody></table>`:''}${record.case_type==='installation'?`<h3>Training attendees · QC training ${esc(report.qc_training_status.replaceAll('_',' '))}</h3><table><thead><tr><th>Name</th><th>Telephone</th><th>Designation</th></tr></thead><tbody>${attendees.map(row=>`<tr><td>${esc(row.full_name)}</td><td>${esc(row.telephone)}</td><td>${esc(row.designation)}</td></tr>`).join('')}</tbody></table>`:''}<div class="print-signatures"><p><small>Engineer</small><strong>${esc(report.actual_engineer_name)}</strong><br>${esc(report.engineer_signed_date)}</p><p><small>Customer representative</small><strong>${esc(report.customer_representative)}</strong><br>${esc(report.customer_signed_date)} · ${esc(report.customer_signoff_reference)}</p><p><small>Anudha representative</small><strong>${esc(report.anudha_representative)}</strong><br>${esc(report.anudha_signed_date)} · ${esc(report.anudha_signoff_reference)}</p></div>${record.case_type==='service'?`<div class="print-grid"><p><small>Service charge</small><strong>${esc(serviceMoney(report.service_charge_minor,report.currency))}</strong><br>${esc(report.charge_reference)}</p><p><small>Machine collected</small><strong>${report.machine_collected?'Yes · '+esc(report.collection_representative):'No'}</strong>${report.machine_collected?`<br>${esc(report.collection_signed_date)} · ${esc(report.collection_reference)}`:''}</p></div>`:''}<p><strong>Next maintenance:</strong> ${esc(report.next_maintenance_date)} · every ${report.maintenance_interval_months} months</p></section>`}
function printServiceReport(id){const record=serviceCase(id),card=document.querySelector(`[data-service-card="${CSS.escape(id)}"]`);if(!record||!card)return;card.insertAdjacentHTML('beforeend',servicePrintReport(record));card.classList.add('print-service-record');try{window.print()}finally{card.classList.remove('print-service-record');card.querySelector('.service-report-print')?.remove()}}
async function updateServiceCase(record,current){
 // The case update and its audit event share the transaction's server timestamp.
 let history;try{history=await client.from('service_case_events').select('*').eq('case_id',record.id).eq('created_at',record.updated_at).order('id').limit(1);}catch(error){history={error};}
 if(!current())return;
 // Let an initial handoff decoration finish before refreshing this card alone.
 if(serviceHandoffsLoading)await serviceHandoffsLoading;
 if(!current())return;
 const index=serviceCases.findIndex(row=>row.id===record.id);if(index<0||serviceCases[index].version>record.version)return;
 const event=history?.data?.[0],historyError=history?.error?.message||(!event?.id||event.case_id!==record.id||event.to_status!==record.status?'The saved audit entry was unavailable.':'');
 serviceCases[index]=record;servicePageKey='';
 if(servicePageData){servicePageData.rows=servicePageData.rows.map(row=>row.id===record.id?{...row,...record}:row);if(serviceLoaded)servicePageData.metrics=serviceMetricValues(serviceCases.filter(row=>row.case_type===record.case_type));}
 if(historyError)serviceHistoryErrors.set(record.id,historyError);
 else{serviceHistoryErrors.delete(record.id);if(!serviceEvents.some(row=>row.id===event.id))serviceEvents.push(event);}
 patchServiceCase(record);return {historyError};
}
function patchServiceCase(record){
 let card=document.querySelector(`[data-service-card="${CSS.escape(record.id)}"]`);
 if(!card){const template=document.createElement('template');template.innerHTML=serviceCaseCard(record);card=template.content.firstElementChild;$('#servicePageRows').append(card);}
 if(card){
  const historyOpen=card.querySelector('.workflow-history')?.open,focused=card.contains(document.activeElement),left=window.scrollX,top=window.scrollY,feedback=typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive?.successOrigin?.node?.closest('[data-service-card]')===card;
  const template=document.createElement('template');template.innerHTML=serviceCaseCard(record);const next=template.content.firstElementChild;
  card.className=next.className;card.replaceChildren(...next.childNodes);card.tabIndex=-1;
  const disclosure=card.querySelector('.workflow-history');if(disclosure)disclosure.open=historyOpen||serviceHistoryErrors.has(record.id);
  const rows=serviceSortCases(serviceCases.filter(row=>row.case_type===record.case_type)),after=rows.slice(rows.findIndex(row=>row.id===record.id)+1).map(row=>document.querySelector(`[data-service-card="${CSS.escape(row.id)}"]`)).find(Boolean);
  if(serviceLoaded){card.parentNode.insertBefore(card,after||null);const metrics=document.querySelector('.service-metrics');if(metrics){template.innerHTML=serviceMetrics(rows);metrics.replaceWith(template.content.firstElementChild);}}
  bindServiceCaseCards([card]);
  const target=card.querySelector('.primary-action,button')||card;
  if(feedback)actionFeedbackActive.successOrigin=actionFeedbackReference(target);
  window.scrollTo({left,top});if(focused)target.focus({preventScroll:true});
 }
 return card;
}
function serviceSavedCaseValid(record,id){return record?.id===id&&Number.isSafeInteger(record.version)&&record.version>0&&Object.hasOwn(serviceStatusLabels,record.status)&&['installation','service'].includes(record.case_type)&&typeof record.case_number==='string'&&typeof record.asset_id==='string'&&typeof record.product_id==='string'&&typeof record.organization_id==='string'&&Number.isFinite(Date.parse(record.updated_at));}
async function serviceAfterSavedCase(record,report,current){
 if(!current())return;
 if(serviceHandoffsLoading)await serviceHandoffsLoading;if(!current())return;
 const previous=serviceCases.find(row=>row.id===record.id);if(previous?.version>record.version)return;
 serviceCases=[record,...serviceCases.filter(row=>row.id!==record.id)];serviceLoaded=false;servicePageKey='';serviceSelectedId=record.id;
 serviceSavedReads.set(record.id,{record,report,page:servicePageData,loading:false,error:''});
 if(report){const ids=new Set(serviceReports.filter(row=>row.case_id===record.id).map(row=>row.id));serviceReports=serviceReports.filter(row=>row.case_id!==record.id);serviceAccessories=serviceAccessories.filter(row=>!ids.has(row.report_id));serviceAttendees=serviceAttendees.filter(row=>!ids.has(row.report_id));}
 serviceAssets=serviceAssets.filter(row=>row.id!==record.asset_id);
 if(serviceIntakeOpen){serviceIntakeOpen=false;$('#serviceIntake').innerHTML='<button id="serviceOpenIntake" type="button">Record another request</button>';bindServicePageControls();}
 await retryServiceSavedCase(record.id);
}
async function readServiceSavedDetails(state,current){
 if(state.statusOnly)return true;
 const {record,report}=state,requests=[client.from('equipment_assets').select('*').eq('id',record.asset_id).maybeSingle()];
 if(report)requests.push(client.from('service_reports').select('*').eq('case_id',record.id).maybeSingle(),client.from('service_cases').select('*').eq('asset_id',record.asset_id).eq('case_type','service').not('source_case_id','is',null).not('status','in','(completed,cancelled)').order('created_at').limit(1));
 const results=await Promise.all(requests);if(!current())return false;for(const result of results)if(result.error)throw result.error;
 const asset=results[0].data;if(!asset||asset.id!==record.asset_id||typeof asset.model!=='string'||!Object.hasOwn(asset,'serial_number'))throw Error('The saved machine details could not load.');
 let signed,next,accessories=[],attendees=[];
 if(report){
  signed=results[1].data;next=results[2].data;
  if(!signed?.id||signed.case_id!==record.id||!['actual_work_date','next_maintenance_date','customer_signed_date','customer_signoff_reference','anudha_signed_date','anudha_signoff_reference','work_completed','actual_engineer_name','engineer_signed_date','currency','service_charge_minor'].every(key=>Object.hasOwn(signed,key))||record.case_type==='installation'&&typeof signed.qc_training_status!=='string')throw Error('The signed report could not load.');
  if(!Array.isArray(next)||next.length!==1||!serviceSavedCaseValid(next[0],next[0].id)||!next[0].source_case_id||['completed','cancelled'].includes(next[0].status)||next[0].asset_id!==record.asset_id||next[0].case_type!=='service')throw Error('The next maintenance job could not load.');
  const children=await Promise.all([client.from('service_report_accessories').select('*').eq('report_id',signed.id).order('sort_order').limit(101),client.from('service_training_attendees').select('*').eq('report_id',signed.id).order('sort_order').limit(11)]);
  if(!current())return false;for(const result of children)if(result.error)throw result.error;
  [accessories,attendees]=children.map(result=>result.data);
  if(!Array.isArray(accessories)||accessories.length>100||!Array.isArray(attendees)||attendees.length>10||record.case_type==='installation'&&!attendees.length||[...accessories,...attendees].some(row=>row.report_id!==signed.id))throw Error('The complete signed report details could not load.');
 }
 serviceAssets=[asset,...serviceAssets.filter(row=>row.id!==asset.id)];
 if(report){serviceReports=[signed,...serviceReports.filter(row=>row.case_id!==record.id)];serviceAccessories=[...serviceAccessories.filter(row=>row.report_id!==signed.id),...accessories];serviceAttendees=[...serviceAttendees.filter(row=>row.report_id!==signed.id),...attendees];const cached=serviceCases.find(row=>row.id===next[0].id);if(!cached||cached.version<=next[0].version)serviceCases=[...serviceCases.filter(row=>row.id!==next[0].id),next[0]];}
 return true;
}
function reconcileServicePage(previous){
 const data=servicePageData,container=$('#servicePageRows'),active=document.activeElement,existing=new Map([...container.querySelectorAll('[data-service-card]')].map(card=>[card.dataset.serviceCard,card])),before=new Map((previous?.rows||[]).map(row=>[row.id,row])),changed=[];
 const selected=serviceCases.find(row=>row.id===serviceSelectedId),rows=[...data.rows];if(selected&&!rows.some(row=>row.id===selected.id))rows.push(selected);
 for(const card of existing.values())if(!rows.some(row=>row.id===card.dataset.serviceCard))card.remove();
 container.querySelector('.empty')?.remove();
 for(const [index,row] of rows.entries()){
  let card=existing.get(row.id);
  if(!card||row.id!==selected?.id&&JSON.stringify(before.get(row.id))!==JSON.stringify(row)){const template=document.createElement('template');template.innerHTML=row.id===selected?.id?serviceCaseCard(selected):serviceSummaryCard(row);const next=template.content.firstElementChild;if(card)card.replaceWith(next);card=next;changed.push(card);}
  if(container.children[index]!==card)container.insertBefore(card,container.children[index]||null);
 }
 if(!rows.length)container.innerHTML='<div class="empty">No jobs found.</div>';
 container.querySelectorAll('[data-service-open]').forEach(button=>button.disabled=false);
 $('#servicePageMetrics').innerHTML=serviceMetrics(data.metrics);$('#servicePageMetrics').hidden=false;$('#servicePageControls').innerHTML=servicePageControls(data);$('#servicePageControls').hidden=false;$('#servicePageReadError').textContent='';bindServicePageControls();if(changed.length)bindServiceCaseCards(changed);
 if(document.activeElement===document.body&&active!==document.body&&active?.isConnected)active.focus({preventScroll:true});
}
async function retryServiceSavedCase(id){
 const state=serviceSavedReads.get(id);if(!state||state.loading||!me||serviceActor!==me||view!=='service'||serviceSection==='forms'||state.record.case_type!==(serviceSection==='schedule'?'service':'installation'))return;
 const actor=me,epoch=serviceEpoch,section=serviceSection,target=$('#content');let request=++servicePageRequest;
 const current=()=>me===actor&&serviceActor===actor&&epoch===serviceEpoch&&section===serviceSection&&view==='service'&&request===servicePageRequest&&serviceSavedReads.get(id)===state&&target?.isConnected&&$('#content')===target;
 if(!current())return;state.loading=true;state.error='';const left=window.scrollX,top=window.scrollY;
 try{
 patchServiceCase(state.record);
 let details=false;try{
  if(state.attempted){const result=await client.from('service_cases').select('*').eq('id',id).maybeSingle();if(!current())return;if(result.error)throw result.error;if(!serviceSavedCaseValid(result.data,id)||result.data.version<state.record.version||result.data.case_type!==state.record.case_type)throw Error('The current saved job could not load.');state.record=result.data;}
  state.attempted=true;details=await readServiceSavedDetails(state,current);
 }catch(error){if(current())state.error=error.message||'The saved job details could not load.';}
 if(!current())return;
 const updated=await updateServiceCase(state.record,current);if(!updated||!current())return;if(updated.historyError)state.error=[state.error,updated.historyError].filter(Boolean).join(' ');
 const previous=servicePageData||state.page,loading=loadServicePage(true,current);request=servicePageRequest;const loaded=await loading;if(!current())return;
 if(loaded){if(servicePageData.rows.some(row=>row.id===id&&row.version>state.record.version))state.error='The saved job changed again. Use Retry saved job to load its current revision.';reconcileServicePage(previous);}
 else{$('#servicePageRows').querySelectorAll('[data-service-open]').forEach(button=>button.disabled=true);$('#servicePageMetrics').hidden=true;$('#servicePageControls').hidden=true;$('#servicePageReadError').textContent='The job was saved, but list counts could not reload. Use Retry saved job.';state.error=[state.error,serviceLoadError].filter(Boolean).join(' ');}
 state.loading=false;if(details&&loaded&&!state.error)serviceSavedReads.delete(id);
 const card=patchServiceCase(state.record),focus=card.querySelector('.primary-action,button')||card;
 if(typeof actionFeedbackActive!=='undefined'&&actionFeedbackActive)actionFeedbackActive.successOrigin=actionFeedbackReference(focus);
 message((state.statusOnly?'Service job updated: '+serviceStatusLabel(state.record.status)+'.':state.report?'Signed report saved.':'Job created.')+(state.error?' Some saved details or list counts could not load. Use Retry saved job.':state.statusOnly?'':state.report?' The next maintenance job is now on the service schedule.':' Assign an engineer and confirm the work date.'),false);
 window.scrollTo({left,top});if(document.activeElement===document.body||!document.activeElement?.isConnected)focus.focus({preventScroll:true});
 }finally{state.loading=false;}
}
function bindServiceCaseCards(cards){
 if(typeof openDocumentAttachments==='function')cards.forEach(card=>{
  if(card.querySelector('[data-service-open]'))return;
  const record=serviceCase(card.dataset.serviceCard),actions=card.querySelector('.actions');if(!record||!actions||actions.querySelector('[data-document-files]'))return;
  const button=document.createElement('button');button.type='button';button.dataset.documentFiles=record.id;button.textContent='Upload / view documents';
  button.onclick=()=>run(()=>openDocumentAttachments('service',record.id,record.case_number));actions.append(button);
 });
 for(const card of cards){
  card.querySelectorAll('[data-service-retry-saved]').forEach(button=>button.onclick=()=>run(()=>retryServiceSavedCase(button.dataset.serviceRetrySaved)));
  card.querySelectorAll('[data-service-open]').forEach(button=>button.onclick=()=>run(()=>openServiceJob(button.dataset.serviceOpen)));
  card.querySelectorAll('[data-service-action]').forEach(button=>button.onclick=()=>openServiceAction(serviceCase(button.dataset.id),button.dataset.serviceAction));
  card.querySelectorAll('[data-service-reused]').forEach(button=>button.onclick=()=>run(()=>focusServiceCase(button.dataset.serviceReused)));
  card.querySelectorAll('[data-service-report]').forEach(button=>button.onclick=()=>openServiceReport(serviceCase(button.dataset.serviceReport)));
  card.querySelectorAll('[data-print-service]').forEach(button=>button.onclick=()=>printServiceReport(button.dataset.printService));
 }
 if(typeof decorateWorkHandoffs==='function')serviceHandoffsLoading=(cards.length===1?decorateWorkHandoffs(cards[0]):decorateWorkHandoffs()).catch(()=>{});
}
function bindServiceWorkflow(){
 bindServiceCaseCards([...document.querySelectorAll('[data-service-card]')]);
 document.querySelectorAll('[data-service-section]').forEach(button=>button.onclick=()=>{serviceSection=button.dataset.serviceSection;servicePage=0;serviceSelectedId='';serviceFocusId='';serviceIntakeOpen=false;run(()=>serviceWorkspace())});
 $('#serviceRefresh')?.addEventListener('click',()=>run(()=>serviceWorkspace(true)));
 bindServicePageControls();
 const newCase=$('#newServiceCase');if(newCase)bindServiceIntake(newCase);
}
function bindServicePageControls(){
 document.querySelectorAll('[data-service-page]').forEach(button=>button.onclick=()=>run(async()=>{servicePage=Number(button.dataset.servicePage);serviceSelectedId='';serviceIntakeOpen=false;await serviceWorkspace();}));
 const allJobs=$('#serviceAllJobs');if(allJobs)allJobs.onclick=()=>run(async()=>{serviceFocusId='';serviceSelectedId='';servicePage=0;await serviceWorkspace();});
 $('#serviceOpenIntake')?.addEventListener('click',()=>run(()=>openServiceJob('',true)));
}
function bindServiceIntake(form){
 const actor=me,epoch=serviceEpoch,section=serviceSection,pageRequest=servicePageRequest,requestId=crypto.randomUUID(),current=()=>me===actor&&serviceEpoch===epoch&&servicePageRequest===pageRequest&&view==='service'&&serviceSection===section&&form.isConnected;
 const field=name=>form.elements.namedItem(name),refreshContacts=()=>{const organizationId=field('siteOrganizationId').value||field('organizationId').value;field('contactId').innerHTML=`<option value="">${organizationId?'No named contact':'Choose a customer first'}</option>${serviceContactOptions(organizationId)}`;field('contactId').disabled=!organizationId;};
 const button=form.querySelector('[type="submit"]'),summary=form.querySelector('[data-service-intake-errors]'),fieldErrors=new Map();form.noValidate=true;
 const collectErrors=()=>{
  const errors=nativeFormErrors(form),values=Object.fromEntries(new FormData(form)),asset=serviceAssets.find(row=>row.id===values.assetId),contact=contacts.find(row=>row.id===values.contactId),siteId=values.siteOrganizationId||asset?.organization_id||values.organizationId;
  if(values.contactId&&!(contact&&siteId===contact.organization_id)&&!errors.has(field('contactId')))errors.set(field('contactId'),'Choose a contact from the destination site.');
  return errors;
 };
 const updateSummary=()=>{summary.textContent=fieldErrorSummary(fieldErrors.size);};
 const validateControl=(control,errors=collectErrors())=>{const problem=errors.get(control)||'';if(problem)fieldErrors.set(control,problem);else fieldErrors.delete(control);showFieldError(control,problem);updateSummary();};
 form.addEventListener('focusout',event=>{
  const control=fieldValidationSource(event.target);
  if(!current()||fieldBlurToAction(event)||button.disabled||!form.contains(control)||!control.matches('input,select,textarea')||control.disabled||control.readOnly)return;
  validateControl(control);
 });
 form.addEventListener('change',event=>{if(!event.target.matches('select,input[type="checkbox"],input[type="radio"]')||!current()||button.disabled)return;const errors=collectErrors();for(const control of fieldErrors.keys())validateControl(control,errors);});
 field('serialUnknown').onchange=()=>{field('serial').disabled=field('serialUnknown').checked;field('serial').required=!field('serialUnknown').checked;};
 field('organizationId').onchange=()=>{refreshContacts();if(!field('location').value)field('location').value=orgIndex.get(field('organizationId').value)?.location||'';};
 field('siteOrganizationId').onchange=()=>{refreshContacts();const site=orgIndex.get(field('siteOrganizationId').value);if(site?.location)field('location').value=site.location;};
 field('assetId').onchange=()=>{const asset=serviceAssets.find(row=>row.id===field('assetId').value),last=asset&&serviceCases.filter(row=>row.asset_id===asset.id).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0];
  for(const name of ['organizationId','productId','model','serial','serialUnknown'])field(name).disabled=!!asset;
  if(asset){field('organizationId').value=asset.organization_id;field('productId').value=asset.product_id;field('model').value=asset.model||'';field('serial').value=asset.serial_number||'';field('serialUnknown').checked=asset.serial_unknown;field('siteOrganizationId').value=last?.site_organization_id||'';field('location').value=last?.site_location||asset.installation_location||orgIndex.get(asset.organization_id)?.location||'';field('projectName').value=last?.project_name||'';field('source').value=last?.intake_source==='erp_delivery'?'customer_request':last?.intake_source||'customer_request';}
  else{for(const name of ['organizationId','productId','model','serial','siteOrganizationId','location','projectName'])field(name).value='';field('serialUnknown').checked=false;field('serial').required=true;}
  refreshContacts();if(last?.contact_id&&contacts.some(contact=>contact.id===last.contact_id&&(last.site_organization_id||asset.organization_id)===contact.organization_id))field('contactId').value=last.contact_id;
 };
 form.addEventListener('submit',event=>{event.preventDefault();if(!current()||button.disabled)return;if(busy){actionFeedbackRefuse(button,summary);return;}
  const errors=collectErrors();fieldErrors.clear();for(const [control,problem]of errors)fieldErrors.set(control,problem);updateSummary();showFieldErrors(form,errors);if(errors.size)return;
  const values=Object.fromEntries(new FormData(form)),asset=serviceAssets.find(row=>row.id===values.assetId);button.disabled=true;
  run(async()=>{try{const contact=contacts.find(row=>row.id===values.contactId),siteId=values.siteOrganizationId||asset?.organization_id||values.organizationId;if(values.contactId&&!(contact&&siteId===contact.organization_id))throw Error('Choose a contact from the destination site.');
   const result=await client.rpc('create_service_intake',{p_id:requestId,p_case_type:form.dataset.caseType,p_asset_id:asset?.id||null,p_expected_asset_updated_at:asset?.updated_at||null,p_organization_id:asset?.organization_id||values.organizationId,p_site_organization_id:values.siteOrganizationId||null,p_contact_id:values.contactId||null,p_product_id:asset?.product_id||values.productId,p_model:asset?asset.model||'':String(values.model||'').trim(),p_serial_number:asset?asset.serial_number||null:values.serialUnknown?null:String(values.serial||'').trim(),p_serial_unknown:asset?asset.serial_unknown:!!values.serialUnknown,p_location:String(values.location||'').trim(),p_project_name:String(values.projectName||'').trim(),p_problem_summary:String(values.problem||'').trim(),p_source:values.source});
   if(!current())return;if(result.error)throw result.error;const saved=Array.isArray(result.data)?result.data[0]:result.data;if(!serviceSavedCaseValid(saved,requestId)||saved.case_type!==form.dataset.caseType)throw Error('The created job could not be confirmed. Retry with the same details.');await serviceAfterSavedCase(saved,false,current);
  }finally{if(form.isConnected&&me===actor&&view==='service'&&serviceSection===section)button.disabled=false;}},{origin:button,errorTarget:summary});
 });
}
async function loadServicePage(force=false,current=()=>true){
 const key=JSON.stringify([serviceSection,servicePage,serviceFocusId]);if(!force&&servicePageData&&servicePageKey===key)return true;
 const actor=me,request=++servicePageRequest,section=serviceSection;
 try{
  const result=await client.rpc('service_case_page',{p_case_type:section==='schedule'?'service':'installation',p_page:servicePage,p_case_id:serviceFocusId||null});
  if(me!==actor||request!==servicePageRequest||view!=='service'||serviceSection!==section||!current())return false;
  if(result.error)throw result.error;const data=result.data;
  if(!data||!Array.isArray(data.rows)||data.rows.length>50||!Number.isSafeInteger(data.total)||!Number.isSafeInteger(data.page)||!Number.isSafeInteger(data.pages)||!data.metrics||data.rows.some(row=>!row.id||!row.display))throw Error('The Service page could not be confirmed. Refresh the list.');
  servicePageData=data;servicePage=data.page;servicePageKey=JSON.stringify([section,data.page,serviceFocusId]);serviceLoadError='';return true;
 }catch(error){if(me!==actor||request!==servicePageRequest||view!=='service'||serviceSection!==section||!current())return false;servicePageData=null;servicePageKey='';serviceLoadError=error.message||'Service data could not load.';return false;}
}
async function loadServiceContext(current,force=false){
 if(typeof listsLoaded!=='undefined'&&!listsLoaded){await (listsLoading||loadLists());if(!current())return false;if(!listsLoaded)throw Error('Service editing data could not load. Refresh and reopen this job.');}
 if(force||!serviceLoaded){const loaded=await loadServiceWorkflow();if(!current())return false;if(!loaded)throw Error(serviceLoadError||'The complete Service record could not load.');}
 return current();
}
async function openServiceJob(id,intake=false){
 if(!me||view!=='service'||serviceSection==='forms')return;
 syncServiceActor();const actor=me,section=serviceSection,request=++servicePageRequest,current=()=>me===actor&&servicePageRequest===request&&view==='service'&&serviceSection===section;
 workspaceLoading(intake?'Loading the complete intake form…':'Loading the complete job and history…');
 try{
  if(!await loadServiceContext(current,true))return;
  if(id&&!serviceCases.some(row=>row.id===id))throw Error('This service job is unavailable.');
  serviceSelectedId=id;serviceIntakeOpen=intake;renderServicePage();
 }catch(error){if(!current())return;serviceSelectedId='';serviceIntakeOpen=false;serviceLoadError=error.message||'The complete Service record could not load.';$('#content').innerHTML=serviceUnavailable();bindServiceWorkflow();}
}
function renderServicePage(){
 $('#content').innerHTML=serviceSection==='forms'?serviceFormsScreen():serviceSection==='schedule'?serviceScheduleScreen():installationScreen();bindServiceWorkflow();
}
async function serviceWorkspace(force=false){
 syncWorkspaceNavigation();syncServiceActor();const actor=me,section=serviceSection;if(!actor||view!=='service')return;
 const request=++servicePageRequest,current=()=>me===actor&&view==='service'&&serviceSection===section&&servicePageRequest===request;
 if(section==='forms'){renderServicePage();return;}
 workspaceLoading('Loading service and installation jobs…');
 if(force&&(serviceSelectedId||serviceIntakeOpen)){
  try{if(!await loadServiceContext(current,true))return;}catch(error){if(!current())return;serviceLoadError=error.message;$('#content').innerHTML=serviceUnavailable();bindServiceWorkflow();return;}
 }
 const loading=loadServicePage(force),pageRequest=servicePageRequest,loaded=await loading;
 if(me!==actor||view!=='service'||serviceSection!==section||pageRequest!==servicePageRequest)return;
 if(!loaded){if(serviceLoadError){$('#content').innerHTML=serviceUnavailable();bindServiceWorkflow();}return;}
 renderServicePage();
}

async function focusServiceCase(id){
 syncServiceActor();const actor=me,epoch=serviceEpoch,origin=view;
 const result=await client.from('service_cases').select('id,case_type').eq('id',id).single();
 if(me!==actor||serviceEpoch!==epoch||view!==origin)return;
 if(result.error)throw result.error;if(!result.data)throw Error('This service job is unavailable.');
 view='service';serviceSection=result.data.case_type==='installation'?'installations':'schedule';serviceFocusId=id;servicePage=0;serviceSelectedId='';serviceIntakeOpen=false;
 await serviceWorkspace();if(me!==actor||view!=='service'||serviceFocusId!==id||!servicePageData)return;
 await openServiceJob(id);if(me!==actor||view!=='service'||serviceFocusId!==id)return;
 const card=document.querySelector(`[data-service-card="${CSS.escape(id)}"]`);if(card){card.tabIndex=-1;card.scrollIntoView({block:'center'});card.focus({preventScroll:true});}
}
