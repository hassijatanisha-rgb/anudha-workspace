'use strict';

// How to use: task guides written for staff. **Bold** marks a button or menu item; tests check each one exists on
// a screen. screens lists the views (view or view:section) a guide belongs to, so the How to use button can open the
// guides for the screen the person is on. owner:true guides are shown only to the owner.
const howToRoles=[['all','All'],['everyone','Everyone'],['sales','Sales'],['accounts','Accounts'],['stores','Packing & delivery'],['service','Service'],['owner','Owner']];
const howToTopics=[
 {id:'start',role:'everyone',title:'Sign in and find your way around',screens:['contacts'],steps:[
  'Sign in with your employee ID (your name, for example jagroop) and your password.',
  'The first time you sign in, choose your own password. You can change it later with **Change password** at the top of the page.',
  'Use the menu on the left to move between pages.',
  'Open **To-do tasks · urgent first** every morning. Work that other people have sent to you is at the top.',
  'Stuck? Press **How to use** at the top of any page to see the guide for that page.']},
 {id:'todo',role:'everyone',title:'Do the work sent to you and pass it on',screens:['personal:task'],steps:[
  'Open **To-do tasks · urgent first**. Work sent to you is listed under **Work handed to me**, oldest first.',
  'Press **Open** to go straight to the order or job.',
  'Do your part. Then press **Mark my step done**. The order moves on to the next person by itself.',
  'If you cannot finish on time, press **Report delay**, write the reason and choose the new date. The sender and the owner can see it.',
  'To send work to someone yourself, open the order and press **Hand to next person**. Choose the person and say what they must do.']},
 {id:'inquiry',role:'sales',title:'Record a phone call, email or walk-in',screens:['leads:inquiries'],steps:[
  'Open **Inquiries** and press **New inquiry**.',
  'Write who called, what they want and how to reach them. They do not need to be in the client list yet.',
  'Press **Save**.',
  'Press **Pass to sales as lead** and choose the salesperson who will follow it up.']},
 {id:'lead',role:'sales',title:'Follow up a lead',screens:['leads:pipeline'],steps:[
  'Open **Lead / Opportunity**. Overdue follow-ups are at the top.',
  'Call the customer and write down what was agreed and the next follow-up date.',
  'When they want a quote, press **Create Pro forma**. The client is filled in for you.',
  'When they buy, press **Mark won** and choose the Pro forma. If they do not, press **Mark lost** and give the reason.']},
 {id:'proforma',role:'sales',title:'Make a Pro forma and send it to accounts',screens:['sales:new','sales:proformas'],steps:[
  'Open **Create Pro forma**.',
  'Choose the client, the contact person and the items with their quantities and prices. Press **Save Pro forma invoice**.',
  'Press **Print / PDF** to print it or save it as a PDF for the customer. You can still change a draft with **Edit draft**.',
  'After you send it, press **Record sent to client**. It is now locked so the customer and the ERP see the same copy.',
  'When the customer accepts, press **Submit to accounting** and type their LPO or acceptance reference.',
  'Find any Pro forma under **Current orders**. Each one has a coloured tag: Draft, Revised, Sent to customer, Waiting approval, Approved · in delivery, Delivered or Cancelled / rejected. Press a tag button at the top to show only those, or search by PF number, client or LPO.']},
 {id:'tally-send',role:'accounts',title:'Send an accepted order to TallyPrime',screens:['sales:proformas','tallyinvoices'],steps:[
  'Open **Current orders** and find the accepted Pro forma.',
  'Press **Send to Tally**.',
  'Check the customer name and each item name. They must be spelled exactly as in TallyPrime. The ERP remembers them for next time.',
  'Press **Save**. A file downloads to your computer.',
  'In TallyPrime choose Import Data, then Vouchers, and pick the downloaded file. The order appears as a Sales Order.',
  'Make the tax invoice in TallyPrime from that Sales Order. Keep the Pro forma number (for example PF-2026-000012) in Order No.']},
 {id:'tally-upload',role:'accounts',title:'Bring Tally invoices into the ERP',screens:['tallyinvoices'],steps:[
  'In TallyPrime, export the Day Book or Sales Register as XML.',
  'Open **Tally invoices** and press **Upload Tally XML export**. Choose the file.',
  'Invoices with a Pro forma number link to their order by themselves, and packing is sent to the next person.',
  'Anything the ERP could not link is under the needs linking list. Press **Link to Pro forma** and choose the order, or press **Not an ERP order**.']},
 {id:'delivery',role:'stores',title:'Pack and deliver an order',screens:['sales:delivery'],steps:[
  'Open **Delivery progress**. Each order shows the step it is on and who has it.',
  'When the order reaches you, press the button for the step you have just finished: **Send to downstairs sales**, **Start packing**, **Mark ready for delivery** or **Mark out for delivery**.',
  'After the customer signs, press **Record signed delivery note**.',
  'Press **Upload / view documents** to keep a photo or scan of the signed note with the order.',
  'A machine delivery creates an installation job for the service team by itself.']},
 {id:'pending',role:'sales',title:'Customer wants more than we have',screens:['pending'],steps:[
  'Open **Pending stock orders** and press **New pending order**.',
  'Choose the client and product and type the quantity still needed. Press **Save pending order**.',
  'The list shows when the stock has arrived, so you can call the customer back.',
  'To buy it in, press **Order from supplier**. When the customer has received it, press **Mark fulfilled**.']},
 {id:'purchase',role:'sales',title:'Buy from a supplier',screens:['purchasing:orders','purchasing:suppliers'],steps:[
  'Open **Purchasing** and press **New purchase request**. Choose the supplier and press **Add item** for each product.',
  'The owner checks it and presses **Approve purchase**.',
  'Send the LPO to the supplier, then press **Place order with supplier** and type the LPO number.',
  'When the goods arrive, press **Goods arrived — close** and type the delivery note number.',
  'New suppliers are added under **Suppliers** with **New supplier**.']},
 {id:'install',role:'service',title:'Install a machine',screens:['service:installations'],steps:[
  'Open **Machines to install**. Every machine on a signed delivery note is listed here.',
  'Press **Assign engineer** and **Set work date**.',
  'On the day, press **Start on-site work**.',
  'When you finish, press **Complete official report**. Fill in the machine details, who was trained and both signatures.',
  'Press **Print official report** for the customer copy. The next maintenance visit is added to the schedule by itself.']},
 {id:'service',role:'service',title:'Record a repair or service visit',screens:['service:schedule'],steps:[
  'Open **Service & maintenance schedule**. Planned visits are listed by date.',
  'For a repair that was not planned, press **Create service job**.',
  'Press **Assign engineer**, **Set work date** and, on the day, **Start on-site work**.',
  'When you finish, press **Complete official report** with the fault, work done, parts and signatures.',
  'Blank forms to print are under **Service forms**.']},
 {id:'clients',role:'everyone',title:'Find or fix a client or contact',screens:['contacts','review'],steps:[
  'Open **Client accounts** and type part of the client name or location.',
  'Yellow means one detail needs fixing. Red means several do.',
  'Press **Fix contacts** to see every contact that needs fixing, most urgent first.',
  'Correct the details and save. Press **Mark complete** when you have checked a contact.',
  'Deleted contacts go to **Deleted items**. Nothing is lost.']},
 {id:'products',role:'everyone',title:'Find a product or check stock',screens:['inventory:catalog','inventory:stock'],steps:[
  'Open **Product search** and type part of the name, company or stock code.',
  'Yellow products have one detail to check, red products have several.',
  'Open **Stock & availability** to see how much is in each godown.']},
 {id:'move-stock',role:'stores',title:'Move stock between godowns',screens:['inventory:transfers'],steps:[
  'Open **Move stock**.',
  'Choose what to move, where it goes, how many cartons and when it should arrive. Press **Request transfer**.',
  'When it leaves, press **Dispatch sealed cartons**.',
  'At the other godown, count it and press **Receive or quarantine**.']},
 {id:'count',role:'stores',title:'Count stock on the shelf',screens:['stockcount:count'],steps:[
  'Open **Stock count** and choose your godown.',
  'Type part of the product name, company, model or AN code and pick the product.',
  'Type the quantity, unit and condition you see, then press **Save count**.',
  'If the product is not in the list, press **Product is not on the list** and describe it.',
  'A wrong count cannot be changed. Press **Void** and count it again.']},
 {id:'count-review',role:'owner',owner:true,title:'Start and check a stock count',screens:['stockcount:review'],steps:[
  'Open **Review stock counts** and press **Start a count**.',
  'As counts come in, press **Accept** or **Reject** for each one.',
  'When every godown is done, press **Close this count**.']},
 {id:'calendar',role:'everyone',title:'Your calendar, tasks and notes',screens:['personal:event','personal:note'],steps:[
  'Open **My calendar** for meetings and appointments, or **My notes & reminders** for notes.',
  'Press the add button at the top, fill it in and save.',
  'Green entries are company events everyone can see. White entries are only yours.']},
 {id:'reports',role:'everyone',title:'See who did what',screens:['reports'],steps:[
  'Open **Reports**.',
  'Choose the week or month and press **Show report**.',
  'The report shows each person’s finished steps, average time per step and anything overdue.',
  'Press **Download CSV** to open it in Excel.']},
 {id:'staff',role:'owner',owner:true,title:'Add a staff member',screens:['staff'],steps:[
  'Open **Staff** and press **Add employee**.',
  'Type the full name and a temporary password. The login is made from the name, for example jagroop.',
  'Give the person their login and temporary password. They choose their own password the first time.',
  'Set their **Department** so reports group them correctly.',
  'If someone forgets their password, press **Reset password** next to their name.',
  'Under **Who does each step**, choose who receives each step of an order automatically.']},
 {id:'text',role:'everyone',title:'Make the text bigger',screens:['settings'],steps:[
  'Open **My settings**.',
  'Under **Text size**, choose a larger size. It is saved on this computer or phone.']},
 {id:'problems',role:'everyone',title:'Something went wrong',screens:[],steps:[
  'If it says someone else changed the record, press **Refresh**, check the latest details and make your change again.',
  'Nothing is saved until you press **Save**.',
  'Menu items marked Not connected yet cannot be used yet.',
  'If you cannot open a page you need, ask the owner to check your access.']}
];
let howToRole='all',howToQuery='',howToFocus='',howToWalk=null;

