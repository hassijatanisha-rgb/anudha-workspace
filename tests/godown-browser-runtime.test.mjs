import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

function probe(executable){
 const env={...process.env,PLAYWRIGHT_MODULE:fileURLToPath(new URL('./fixtures/playwright-launch-probe.mjs',import.meta.url))};
 delete env.CHROME_EXECUTABLE;
 if(executable)env.CHROME_EXECUTABLE=executable;
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('./godown-review-browser.mjs',import.meta.url))],{env,encoding:'utf8',timeout:15000});
 assert.equal(result.error,undefined);
 assert.equal(result.status,1,'probe deliberately stops before any browser launches');
 const marker=result.stderr.match(/CONFIGURED_BROWSER_PROBE (\{[^\n]+\})/);
 assert.ok(marker,'the test must load the configured Playwright module');
 return JSON.parse(marker[1]);
}
test('godown browser runner respects configured Playwright and Chrome paths',()=>{
 assert.deepEqual(probe('/fixture/chromium'),{headless:true,executablePath:'/fixture/chromium'});
});
test('godown browser runner leaves default Chromium selection to Playwright',()=>{
 assert.deepEqual(probe(),{headless:true});
});
