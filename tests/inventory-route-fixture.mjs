// Local-only route smoke fixture. No Supabase, credentials or business data.
// Run with node; open the printed URL, reload, visit Clients, then browser Back.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const initialization=app.slice(0,app.indexOf('let orgIndex='));
const profiles=readFileSync(new URL('../client-profile-pages.js',import.meta.url),'utf8');
const boot=`me={user_id:'fictional-route-test'};
function render(){document.querySelector('h1').textContent=view==='inventory'?'Inventory fixture':'Client fixture'}
render();`;
const pages=new Map([
 ['/', ['text/html', '<!doctype html><html><head><title>Isolated inventory route check</title></head><body><p>Disposable route test — no live data</p><a href="#/clients">Clients</a> <a href="#/inventory">Inventory</a><h1>Loading</h1><script src="/init.js"></script><script src="/profiles.js"></script><script src="/boot.js"></script></body></html>']],
 ['/init.js',['text/javascript',initialization]],['/profiles.js',['text/javascript',profiles]],['/boot.js',['text/javascript',boot]]
]);
const server=createServer((req,res)=>{
 const page=pages.get(req.url);
 res.writeHead(page?200:404,{'Content-Type':page?.[0]||'text/plain','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'"});
 res.end(page?.[1]||'Not found');
});
server.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}/#/inventory`));
