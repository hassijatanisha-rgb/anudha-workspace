import {statusTone} from './helpers/status-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function fixture(){
 const forms=[],calls=[];
 const context=vm.createContext({statusTone,me:{user_id:'engineer'},view:'service',
  esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
  employeeName:id=>id,inventoryProduct:()=>({name:'Fixture machine'}),
  orgIndex:new Map([['customer',{name:'Fixture customer',location:'Ward'}]]),
  actionForm:(title,fields,submit)=>{forms.push({title,fields,submit});},
  client:{rpc:async(...args)=>{calls.push(args);return {data:{}};}}
 });
 for(const file of ['business-date.js','service-domain.js','service-workflow.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),context);
 vm.runInContext("const businessDay=companyDate;companyDate=(offset=0,now=new Date('2026-10-27T09:00:00Z'))=>businessDay(offset,now)",context);
 return {context,forms,calls};
}
const planned={id:'plan',case_number:'INS-FIXTURE',case_type:'installation',organization_id:'customer',product_id:'machine',
 intake_source:'erp_delivery',delivery_ready:false,asset_id:null,planned_delivery_line_id:'line',planned_unit_number:2,
 status:'scheduled',assigned_user_id:'engineer',scheduled_for:'2026-10-28',created_at:'2026-10-01T09:00:00Z'};

test('invoice plans permit engineer/date planning but never on-site work or reports before signed delivery',()=>{
 const {context:c,forms,calls}=fixture();
 assert.deepEqual([...c.serviceNextActions('new',planned)],['assign']);
 assert.deepEqual([...c.serviceNextActions('scheduled',planned)],['schedule','reassign']);
 assert.deepEqual([...c.serviceNextActions('on_site',planned)],[]);
 assert.doesNotMatch(c.serviceCaseActions(planned),/data-service-action="start"/);
 assert.doesNotMatch(c.serviceCaseActions({...planned,status:'report_required'}),/data-service-report=/);
 assert.throws(()=>c.openServiceAction(planned,'start'),/signed delivery/);
 assert.throws(()=>c.openServiceAction(planned,'submit_report'),/signed delivery/);
 assert.throws(()=>c.openServiceReport(planned),/signed delivery/);
 assert.equal(forms.length,0);assert.equal(calls.length,0);
 c.openServiceAction(planned,'schedule');assert.match(forms[0].fields,/Confirmed work date/);
 assert.deepEqual([...c.serviceNextActions('scheduled',{delivery_ready:true})],['start','schedule','reassign']);
 assert.deepEqual([...c.serviceNextActions('scheduled')],['start','schedule','reassign'],'historical records remain usable');
});

test('planning cards identify their source and next action before dense facts, without inventing an asset',()=>{
 const {context:c}=fixture();const html=c.serviceCaseCard(planned);
 assert.match(html,/Invoiced · awaiting signed delivery/);assert.doesNotMatch(html,/Signed machine delivery/);
 assert.match(html,/Machine unit 2/);assert.match(html,/Await signed delivery before starting on-site work/);
 assert.ok(html.indexOf('Next step:')<html.indexOf('class="service-progress"'));
 assert.ok(html.indexOf('data-service-action="schedule"')<html.indexOf('class="service-facts"'));
 const newJob=c.serviceCaseCard({...planned,status:'new',assigned_user_id:null,scheduled_for:null});
 assert.match(newJob,/coordinator handoff does not assign the engineer/);
 assert.match(newJob,/Waiting 26 days/);
});

test('superseded plans link to the preserved installation and do not offer duplicate job actions',()=>{
 const {context:c}=fixture();const record={...planned,status:'cancelled',delivery_ready:true,reused_case_id:'existing-case'};
 const html=c.serviceCaseCard(record);assert.match(html,/data-service-reused="existing-case"/);
 assert.match(html,/duplicate planned job is closed/);assert.doesNotMatch(html,/data-service-action=/);
 assert.equal(c.serviceNeedsPlanning(record),false);
});

test('planning gaps sort oldest first; metrics exclude closed jobs and use Tanzania civil dates',()=>{
 const {context:c}=fixture();
 const rows=[{...planned,id:'ready',created_at:'2026-09-01T09:00:00Z'},
  {...planned,id:'newer',status:'new',assigned_user_id:null,scheduled_for:null,created_at:'2026-10-26T22:00:00Z'},
  {...planned,id:'closed',status:'completed',assigned_user_id:null,scheduled_for:null,created_at:'2026-08-01T09:00:00Z'},
  {...planned,id:'oldest',status:'assigned',scheduled_for:null}];
 assert.deepEqual([...c.serviceSortCases(rows)].map(row=>row.id),['oldest','newer','ready','closed']);
 assert.deepEqual(rows.map(row=>row.id),['ready','newer','closed','oldest'],'sorting preserves source order');
 assert.equal(c.serviceAgeDays(rows[1]),0,'22:00 UTC is already the next day in Tanzania');
 assert.equal(c.serviceAgeDays({...planned,created_at:'invalid'}),null);
 const metrics=c.serviceMetrics(rows);assert.match(metrics,/Awaiting engineer<\/small><strong>1<\/strong>/);
 assert.match(metrics,/Awaiting work date<\/small><strong>2<\/strong>/);
 assert.match(metrics,/Oldest: 26 days/);assert.doesNotMatch(metrics,/Oldest: 87/);
});
