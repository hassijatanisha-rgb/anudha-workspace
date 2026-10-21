// Disposable database: actual private storage policies, MFA helpers and contract/product migrations.
import assert from 'node:assert/strict';
import {createOrderFixture} from './helpers/order-database-fixture.mjs';
const {db,id,OWNER,SALES,ACCOUNTS,PACKER,ENGINEER,OUTSIDER,MACHINE,REAGENT,ORG,as,admin,one,load}=await createOrderFixture({extraMigrations:['202610200116_customer_contracts.sql','202610200122_product_brochure_attachments.sql']});
const path=(type,parent,request)=>`${type}/${parent}/${request}.pdf`;
const upload=(type,parent,request,actor)=>db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('erp-documents',$1,$2,'{\"size\":8,\"mimetype\":\"application/pdf\"}')",[path(type,parent,request),actor]);
const finalize=(type,parent,request)=>one('select * from finalize_document_attachment($1,$2,$3,$4,$5,$6,$7)',[request,type,parent,path(type,parent,request),'Brochure.pdf','application/pdf',8]);
const access=(type,parent)=>one('select document_attachment_parent_access($1,$2) allowed',[type,parent]).then(row=>row.allowed);
let checks=0;const check=async fn=>{await fn();checks++;};
try{
 await as(SALES);const request=id(1220);await upload('product',MACHINE,request,SALES);const saved=await finalize('product',MACHINE,request);
 await check(async()=>{assert.equal(saved.record_type,'product');assert.deepEqual(await finalize('product',MACHINE,request),saved);});
 for(const actor of [OWNER,SALES,PACKER,ENGINEER]){await as(actor);await check(async()=>{assert.equal(await access('product',MACHINE),true);assert.equal((await db.query('select * from document_attachments where id=$1',[request])).rows.length,1);assert.equal((await db.query('select * from storage.objects where name=$1',[path('product',MACHINE,request)])).rows.length,1);});}
 await as(OUTSIDER);await check(async()=>{assert.equal(await access('product',MACHINE),false);assert.equal((await db.query('select * from document_attachments where id=$1',[request])).rows.length,0);assert.equal((await db.query('select * from storage.objects where name=$1',[path('product',MACHINE,request)])).rows.length,0);await assert.rejects(upload('product',MACHINE,id(1221),OUTSIDER),/row-level security/);await assert.rejects(finalize('product',MACHINE,request),/parent access/);});
 for(const area of ['records','stock']){await admin('update staff set access=$1::text[] where user_id=$2',[[area],OUTSIDER]);await check(async()=>assert.equal(await access('product',MACHINE),true));}
 await admin("update staff set access='{leads}' where user_id=$1",[OUTSIDER]);
 await as(SALES);await check(async()=>{assert.equal(await access('product',id(1299)),false);await assert.rejects(upload('product',id(1299),id(1222),SALES),/row-level security/);});
 await admin('update products set deleted_at=now() where id=$1',[REAGENT]);await check(async()=>{assert.equal(await access('product',REAGENT),false);await assert.rejects(upload('product',REAGENT,id(1223),SALES),/row-level security/);});
 for(const unsafe of [`product/${MACHINE}/../bad.pdf`,`product/${MACHINE}/${id(1224)}.html`,`product/${MACHINE}/${id(1224)}.pdf/extra`])await check(async()=>assert.equal((await one('select document_attachment_path_access($1) allowed',[unsafe])).allowed,false));
 await check(async()=>{assert.equal((await admin("select public from storage.buckets where id='erp-documents'")).rows[0].public,false);assert.equal((await db.query("update storage.objects set metadata='{}' where name=$1 returning id",[path('product',MACHINE,request)])).rows.length,0);assert.equal((await db.query('delete from storage.objects where name=$1 returning id',[path('product',MACHINE,request)])).rows.length,0);await assert.rejects(db.exec('update document_attachments set original_filename=original_filename'),/permission denied/);});
 // The product branch must not change the approved contract's exact immutable file reference.
 const contract=await one("select * from save_customer_contract($1,$2,0,$3,'placement','Fixture placement','Signed fixture',current_date,null,'Private terms')",[id(1230),id(1231),ORG]);
 await upload('contract',contract.id,id(1232),SALES);await finalize('contract',contract.id,id(1232));await upload('contract',contract.id,id(1233),SALES);await finalize('contract',contract.id,id(1233));
 await as(OWNER);const approved=await one("select * from decide_customer_contract($1,$2,1,'approve',$3,'Reviewed exact signed document')",[id(1234),contract.id,id(1232)]);
 await check(async()=>{assert.equal(approved.approved_attachment_id,id(1232));await assert.rejects(admin('delete from document_attachments where id=$1',[id(1232)]),/immutable/);});
 await as(ENGINEER);await check(async()=>{assert.equal(await access('contract',contract.id),false);assert.equal((await db.query('select * from document_attachments where record_id=$1',[contract.id])).rows.length,0);});
 await as(ACCOUNTS);await one("select save_accounting_draft($1,'payment',0,null,null,'{\"lines\":[]}'::jsonb)",[id(1240)]);
 await as(SALES);await check(async()=>assert.equal(await access('accounting',id(1240)),false));
 await admin("insert into auth.mfa_factors(user_id,status) values($1,'verified')",[SALES]);
 await admin(`create or replace function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal','aal1')$$`);
 await check(async()=>{assert.equal(await access('product',MACHINE),false);assert.equal((await db.query('select * from document_attachments where id=$1',[request])).rows.length,0);await assert.rejects(upload('product',MACHINE,id(1241),SALES),/row-level security/);});
 await admin(`create or replace function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',extract(epoch from now())::bigint)))$$`);
 await admin('update staff set active=false where user_id=$1',[SALES]);await check(async()=>assert.equal(await access('product',MACHINE),false));
 await db.exec("reset role;set role anon;set test.actor=''");await check(async()=>{assert.equal((await db.query("select * from storage.objects where bucket_id='erp-documents'")).rows.length,0);await assert.rejects(finalize('product',MACHINE,request),/permission denied/);});
 await db.exec('reset role');await load('202610200122_product_brochure_attachments.sql');await db.exec('set role authenticated');await as(OWNER);await check(async()=>{assert.equal((await one('select approved_attachment_id from customer_contracts where id=$1',[contract.id])).approved_attachment_id,id(1232));assert.equal((await db.query('select * from document_attachments where id=$1',[request])).rows.length,1);});
 console.log(`PASS: ${checks} product brochure checks: private storage and immutable retry, relevant operational access, outsider/MFA/inactive/anonymous denial, existing active product, invalid paths, contract pinned-file and accounting isolation, migration rerun.`);
}finally{await db.close();}
