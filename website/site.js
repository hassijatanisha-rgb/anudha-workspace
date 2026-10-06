'use strict';
// Public website forms. Each request goes to the website-request server function, which saves it in the ERP and
// returns a request number. No customer data is kept in the browser.
(function(){
 const config=window.ERP_CONFIG||{};
 const endpoint=`${config.url}/functions/v1/website-request`;
 const kindWords={quote:'quote request',inquiry:'question',complaint:'complaint',support:'support request'};
 const statusWords={received:'Received, waiting for our team',in_progress:'Our team is working on it',resolved:'Resolved',closed:'Closed'};
 const confirmationWords={sent:'We have also sent this number to you.',already_received:'We already had this request, so here is the same number.',not_set_up:'Please write this number down or take a screenshot.',failed:'Please write this number down or take a screenshot.'};
 function show(box,html,error){box.className='result'+(error?' error':' ok');box.innerHTML=html;box.scrollIntoView({block:'nearest',behavior:'smooth'});}
 function esc(s){return String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');}
 async function send(body){
  const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',apikey:config.key},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(data.error||'Something went wrong. Please call +255 783 523 777.');
  return data;
 }
 function validate(form){
  const values=Object.fromEntries(new FormData(form));
  if(String(values.message||'').trim().length<2)return 'Tell us how we can help.';
  if(String(values.name||'').trim().length<2)return 'Enter your name.';
  if(!/^\+?[0-9][0-9\s()-]{5,20}$/.test(String(values.phone||'').trim()))return 'Enter a phone number we can reach you on, for example 0712 345 678.';
  if(values.email&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email))return 'Check the email address.';
  return '';
 }
 document.querySelectorAll('.request-form').forEach(form=>form.addEventListener('submit',async event=>{
  event.preventDefault();
  const box=form.querySelector('.result'),button=form.querySelector('[type=submit]');if(button.disabled)return;
  const problem=validate(form);if(problem)return show(box,esc(problem),true);
  button.disabled=true;show(box,'Sending…');
  try{
   const data=await send({action:'submit',...Object.fromEntries(new FormData(form))});
   const whatsapp=`https://wa.me/255763490099?text=${encodeURIComponent(`Hello Anudha Limited, my request number is ${data.request_number}.`)}`;
   show(box,`<strong>Thank you. Your ${esc(kindWords[data.kind]||'request')} has been received.</strong><p>Your request number is <span class="number">${esc(data.request_number)}</span></p><p>${esc(confirmationWords[data.confirmation]||confirmationWords.not_set_up)}</p><p><a class="button" href="${whatsapp}" target="_blank" rel="noopener">Send it to us on WhatsApp</a></p>`);
   form.reset();
  }catch(error){show(box,esc(error.name==='TimeoutError'?'The connection is slow. Please try again or call +255 783 523 777.':error.message),true);}
  finally{button.disabled=false;}
 }));
 const track=document.getElementById('trackForm');
 track?.addEventListener('submit',async event=>{
  event.preventDefault();
  const box=track.querySelector('.result'),values=Object.fromEntries(new FormData(track));
  if(!/^REQ-\d{4}-\d{6}$/i.test(String(values.request_number||'').trim()))return show(box,'Enter the request number, for example REQ-2026-000123.',true);
  if(String(values.phone_end||'').replace(/\D/g,'').length<6)return show(box,'Enter the last 6 digits of the phone you used.',true);
  show(box,'Checking…');
  try{
   const data=await send({action:'track',...values});
   show(box,data.found?`<strong>${esc(data.request_number)}</strong><p>${esc(statusWords[data.status]||data.status)}</p><p class="muted">Received ${esc(new Date(data.received_at).toLocaleDateString())} · last update ${esc(new Date(data.updated_at).toLocaleDateString())}</p>`:'We could not find that request. Check the number and the phone digits.',!data.found);
  }catch(error){show(box,esc(error.message),true);}
 });
})();
