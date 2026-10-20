// Actual service migrations and handoffs in disposable PGlite; no network or live records.
import assert from 'node:assert/strict';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const f=await createOrderFixture({extraMigrations:['202610200115_independent_service_intake.sql']});
const {db,id,OWNER,ENGINEER,OUTSIDER,ORG,CONTACT,MACHINE,REAGENT,as,admin,one,dates}=f;
let checks=0;
const check=async(label,fn)=>{await fn();checks++;console.log('PASS: '+label);};
const payload=(n,changes={})=>({id:id(n),type:'service',asset:null,stamp:null,customer:ORG,site:null,contact:CONTACT,product:MACHINE,model:'External analyzer model',serial:'EXT-'+n,unknown:false,location:'External clinic laboratory',project:'Historical equipment',problem:'Repair intermittent power fault',source:'third_party',...changes});
const create=async p=>one('select * from create_service_intake('+Array.from({length:15},(_,i)=>'$'+(i+1)).join(',')+')',[p.id,p.type,p.asset,p.stamp,p.customer,p.site,p.contact,p.product,p.model,p.serial,p.unknown,p.location,p.project,p.problem,p.source]);
const asset=caseRow=>one('select * from equipment_assets where id=$1',[caseRow.asset_id]);
const existing=(n,a,changes={})=>payload(n,{asset:a.id,stamp:a.updated_at,customer:a.organization_id,product:a.product_id,model:a.model||'',serial:a.serial_number,unknown:a.serial_unknown,...changes});
const progress=async c=>{for(const action of ['assign','schedule','start','submit_report'])c=await one('select * from advance_service_case($1,$2,$3,$4,$5,$6)',[c.id,c.version,action,action==='assign'?ENGINEER:null,action==='schedule'?dates.today:null,'Fixture '+action]);return c;};
const complete=(c,serial,engineer=ENGINEER)=>one('select * from complete_service_report('+Array.from({length:31},(_,i)=>'$'+(i+1)).join(',')+')',[
 c.id,c.version,dates.today,'External analyzer model',serial,'Hospital laboratory','External equipment project','Complete requested work','Tested and verified operation','',engineer,'Fixture Engineer',
 dates.today,'Fixture Customer',dates.today,'FIX-CUSTOMER-SIGNATURE','Fixture Engineer',dates.today,'FIX-ENGINEER-SIGNATURE',true,'completed',false,null,null,null,'TZS',0,'',6,'[]',JSON.stringify([{full_name:'Fixture Trainee',telephone:'000000000',designation:'Lab technician'}])]);
