'use strict';
// Per-person display settings (this browser only) and an honest list of outside connections.
// zoom, not root font-size: the stylesheets use fixed pixel sizes, which zoom scales together with spacing.
const textSizes={normal:{label:'Normal',scale:'1'},large:{label:'Large',scale:'1.15'},xlarge:{label:'Extra large',scale:'1.3'}};
// Status only changes here after a real provider is configured and tested; nothing is simulated.
const externalConnections=[
 {name:'Email notifications',status:'Not connected',detail:'Work sent to you and stock-arrival notices show inside the ERP. No emails are sent yet.'},
 {name:'WhatsApp messages',status:'Not connected',detail:'No WhatsApp provider has been set up. No messages are sent.'},
 {name:'Tally',status:'Not connected',detail:'Use Send to Tally on an accepted Pro forma, and upload invoices under Tally invoices. A direct connection is planned.'},
 {name:'VFD / tax invoice device',status:'Not connected',detail:'Tax invoices are made in TallyPrime.'}
];
function readTextSize(){try{const value=localStorage.getItem('anudha.textSize');return textSizes[value]?value:'normal';}catch{return 'normal';}}
function applyTextSize(size=readTextSize()){document.documentElement.style.zoom=(textSizes[size]||textSizes.normal).scale;document.documentElement.dataset.textSize=textSizes[size]?size:'normal';}
function saveTextSize(size){if(!textSizes[size])throw Error('Choose a text size from the list.');try{localStorage.setItem('anudha.textSize',size);}catch{}applyTextSize(size);}
function settingsWorkspace(){
 syncWorkspaceNavigation();
 const size=readTextSize();
 $('#content').innerHTML=`<section class="settings-workspace"><div class="heading"><div><small>SYSTEM</small><h1>My settings</h1></div></div><section class="card"><h2>Text size</h2><p class="muted">Makes every page easier to read on this computer or phone.</p><div class="text-size-options" role="radiogroup" aria-label="Text size">${Object.entries(textSizes).map(([key,option])=>`<label><input type="radio" name="textSize" value="${key}" ${key===size?'checked':''}> <span class="text-size-sample text-size-${key}">${option.label}</span></label>`).join('')}</div></section><section class="card"><h2>My account</h2><p>${esc(employeeName(me.user_id))} · ${esc(me.role)}</p><button type="button" id="settingsPassword">Change password</button></section><section class="card"><h2>Language</h2><p>English. Kiswahili, Chinese and Hindi have been requested but are not available yet.</p></section><section class="card"><h2>Connections to other systems</h2><ul class="connection-list">${externalConnections.map(c=>`<li><strong>${esc(c.name)}</strong> <span class="tag">${esc(c.status)}</span><br><small>${esc(c.detail)}</small></li>`).join('')}</ul></section></section>`;
 document.querySelectorAll('[name="textSize"]').forEach(input=>input.onchange=()=>{saveTextSize(input.value);message(`Text size set to ${textSizes[input.value].label.toLowerCase()} on this device.`);});
 $('#settingsPassword').onclick=()=>run(async()=>openChangePassword());
}
applyTextSize();
