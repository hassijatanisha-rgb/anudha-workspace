import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(process.env.PGLITE_MODULE||'../../../test-runtime/pglite-0.3.14/package/dist/index.js');
export async function startPreview(port=4186){
 const db=new PGlite(),id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;create table staff(user_id uuid,active boolean,role text);create table products(id uuid primary key);create table organizations(id uuid primary key);insert into auth.users values('${id(1)}'),('${id(2)}');insert into staff values('${id(1)}',true,'owner'),('${id(2)}',true,'staff');grant usage on schema auth to authenticated,anon;`);
 const root=new URL('../supabase/migrations/',import.meta.url);
 for(const file of ['202609210001_inventory_foundation.sql','202609210002_product_inventory_classification.sql','202609230018_tally_stock_review.sql'])await db.exec(readFileSync(new URL(file,root),'utf8'));
 await db.exec(`insert into inventory_locations(id,name,code,created_by) values('${id(10)}','City Printer','CP','${id(1)}');insert into tally_stock_sources(id,source_file,source_row,godown,product_name,quantity,balance_date,raw,imported_by) values('source','fixture',1,'CITY PRINTER','Blood bags',-4,'2026-09-22','{}','${id(1)}');`);
 const migration=new URL('202609290041_godown_mapping_reviews.sql',root);if(existsSync(migration))await db.exec(readFileSync(migration,'utf8'));

 const labels=['CITY PRINTER','CITY PRINTER GODOWN 04','City Printer Godown 2','KEKO MANGA A','New Dakawa','NEW DAKAWA GODOWN -A','RK CHUDASAMA NO.7','RK CHUDASAMA NO.8'];
 for(let i=1;i<labels.length;i++)await db.query("insert into tally_stock_sources(id,source_file,source_row,godown,product_name,quantity,balance_date,raw,imported_by) values($1,'fixture',$2,$3,'FICTIONAL REVIEW ITEM',10,'2026-09-22','{}',$4)",['fixture'+i,i+1,labels[i],id(1)]);
 await db.exec(`set test.actor='${id(1)}';set role authenticated`);
 const html='<!doctype html><html><head><meta charset="utf-8"><title>Isolated godown mapping review</title><link rel="stylesheet" href="/style.css"></head><body><main><h1>Godown mapping review</h1><p>Fictional test data — not the live ERP. Changes last only while this preview runs. No stock import or Supabase connection.</p><div id="godowns"></div><p id="error" role="alert"></p></main><script src="/tally-stock-review.js"></script><script src="/preview.js"></script></body></html>';
 const js=`let me={user_id:'fixture-owner',role:'owner'},inventorySection='review';
 function esc(v){const e=document.createElement('span');e.textContent=String(v);return e.innerHTML.replace(/"/g,'&quot;');}
 async function request(path,p){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});const data=await r.json();if(!r.ok)throw Error(data.error||'Preview request failed');return data;}
 const all=table=>request('/api/read',{table}),client={rpc:(name,p)=>request('/api/save',{name,p})};
 all('tally_stock_sources').then(rows=>{for(const row of rows){const button=document.createElement('button');button.textContent=row.godown;button.onclick=()=>openGodownMapping(row.godown);document.getElementById('godowns').append(button);}}).catch(e=>document.getElementById('error').textContent=e.message);
 `;
 let origin;
 const server=createServer(async(req,res)=>{
  const send=(status,body,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'"});res.end(type==='application/json'?JSON.stringify(body):body);};
  if(req.headers.host!==new URL(origin).host)return send(403,{error:'Host rejected'});
  try{
   if(req.method==='GET'){
    if(req.url==='/')return send(200,html,'text/html');
    if(req.url==='/preview.js')return send(200,js,'text/javascript');
    if(['/tally-stock-review.js','/style.css'].includes(req.url))return send(200,readFileSync(new URL('..'+req.url,import.meta.url),'utf8'),req.url.endsWith('.css')?'text/css':'text/javascript');
    return send(404,{error:'Not found'});
   }
   if(req.method!=='POST'||req.headers.origin!==origin||req.headers['content-type']!=='application/json')return send(403,{error:'Origin or content type rejected'});
   let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)return send(413,{error:'Too large'});}
   const input=JSON.parse(body);
   if(req.url==='/api/read'){
    const queries={inventory_locations:'select id,name,active from inventory_locations',godown_mapping_reviews:'select id,source_godown,version,location_id,reason from godown_mapping_reviews',tally_stock_sources:'select godown from tally_stock_sources order by godown'};
    if(!queries[input.table])return send(400,{error:'Table unavailable'});return send(200,(await db.query(queries[input.table])).rows);
   }
   if(req.url==='/api/save'&&input.name==='save_godown_mapping_review'){
    const p=input.p;try{const result=await db.query('select * from save_godown_mapping_review($1,$2,$3,$4,$5)',[p.p_id,p.p_godown,p.p_expected_version,p.p_location_id,p.p_reason]);return send(200,{data:result.rows[0]});}catch(e){return send(200,{error:{message:e.message}});}
   }
   send(404,{error:'Not found'});
  }catch(e){send(400,{error:e.message});}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
 origin='http://127.0.0.1:'+server.address().port;
 return {url:origin+'/',close:async()=>{await new Promise(resolve=>server.close(resolve));await db.close();}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const p=await startPreview();console.log(p.url);}