try{
 await as(ENGINEER);
 let repair;
 await check('Third-party repair needs no sale, delivery or installed date and creates an automatic work assignment',async()=>{
  repair=await create(payload(200));const a=await asset(repair);
  assert.equal(repair.source_delivery_note_id,null);assert.equal(a.source_delivery_line_id,null);assert.equal(a.installed_on,null);assert.equal(a.serial_number,'EXT-200');assert.equal(a.serial_unknown,false);
  assert.equal(repair.intake_source,'third_party');assert.equal(repair.project_name,'Historical equipment');assert.equal((await one("select assignee_user_id from work_assignments where record_id=$1 and status='open'",[repair.id])).assignee_user_id,ENGINEER);
 });
 await check('Identical retry returns the same case, event and asset',async()=>{
  assert.equal((await create(payload(200))).id,repair.id);assert.equal((await one('select count(*)::int n from service_case_events where case_id=$1',[repair.id])).n,1);
  await assert.rejects(create(payload(200,{problem:'Changed request'})),/different details/);
 });
 await check('Known product and serial cannot be duplicated, including different letter case',async()=>{await assert.rejects(create(payload(201,{serial:' ext-200 '})),/existing machine/);});
 await check('A duplicate open repair names the existing job',async()=>{await assert.rejects(create(existing(202,await asset(repair))),/already has open service job SRV-/);});
 let unknown;
 await check('Explicitly unknown identifier stays NULL; no placeholder serial is fabricated',async()=>{
  unknown=await create(payload(203,{type:'installation',serial:null,unknown:true,source:'legacy'}));const a=await asset(unknown);
  assert.equal(a.serial_number,null);assert.equal(a.serial_unknown,true);assert.equal(a.status,'pending_installation');assert.equal(a.installed_on,null);
  await assert.rejects(create(payload(204,{serial:null,unknown:false})),/explicitly mark it unknown/);
  await assert.rejects(create(payload(204,{serial:'KNOWN',unknown:true})),/explicitly mark it unknown/);
 });
 await check('Unknown assets must be explicitly selected to add related work, preserving identity',async()=>{
  const a=await asset(unknown);await assert.rejects(create(existing(205,a,{type:'installation'})),/already has open installation/);
  const c=await create(existing(206,a));assert.equal(c.asset_id,a.id);
 });
 await check('Existing machine identity and stale asset details are enforced by the server',async()=>{
  const a=await asset(repair);
  await assert.rejects(create(existing(207,a,{serial:'WRONG'})),/existing machine identity/);
  await assert.rejects(create(existing(207,a,{stamp:'2000-01-01T00:00:00Z'})),/Machine details changed/);
 });
 await check('Product scopes serial identity; another product may have the same serial',async()=>{const other=await create(payload(208,{product:REAGENT,serial:'EXT-200'}));assert.equal(other.product_id,REAGENT);});
 const SITE=id(50),SITE_CONTACT=id(51);
 await admin("insert into organizations(id,name,location) values($1,'Fixture destination hospital','Hospital laboratory')",[SITE]);
 await admin("insert into contacts(id,organization_id,status,first_name,last_name) values($1,$2,'valid','Site','Contact')",[SITE_CONTACT,SITE]);
 let deferred;
 await check('Distributor destination uses site contact and retains original customer and asset',async()=>{
  deferred=await create(existing(209,await asset(repair),{type:'installation',site:SITE,contact:SITE_CONTACT,source:'distributor',location:'Hospital laboratory'}));
  assert.equal(deferred.organization_id,ORG);assert.equal(deferred.site_organization_id,SITE);assert.equal(deferred.asset_id,repair.asset_id);assert.equal((await asset(deferred)).organization_id,ORG);
 });
 await check('A contact from the customer is rejected when a different destination site was selected',async()=>{await assert.rejects(create(payload(210,{site:SITE,contact:CONTACT})),/contact at the destination site/);});
 await check('Serial identification remains required before completing an unknown installation',async()=>{
  unknown=await progress(unknown);await assert.rejects(complete(unknown,''),/serial number.*required/);await assert.rejects(complete(unknown,'IDENTIFIED-203',OUTSIDER),/engineer with Service access/);
  await assert.rejects(complete(unknown,'EXT-200'),/belong to another machine/);
  assert.equal((await asset(unknown)).serial_number,null);
 });
 await check('Known machine identity cannot be rewritten during report completion',async()=>{deferred=await progress(deferred);await assert.rejects(complete(deferred,'WRONG-UNIT'),/match the existing machine/);});
 await check('Completed installation reports show site, preserve billing customer, and carry site to maintenance',async()=>{
  deferred=await complete(deferred,'EXT-200');const report=await one('select * from service_reports where case_id=$1',[deferred.id]),next=await one('select * from service_cases where source_case_id=$1',[deferred.id]);
  assert.equal(report.customer_name,'Fixture destination hospital');assert.equal(deferred.organization_id,ORG);assert.equal((await asset(deferred)).organization_id,ORG);
  assert.equal(next.site_organization_id,SITE);assert.equal(next.site_location,'Hospital laboratory');assert.equal(next.project_name,'External equipment project');
 });
 await check('Unknown installation acquires real identity on completion with no extra asset',async()=>{unknown=await complete(unknown,'IDENTIFIED-203');const a=await asset(unknown);assert.equal(a.serial_unknown,false);assert.equal(a.serial_number,'IDENTIFIED-203');assert.equal(a.status,'active');});
 await check('Stale report cannot submit twice',async()=>{await assert.rejects(complete(unknown,'IDENTIFIED-203'),/changed or is not ready/);});
 await check('A finished repair allows a later repair despite its scheduled maintenance',async()=>{
  repair=await complete(await progress(repair),'EXT-200');const next=await create(existing(211,await asset(repair)));
  assert.equal(next.asset_id,repair.asset_id);assert.equal((await one("select count(*)::int n from service_cases where asset_id=$1 and source_case_id is not null and status='scheduled'",[repair.asset_id])).n,1);
 });
 await check('Repair completion never invents an installation date',async()=>{
  let external=await create(payload(212));external=await complete(await progress(external),'EXT-212');assert.equal((await asset(external)).installed_on,null);
 });
 await check('Cancelled installation can be requested again; new duplicate open installation still blocked',async()=>{
  let c=await create(payload(213,{type:'installation'}));const a=await asset(c);c=await one("select * from advance_service_case($1,$2,'cancel',null,null,'Fixture reschedule')",[c.id,c.version]);
  const fresh=await create(existing(214,a,{type:'installation'}));assert.equal(fresh.asset_id,a.id);await assert.rejects(create(existing(215,a,{type:'installation'})),/already has open installation/);
 });
 await check('Service authorization is required for intake, existing-id retries and equipment reads',async()=>{
  await as(OUTSIDER);await assert.rejects(create(payload(216)),/do not have access/);await assert.rejects(create(payload(200)),/do not have access/);assert.equal((await one('select count(*)::int n from equipment_assets')).n,0);await as(ENGINEER);
 });
 await check('MFA enforcement uses the actual server access functions',async()=>{
  await admin("create or replace function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',coalesce(nullif(current_setting('test.aal',true),''),'aal2'),'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',extract(epoch from now())::bigint)))$$");
  await admin("insert into auth.mfa_factors(user_id,status) values($1,'verified')",[ENGINEER]);await db.query("select set_config('test.aal','aal1',false)");
  await assert.rejects(create(payload(217)),/do not have access/);await db.query("select set_config('test.aal','aal2',false)");assert.equal((await create(payload(217))).created_by,ENGINEER);
 });
 await check('Anonymous execute and authenticated direct writes are denied',async()=>{
  await assert.rejects(db.query("insert into equipment_assets(id,organization_id,product_id) values($1,$2,$3)",[id(218),ORG,MACHINE]),/permission denied|row-level security/);
  await db.exec('set role anon');await assert.rejects(create(payload(219)),/permission denied/);await db.exec('set role authenticated');
 });
 await as(OWNER);
 console.log(`PASS: ${checks} independent service intake checks. Actual service RPCs, access/MFA functions, report contract and automatic work assignments; single-session PGlite does not exercise concurrent PostgreSQL connections or real authentication transport.`);
}finally{await db.close();}
