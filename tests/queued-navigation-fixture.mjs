// Disposable loopback browser fixture: real navigation/run handlers, no backend.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const init=app.slice(0,app.indexOf('let orgIndex='));
const actions=app.slice(app.indexOf('async function run(fn)'),app.indexOf('(async()=>{const cfg='));
const nav=readFileSync(new URL('../workspace-navigation.js',import.meta.url),'utf8');
const state=`me={user_id:'fictional',role:'owner'};
let inventorySection='stock',serviceSection='forms',salesSection='delivery',salesEditing='',personalSection='event',personalPage=0;
function message(text){document.querySelector('#notice').textContent=text}
function render(){document.querySelector('#screen').textContent=view+' / '+(view==='inventory'?inventorySection:view==='service'?serviceSection:'');}
function goProfile(){view='contacts';render()}`;
const boot=`let finish,fail;
document.querySelector('#start').onclick=event=>{event.stopPropagation();if(busy)return;document.querySelector('#status').textContent='Operation pending';run(()=>new Promise((resolve,reject)=>{finish=resolve;fail=reject})).then(()=>{document.querySelector('#status').textContent='Operation finished'})};
document.querySelector('#finish').onclick=event=>{event.stopPropagation();finish?.()};
document.querySelector('#fail').onclick=event=>{event.stopPropagation();fail?.(Error('Fixture save rejected'))};render();`;
const html='<!doctype html><html><head><meta charset="utf-8"><title>Queued navigation fixture</title></head><body><header>Disposable fixture: no live data</header><nav id="nav"></nav><main><h1 id="screen"></h1><p id="notice" role="status"></p><p id="status">Idle</p><button id="start">Start simulated save</button><button id="finish">Complete simulated save</button><button id="fail">Reject simulated save</button><form id="editForm" hidden></form><button id="closeEditor" hidden>Close</button></main><script src="/init.js"></script><script src="/state.js"></script><script src="/nav.js"></script><script src="/actions.js"></script><script src="/boot.js"></script></body></html>';
const pages=new Map([['/',html],['/init.js',init],['/state.js',state],['/nav.js',nav],['/actions.js',actions],['/boot.js',boot]]);
const server=createServer((req,res)=>{const body=pages.get(req.url);res.writeHead(body?200:404,{'Content-Type':req.url==='/'?'text/html; charset=utf-8':'text/javascript','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'"});res.end(body||'')});
server.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}/`));
