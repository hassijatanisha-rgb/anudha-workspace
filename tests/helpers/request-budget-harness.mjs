// Opens the built app (index.html + app.bundle.js) in Chrome with a fake, empty database and counts what each main
// page asks the database for. Nothing reaches the network: every request is answered here.
//
// Rounds: requests are held until none has arrived for `quiet` ms, then all held requests are answered together.
// A request sent because an earlier answer arrived therefore lands in a later round, so the number of rounds is the
// number of waits in a row the page makes (each costs ~310 ms from Tanzania, whatever its size).
import {readFileSync} from 'node:fs';
import {dirname,resolve,extname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const api='https://udncxdbrbaptcefvjucj.supabase.co';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
const userId='00000000-0000-4000-8000-0000000000aa';
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');

export async function launch(){
 const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
 return chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
}

// Answers for the few calls whose shape decides whether the app opens at all; everything else is empty.
const rpcAnswers={accounting_access:true,two_step_setup_required:false,staff_accounting_access:[],
 packing_queue_board:()=>({now:new Date().toISOString(),amber_minutes:20,overdue_minutes:30,can_release:true,mine:null,packing:[],waiting:[],coming:[]}),
 get_my_staff_profile:()=>({user_id:userId,name_version:0,display_name:'Owner',phone:null,contact_email:null,role:'owner',department:'Management'}),
 acc_trial_balance:[],acc_profit_and_loss:[],acc_balance_sheet:[]};
function answer(request){
 const url=new URL(request.url()),path=url.pathname,method=request.method();
 const json=(body,status=200,headers={})=>({status,contentType:'application/json',headers:{'content-range':'*/0',...headers},body:JSON.stringify(body)});
 if(path==='/auth/v1/user')return json(user());
 if(path.startsWith('/auth/v1/'))return json({});
 if(path.startsWith('/storage/v1/'))return json([]);
 const rpc=path.match(/^\/rest\/v1\/rpc\/([\w]+)/);
 if(rpc){const value=rpcAnswers[rpc[1]];return json(typeof value==='function'?value():value===undefined?null:value);}
 const table=path.match(/^\/rest\/v1\/([\w]+)/)?.[1];
 const single=/vnd\.pgrst\.object/.test(request.headers()['accept']||'');
 if(table==='staff'&&single)return json({user_id:userId,role:'owner',active:true,department:'Management',access:null});
 if(single)return json({code:'PGRST116',message:'JSON object requested, multiple (or no) rows returned',details:'The result contains 0 rows'},406);
 if(method==='HEAD')return {status:200,headers:{'content-range':'*/0'},body:''};
 return json([]);
}
function user(){return {id:userId,aud:'authenticated',role:'authenticated',email:'owner@staff.anudha.com',app_metadata:{provider:'email'},user_metadata:{},factors:[],created_at:'2026-01-01T00:00:00Z'}}
function session(){
 const now=Math.floor(Date.now()/1000);
 const token=`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:userId,role:'authenticated',aal:'aal1',amr:[{method:'password',timestamp:now}],exp:now+36000,session_id:'s'})}.sig`;
 return {access_token:token,token_type:'bearer',expires_in:36000,expires_at:now+36000,refresh_token:'refresh',user:user()};
}

function summary(name,requests){return {hash:name,requests,count:requests.length,rounds:requests.reduce((n,r)=>Math.max(n,r.round),0)};}
// One browser page with the app signed in as the owner on the Dashboard, ready to open other pages.
export async function openApp(browser,{quiet=100}={}){
 // A new context each time: empty list cache and storage.
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const log=[];let held=[],round=0,timer=null;
 const flush=()=>{timer=null;round++;const now=held;held=[];for(const {route,request} of now){log.push({round,method:request.method(),path:new URL(request.url()).pathname.replace(/^\/rest\/v1\//,''),query:new URL(request.url()).search});route.fulfill(answer(request)).catch(()=>{});}};
 await page.route('**/*',route=>{
  const url=route.request().url();
  if(url.startsWith(api)){held.push({route,request:route.request()});clearTimeout(timer);timer=setTimeout(flush,quiet);return;}
  if(url.startsWith('https://erp.test/')){
   const file=decodeURIComponent(new URL(url).pathname.slice(1))||'index.html';
   try{return route.fulfill({status:200,contentType:types[extname(file)]||'application/octet-stream',body:readFileSync(root+file)});}catch{return route.fulfill({status:404,body:''});}
  }
  return route.abort();
 });
 await page.addInitScript(([key,value])=>{try{sessionStorage.setItem(key,value)}catch{}},['sb-udncxdbrbaptcefvjucj-auth-token',JSON.stringify(session())]);
 await page.goto('https://erp.test/index.html');
 const idle=async()=>{
  // Settled once nothing has been held or answered for 400 ms.
  let last=-1,stable=0;
  for(let i=0;i<300&&stable<8;i++){await page.waitForTimeout(50);const n=log.length+held.length;if(n===last&&!held.length)stable++;else{stable=0;last=n;}}
 };
 await idle();
 // Signing in up to the Dashboard drawn with its numbers.
 const boot=summary('boot',log.slice());
 // The client, contact and product lists every page but the Dashboard needs: loaded once here, as after sign-in.
 await page.evaluate(async()=>{if(!listsLoaded)await (listsLoading||loadLists())});
 await idle();
 // Requests made while opening one page: count and rounds (waits in a row).
 async function measure(hash){
  // The bell checks for news on a page change at most every 10 s, whatever the page; it is measured on its own.
  await page.evaluate(()=>{bellLastRefresh=Date.now()+3600000});
  const fromLog=log.length,fromRound=round;
  await page.evaluate(hash=>{if(hash==='bell')return void refreshNotificationBell(true);const button=navButtonFor(hash);if(!button)throw Error('No menu item for '+hash);button.hidden=false;button.click()},hash);
  await idle();
  return {...summary(hash,log.slice(fromLog).map(r=>({...r,round:r.round-fromRound}))),text:(await page.evaluate(()=>document.querySelector('#content').innerText)).slice(0,120),notice:await page.evaluate(()=>document.querySelector('#notice').className.includes('error')?document.querySelector('#notice').textContent:'')};
 }
 const pages=await page.evaluate(()=>[...document.querySelectorAll('#nav [data-view]')].map(b=>({hash:navHash(b),label:b.textContent.trim()})));
 return {page,errors,measure,pages,log,boot};
}
