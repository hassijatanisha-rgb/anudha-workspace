import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context={
 window:{PHONE_RULES:{TZ:{code:'255',lengths:[9],pattern:'[67]\\d{8}'}}},
 Intl,console,Set,Map,
 esc:value=>String(value),
 orgIndex:new Map(),
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('client-rules.js','utf8'),context);

assert.equal(typeof context.contactReviewQueue,'function','A shared contact review queue helper must exist.');
const organizations=[
 {id:'A',name:'Alpha Hospital',location:'Dar es Salaam'},
 {id:'B',name:'Beta Clinic',location:'Arusha'},
];
const contacts=[
 {id:'OK',organization_id:'A',title:'Mr.',first_name:'Valid',last_name:'Person',position:'Procurement',phone_country:'TZ',country_code:'+255',phone:'712345678',email:'',status:'kept'},
 {id:'MISSING',organization_id:'A',title:'Mrs.',first_name:'Asha',last_name:'',position:'Lab',phone_country:'TZ',country_code:'+255',phone:'712345678',email:'',status:'review'},
 {id:'PHONE',organization_id:'B',title:'Doctor',first_name:'Bora',last_name:'Medic',position:'Doctor',phone_country:'TZ',country_code:'+255',phone:'123',email:'',status:'review'},
 {id:'WRONG',organization_id:'B',title:'N/A',first_name:'Old',last_name:'Record',position:'Unknown',phone_country:'TZ',country_code:'+255',phone:'712345678',email:'',status:'incorrect',reason:'Left the company'},
];
const rows=context.contactReviewQueue(contacts,organizations);
assert.deepEqual(Array.from(rows,x=>x.contact.id),['MISSING','PHONE']);
assert.match(rows[0].reasons.join(' '),/Last name is required/);
assert.equal(rows[0].organization.name,'Alpha Hospital');
assert.match(rows[1].reasons.join(' '),/digits|numbering plan/);
assert.ok(!rows.some(row=>row.contact.id==='OK'),'Kept valid contacts must not remain in the queue.');
assert.ok(!rows.some(row=>row.contact.id==='WRONG'),'Incorrect archived contacts belong in their separate review state.');

console.log('PASS: shared review queue exposes actionable contact issues with client context.');
