'use strict';

// How to use: task guides written for staff. **Bold** marks a button or menu item; tests check each one exists on
// a screen. screens lists the views (view or view:section) a guide belongs to, so the How to use button can open the
// guides for the screen the person is on. owner:true guides are shown only to the owner; head:true guides to the owner
// and department heads.
const howToRoles=[['all','All'],['everyone','Everyone'],['sales','Sales'],['accounts','Accounts'],['stores','Packing & delivery'],['service','Service'],['owner','Owner']];
const howToTopics=[
 {id:'start',role:'everyone',title:'Sign in and find your way around',screens:['contacts'],steps:[
  'Sign in with your employee ID (your name, for example jagroop) and your password.',
  'The first time you sign in, choose your own password. You can change it later with **Change password** at the top of the page.',
  'Use the menu on the left to move between pages.',
  'Open **My tasks** every morning. Tasks and order steps given to you are there, most urgent first.',
  'Stuck? Press **How to use** at the top of any page to see the guide for that page.']},
 {id:'todo',role:'everyone',title:'Do your tasks and give tasks to others',screens:['personal:task'],steps:[
  'Open **My tasks**. Tasks given to you are under To do: red is Do now, yellow is Urgent, grey is Normal. Late tasks have a red edge.',
  'When you finish a task, press **Mark done**.',
  'To give someone a task, press **+ New task**. Write what needs doing, choose who does it, how urgent it is and when it is due, then press **Save**. You can also give a task to yourself.',
  'Order steps sent to you are under **Work handed to me**. Press **Open** to go to the order, then **Mark my step done** when your part is finished.',
  'If you cannot finish an order step on time, press **Report delay**, write the reason and choose the new date.']},
 {id:'inquiry',role:'sales',title:'Record a phone call, message or walk-in',screens:['leads:leads'],steps:[
  'Open **Leads** and press **+ New inquiry**.',
  'Step 1: choose A client we already have, or Someone new and type their name and phone number.',
  'Step 2: write in a few words what they need, for example: price for 2 centrifuges.',
  'Step 3: choose how they contacted us.',
  'Step 4: choose the salesperson and the follow-up date if you know them, then press **Save inquiry**.',
  'If you left the salesperson empty, press **Pass to sales as lead** later and choose one.']},
 {id:'lead',role:'sales',title:'Follow up a lead',screens:['leads:leads'],steps:[
  'Open **Leads**. Late follow-ups are at the top. Press **Mine** to see only yours.',
  'Call the customer, then press **Edit** to write what was agreed and the next follow-up date.',
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
  'Anything the ERP could not link is under the needs linking list. Press **Link to Pro forma** and choose the order, or press **Not from a Pro forma**.']},
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
  'Open **Purchasing** and press **New purchase request**.',
  'Choose the supplier, for example Polymed. Then type each item and its quantity. Press **Add item** for more lines.',
  'Press **Send for approval**. The owner checks it and presses **Approve purchase**.',
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
 {id:'calendar',role:'everyone',title:'Your notes, reminders and calendar',screens:['personal:note','personal:event'],steps:[
  'Open **My notes & reminders**. Only you can see them.',
  'Press **+ Note** for something to keep, for example: fill out the service form for Aga Khan.',
  'Press **+ Reminder** for something with a time, for example: call Dr Mushi at 10:00. Tick Done when it is done.',
  'Open **My calendar** for meetings. Green entries are company events everyone can see.']},
 {id:'website-requests',role:'sales',title:'Answer a website inquiry or complaint',screens:['requests:inquiries','requests:complaints'],steps:[
  'Open **Website inquiries** or **Complaints**. New requests are at the top, marked New.',
  'Press **Take it** so everyone knows you are handling it, or **Give to…** to pass it to a colleague.',
  'If the request shows it was not confirmed automatically, press **Send confirmation on WhatsApp** and send the message that opens.',
  'Call or WhatsApp the customer. For an inquiry, press **Open lead** and follow it up in Leads.',
  'When it is sorted out, press **Mark resolved** and write what was done. The customer can check the progress with their request number.']},
 {id:'travel',role:'everyone',title:'Ask to travel to a client or meeting',screens:['travel'],steps:[
  'Open **Travel requests** and press **+ New travel request**.',
  'Tick everyone who is going, choose the client (or type another place), the reason and who you are meeting.',
  'Choose when you leave and when you are back. The trip length is shown for you. Press **Save**.',
  'The owner presses **Approve** or **Decline**. Everyone can see who is away under Upcoming and away now.',
  'When you are back, press **Trip done** and write how it went.']},
 {id:'reports',role:'everyone',title:'See reports',screens:['reports'],steps:[
  'Open **Reports**.',
  'Choose the week or month and press **Show report**.',
  'The report shows each person’s finished steps, average time per step and anything overdue.',
  'Press **Download CSV** to open it in Excel.']},
 {id:'staff',role:'owner',owner:true,title:'Add a staff member or department head',screens:['staff'],steps:[
  'Open **Staff** and press **Add employee**.',
  'Type the full name. The login is made from the name, for example jagroop.hassija, and a temporary password is shown once.',
  'Choose the **Role**: Staff, or **Department head** for someone who will add and manage their own team.',
  'Choose the **Department**. The usual parts for that department are ticked; change the ticks under **What this person can use**.',
  'Give the person their login and temporary password. They choose their own password the first time.',
  'To change what someone can use later, press **Change access** next to their name. Press **Switch off** when someone leaves.',
  'Under **Who does each step**, choose who receives each step of an order automatically.']},
 {id:'staff-head',role:'everyone',head:true,title:'Add your team (department heads)',screens:['staff'],steps:[
  'Open **Staff**. Your department is at the top; other departments are listed below for reference.',
  'Press **+ Add employee** and type the person’s full name. They join your department.',
  'Under **What this person can use**, tick the parts they need. Greyed-out parts are ones you do not have yourself; ask the owner.',
  'Press **Create login**. Give them the login and temporary password shown; they choose their own password at first sign-in.',
  'Press **Change access** next to a name to change what they can use, or **Reset password** if they forget it.',
  'When someone leaves, press **Switch off**. Their records stay and nobody can sign in with their login.']},
 {id:'two-step',role:'everyone',title:'Turn on two-step sign-in',screens:['settings'],steps:[
  'Install Google Authenticator or Microsoft Authenticator on your phone.',
  'Open **My settings** and, under **Two-step sign-in**, press **Turn on**.',
  'In the app, add an account and scan the picture. Type the 6 numbers it shows and press **Confirm**.',
  'From now on, after your password you type the 6 numbers from the app.',
  'Lost your phone? Ask your department head or the owner to press **Reset two-step** next to your name on the Staff page.']},
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
function howToVisible(topic){if(topic.head)return me?.role==='owner'||me?.role==='head';return !topic.owner||me?.role==='owner'}
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