function howToScreenKey(){
 const sections={sales:typeof salesEditing!=='undefined'&&salesEditing==='new'?'new':typeof salesSection!=='undefined'?salesSection:'',service:typeof serviceSection!=='undefined'?serviceSection:'',inventory:typeof inventorySection!=='undefined'?inventorySection:'',personal:typeof personalSection!=='undefined'?personalSection:'',leads:typeof leadSection!=='undefined'?leadSection:'',purchasing:typeof purchaseSection!=='undefined'?purchaseSection:'',stockcount:typeof countTab!=='undefined'?countTab:''};
 const section=sections[view];return section?`${view}:${section}`:view;
}
function howToForScreen(topic,key){const base=String(key).split(':')[0];return topic.screens.includes(key)||topic.screens.includes(base)}
function howToVisible(topic){return !topic.owner||me?.role==='owner'}
function howToMatches(topic,query,role){
 if(role&&role!=='all'&&topic.role!==role)return false;
 const words=String(query||'').toLowerCase().split(/\s+/).filter(Boolean);
 const text=`${topic.title} ${topic.steps.join(' ')}`.toLowerCase().replaceAll('*','');
 return words.every(word=>text.includes(word));
}
function howToStep(step){return esc(step).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')}
function howToRoleName(role){return howToRoles.find(([key])=>key===role)?.[1]||''}
function howToTopicCard(topic,open){
 return `<details class="card howto-topic"${open?' open':''}><summary><span>${esc(topic.title)}</span><small>${esc(howToRoleName(topic.role))}</small></summary><ol class="howto-steps">${topic.steps.map(step=>`<li>${howToStep(step)}</li>`).join('')}</ol>${topic.screens.length?`<div class="actions"><button type="button" data-howto-walk="${topic.id}">Walk me through it</button></div>`:''}</details>`;
}
function guide(){
 const visible=howToTopics.filter(howToVisible),focus=howToFocus?visible.filter(topic=>howToForScreen(topic,howToFocus)):[];
 const shown=visible.filter(topic=>howToMatches(topic,howToQuery,howToRole)&&!focus.includes(topic));
 $('#content').innerHTML=`<section class="howto"><div class="heading"><div><small>HELP</small><h1>How to use</h1><p class="muted">Choose what you want to do. Each guide lists the steps in order. Press Walk me through it to follow the steps on the real page.</p></div></div>
 ${focus.length?`<section class="howto-here"><h2>For the page you were on</h2>${focus.map(topic=>howToTopicCard(topic,true)).join('')}</section>`:''}
 <label class="howto-search"><span>What do you want to do?</span><input id="howToSearch" type="search" value="${esc(howToQuery)}" placeholder="For example: pro forma, Tally, delivery, password" autocomplete="off"></label>
 <div class="tabs" role="group" aria-label="Show guides for">${howToRoles.filter(([key])=>key!=='owner'||me?.role==='owner').map(([key,label])=>`<button type="button" data-howto-role="${key}"${key===howToRole?' class="active" aria-pressed="true"':' aria-pressed="false"'}>${esc(label)}</button>`).join('')}</div>
 <div class="howto-list">${shown.map(topic=>howToTopicCard(topic,Boolean(howToQuery))).join('')||'<p class="empty">No guide matches. Try a shorter word, or ask the owner.</p>'}</div></section>`;
 $('#howToSearch').oninput=event=>{howToQuery=event.target.value;renderSearchPreservingPosition(event.target,guide)};
}
function howToGo(screen){
 const [target,section]=screen.split(':');
 const button=document.querySelector(section?`#nav [data-view="${target}"][data-workspace-section="${section}"]`:`#nav [data-view="${target}"]`)||document.querySelector(`#nav [data-view="${target}"]`);
 if(button)button.click();
}
function howToWalkPanel(){
 let panel=document.querySelector('#howToWalk');
 if(!howToWalk){panel?.remove();return;}
 if(!panel){panel=document.createElement('aside');panel.id='howToWalk';panel.className='howto-walk';panel.setAttribute('aria-live','polite');document.body.append(panel);}
 const topic=howToTopics.find(x=>x.id===howToWalk.id),index=howToWalk.step,last=index===topic.steps.length-1;
 panel.innerHTML=`<div class="heading"><small>STEP ${index+1} OF ${topic.steps.length}</small><button type="button" data-howto-close aria-label="Close guide">×</button></div><h2>${esc(topic.title)}</h2><p>${howToStep(topic.steps[index])}</p><div class="actions"><button type="button" data-howto-back${index===0?' disabled':''}>Back</button>${last?'<button type="button" data-howto-close>Done</button>':'<button type="button" data-howto-next>Next</button>'}</div>`;
}
let howToOpening=false;
function openHowToUse(){
 if(typeof busy!=='undefined'&&busy)return;
 const focus=view==='guide'?howToFocus:howToScreenKey(),button=document.querySelector('#nav [data-view="guide"]');
 howToOpening=true;try{if(button)button.click();else{view='guide';guide();}}finally{howToOpening=false;}
 howToFocus=focus;howToQuery='';howToRole='all';if(view==='guide')guide();
}
document.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button)return;
 // Opening How to use from the menu shows every guide; the header button (openHowToUse) shows this page's guides first.
 if(!howToOpening&&button.matches('#nav [data-view="guide"]')){howToFocus='';howToQuery='';}
 if(button.dataset.howtoRole){howToRole=button.dataset.howtoRole;guide();return;}
 if(button.dataset.howtoWalk){const topic=howToTopics.find(x=>x.id===button.dataset.howtoWalk);if(!topic)return;howToWalk={id:topic.id,step:0};howToGo(topic.screens[0]);howToWalkPanel();return;}
 if(!howToWalk)return;
 if(button.hasAttribute('data-howto-close')){howToWalk=null;howToWalkPanel();}
 else if(button.hasAttribute('data-howto-next')){howToWalk.step++;howToWalkPanel();}
 else if(button.hasAttribute('data-howto-back')){howToWalk.step=Math.max(0,howToWalk.step-1);howToWalkPanel();}
});
