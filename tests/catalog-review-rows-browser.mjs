import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {sourceManifest} from '../scripts/audit-design-tokens.mjs';
import {cases,openMainPageScenario} from './helpers/main-page-scenarios.mjs';

test('catalogue rows keep review badges and product actions readable on neutral surfaces',async t=>{
 const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
 const fixture=await openMainPageScenario(cases.find(entry=>entry.name==='Products'),'owner');
 const base=fixture.evaluate('catalogRows()[0]');
 fixture.ctx.reviewRows=[
  {...base,id:'neutral',name:'Bench centrifuge',sku:'CF-8',source:{...base.source,company:'Example Instruments',specification:'Eight-position rotor'}},
  {...base,id:'yellow',name:'Digital laboratory balance',sku:'BL-220',source:{...base.source,company:'Example Instruments',specification:''}},
  {...base,id:'red',name:'Optical measurement instrument',sku:'',source:{...base.source,company:'',specification:'Long model reference OPTICAL2500EXTENDEDREFERENCE00014678'}}
 ];
 fixture.evaluate('catalogRender({...catalogResult,rows:reviewRows,total:3,page:0,pages:1})');
 const html=fixture.document.querySelector('#content').innerHTML,detail=fixture.evaluate('catalogProduct(reviewRows[0],reviewRows)');
 const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});t.after(()=>browser.close());
 const page=await browser.newPage({hasTouch:true});await page.route('**/*',route=>route.abort());
 await page.setContent('<div id="workspaceMenuPanel" hidden><nav id="nav" aria-label="Workspace"></nav></div><main><section id="content">'+html+'</section></main>');
 await page.addStyleTag({content:sourceManifest(read('index.src.html')).styles.map(read).join('\n')});
 for(const file of ['product-workbench.js','ui-page-header.js'])await page.addScriptTag({content:read(file)});
 await page.evaluate(()=>{window.run=fn=>fn();window.openWorkspaceRecord=(type,id)=>window.opened=[type,id];bindProductWorkbench();installWorkspacePrimaryAction();});

 for(const [width,scale,theme] of [[320,100,'light'],[390,100,'light'],[320,200,'dark'],[1280,100,'dark']]){
  await page.setViewportSize({width,height:800});await page.emulateMedia({colorScheme:theme});
  await page.evaluate(scale=>{document.documentElement.style.fontSize=scale+'%';window.scrollTo(0,0);},scale);
  const table=page.getByRole('table',{name:'Product details and availability'});
  assert.equal(await table.getByRole('row').count(),4);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(width<=600){
   const toolbar=page.locator('.workspace-page-toolbar'),add=toolbar.getByRole('button',{name:'Add product',exact:true}),refresh=toolbar.getByRole('button',{name:'Refresh data',exact:true});
   const header=await toolbar.boundingBox(),first=await table.locator('tbody tr').first().boundingBox();
   for(const control of [refresh,add]){
    const box=await control.boundingBox();
    assert.ok(box&&box.width>=44&&box.height>=44,`Header action has a touch target at ${width}px / ${scale}%`);
    assert.ok(box.x>=header.x-1&&box.x+box.width<=header.x+header.width+1&&box.y>=header.y-1&&box.y+box.height<=header.y+header.height+1&&box.y+box.height<=first.y,`Header action fits above the products at ${width}px / ${scale}%`);
    const center={x:box.x+box.width/2,y:box.y+box.height/2};
    const id=await control.getAttribute('id');
    await page.evaluate(()=>{window.tappedHeaderControl=null;document.addEventListener('click',event=>{window.tappedHeaderControl=event.target.closest('button')?.id;},{once:true});});
    await page.touchscreen.tap(center.x,center.y);
    assert.equal(await page.evaluate(()=>window.tappedHeaderControl),id,`Initial touch reaches ${id} at ${width}px / ${scale}%`);
   }
  }
  const colours=await table.locator('tbody tr').evaluateAll(rows=>rows.map(row=>[row,...row.cells].map(node=>getComputedStyle(node).backgroundColor)));
  assert.deepEqual(colours[1],colours[0],`Yellow row surfaces at ${width}px`);
  assert.deepEqual(colours[2],colours[0],`Red row surfaces at ${width}px`);
  for(const [id,label] of [['neutral',''],['yellow','Yellow · 1 to fix'],['red','Red · 2 to fix']]){
   const row=table.locator(`[data-catalog-row="${id}"]`),badge=row.locator('.quality-badge');
   const action=row.getByRole('button',{name:'Open product',exact:true});
   assert.equal(await action.isVisible(),true);
   if(label){
    assert.equal(await badge.isVisible(),true);assert.equal(await badge.innerText(),label);
    assert.ok((await row.ariaSnapshot()).includes(label),`Accessible status for ${id} at ${width}px`);
   }else assert.equal(await badge.count(),0);
   const fits=await row.evaluate(node=>{
    const fitsCell=control=>{const box=control.getBoundingClientRect(),cell=control.closest('td').getBoundingClientRect();return box.left>=cell.left-1&&box.right<=cell.right+1&&box.left>=-1&&box.right<=innerWidth+1&&control.scrollWidth<=control.clientWidth+1;};
    return [...node.querySelectorAll('.quality-badge,button')].every(fitsCell);
   });
   assert.ok(fits,`Status and action fit the ${id} row at ${width}px`);
   await action.press('Enter');assert.deepEqual(await page.evaluate(()=>window.opened),['product',id]);
   if(width<=600){
    const point=await row.locator('strong').evaluate(title=>{
     title.scrollIntoView({block:'center'});
     const range=document.createRange();range.selectNodeContents(title);const box=range.getClientRects()[0];
     const x=box.left+box.width/2,y=box.top+box.height/2,hit=document.elementFromPoint(x,y);
     window.opened=null;return {x,y,hit:hit?.outerHTML.slice(0,140)};
    });
    await page.touchscreen.tap(point.x,point.y);
    assert.deepEqual(await page.evaluate(()=>window.opened),['product',id],`Title tap at ${width}px / ${scale}% opens ${id} (hit ${point.hit})`);
   }
  }
  if(width<=600){
   await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
   const add=page.getByRole('button',{name:'Add product',exact:true});
   const addBox=await add.boundingBox(),first=await table.locator('tbody tr').first().boundingBox();
   assert.ok(addBox.y+addBox.height<=first.y+1,`Scrolled header action stays above the first product at ${width}px / ${scale}%`);
  }
  const filtersAndList=page.locator('.catalog-filters,.catalog-results-head,#catalogResults,#catalogPaging');
  await page.locator('#catalogDetail').evaluate((node,html)=>{node.innerHTML=html;},detail);
  assert.equal(await page.locator('[data-catalog-detail="neutral"]').isVisible(),true);
  assert.equal(await filtersAndList.filter({visible:true}).count(),width<=600?0:4);
  await page.locator('#catalogDetail').evaluate(node=>node.replaceChildren());
  assert.equal(await filtersAndList.filter({visible:true}).count(),4);
  assert.equal(await table.locator('tbody tr').count(),3);
 }
});
