import test from 'node:test';
import assert from 'node:assert/strict';
test('isolated preview serves eight labels and rejects foreign-origin writes',async()=>{
 const {startPreview}=await import('./godown-preview-server.mjs');const preview=await startPreview(0);
 try{
  const root=await fetch(preview.url);assert.equal(root.status,200);assert.match(await root.text(),/Fictional test data/);
  const rows=await fetch(preview.url+'api/read',{method:'POST',headers:{origin:preview.url.slice(0,-1),'content-type':'application/json'},body:JSON.stringify({table:'tally_stock_sources'})});assert.equal((await rows.json()).length,8);
  const bad=await fetch(preview.url+'api/save',{method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json'},body:'{}'});assert.equal(bad.status,403);
  assert.equal((await fetch(preview.url+'config.js')).status,404);
 }finally{await preview.close();}
});
