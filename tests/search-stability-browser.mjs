import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||resolve(dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
try{
 const page=await browser.newPage();await page.route('**/*',r=>r.abort());
 for(const type of ['text','search']){
  await page.setContent('<div style="height:500px"></div><main id="content"></main><div style="height:2000px"></div>');
  await page.addScriptTag({content:readFileSync(new URL('../search-state.js',import.meta.url),'utf8')});
  await page.evaluate(type=>{
   window.query='';window.draw=()=>{
    const input=document.createElement('input');input.id='query';input.type=type;input.value=window.query;
    document.querySelector('#content').replaceChildren(input);
    input.oninput=e=>{window.query=e.target.value;renderSearchPreservingPosition(e.target,draw)};
   };draw();window.scrollTo(0,300);
  },type);
  await page.locator('#query').click();await page.locator('#query').pressSequentially('hospital');
  assert.equal(await page.locator('#query').inputValue(),'hospital');
  for(let i=0;i<7;i++)await page.locator('#query').press('ArrowLeft');
  await page.locator('#query').pressSequentially('XYZ');
  assert.equal(await page.locator('#query').inputValue(),'hXYZospital');
  const before=await page.evaluate(()=>window.scrollY);
  await page.locator('#query').press('Backspace');
  assert.equal(await page.locator('#query').inputValue(),'hXYospital');
  assert.equal(await page.evaluate(()=>document.activeElement.selectionStart),3);
  assert.equal(await page.evaluate(()=>window.scrollY),before);
  await page.locator('#query').press('ControlOrMeta+a');await page.locator('#query').press('Backspace');await page.locator('#query').pressSequentially('reagent');
  assert.equal(await page.locator('#query').inputValue(),'reagent');
  console.log('PASS: '+type+' typing, middle edits, delete, clear, refocus and scroll stability');
 }
}finally{await browser.close()}
