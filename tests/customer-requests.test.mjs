import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function load(user='a'){
 const ctx=vm.createContext({me:{user_id:user,role:'staff'},esc:s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';'),employeeName:id=>({a:'Asha'}[id]||'Employee name not set'),encodeURIComponent,Date,Number,String});
 vm.runInContext(readFileSync(new URL('../customer-requests.js',import.meta.url),'utf8'),ctx);return ctx;
}
const req=(id,kind,status,extra={})=>({id,kind,status,request_number:'REQ-2026-00000'+id,name:'Fixture '+id,phone:'0712345678',message:'Need help',contact_channel:'whatsapp',created_at:'2026-10-0'+id+'T08:00:00Z',version:1,confirmation_status:'not_set_up',...extra});
test('inquiries and complaints are separate; new ones first; filters and search',()=>{
 const ctx=load(),rows=[req('1','inquiry','received'),req('2','quote','in_progress',{assigned_user_id:'a'}),req('3','complaint','received'),req('4','support','resolved',{resolution_note:'Fixed'}),req('5','inquiry','closed')];
 const ids=(section,filter,search='')=>ctx.requestVisible(rows,{section,filter,search,actor:'a'}).map(r=>r.id);
 assert.deepEqual(ids('inquiries','open'),['1','2'],'new before being handled');
 assert.deepEqual(ids('inquiries','mine'),['2']);
 assert.deepEqual(ids('inquiries','done'),['5']);
 assert.deepEqual(ids('complaints','open'),['3']);
 assert.deepEqual(ids('complaints','all','REQ-2026-000004'),['4']);
});
test('WhatsApp links use the international number and carry the request number',()=>{
 const ctx=load(),row=req('1','quote','received');
 assert.equal(ctx.requestWhatsAppNumber('0712 345 678'),'255712345678');
 assert.equal(ctx.requestWhatsAppNumber('+255 712 345 678'),'255712345678');
 const link=ctx.requestWhatsAppLink(row,ctx.requestConfirmationText(row));
 assert.match(link,/^https:\/\/wa\.me\/255712345678\?text=/);assert.match(decodeURIComponent(link),/REQ-2026-000001/);
});
test('buttons follow the status; unconfirmed requests offer a WhatsApp confirmation',()=>{
 const ctx=load('a');
 const open=ctx.requestCard(req('1','inquiry','received',{lead_id:'L1'}));
 for(const b of ['take','assign','resolve','close'])assert.match(open,new RegExp(`data-request-action="${b}"`));
 assert.match(open,/data-request-lead="L1"/);assert.match(open,/Send confirmation on WhatsApp/);
 const mine=ctx.requestCard(req('2','complaint','in_progress',{assigned_user_id:'a',confirmation_status:'sent'}));
 assert.doesNotMatch(mine,/data-request-action="take"/,'already mine');assert.match(mine,/Confirmation sent/);
 const done=ctx.requestCard(req('3','complaint','closed'));
 assert.match(done,/data-request-action="reopen"/);assert.doesNotMatch(done,/data-request-action="resolve"/);
 assert.doesNotMatch(ctx.requestCard(req('4','complaint','received',{message:'<img src=x onerror=alert(1)>'})),/<img/,'customer text is escaped');
});
test('database: website submissions only through the service role; staff need Leads or Service access',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/202610060062_customer_requests.sql',import.meta.url),'utf8');
 assert.match(sql,/grant execute on function public\.submit_customer_request\([^)]*\),\s*public\.record_customer_request_confirmation\(uuid,text,text\), public\.track_customer_request\(text,text\) to service_role/);
 assert.match(sql,/revoke all on public\.customer_requests, public\.customer_request_events from public, anon, authenticated/);
 assert.match(sql,/>= 5 then\s*raise exception 'Too many requests/);
 const fn=readFileSync(new URL('../supabase/functions/website-request/index.ts',import.meta.url),'utf8');
 assert.match(fn,/if \(text\(body\.website, 200\)\) return reply\(req, 400/,'hidden field stops bots');
 assert.doesNotMatch(fn,/from\('customer_requests'\)/,'the function never reads the table directly');
});
