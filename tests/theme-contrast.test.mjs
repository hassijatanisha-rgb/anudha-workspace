import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCss} from '../scripts/audit-design-tokens.mjs';
const css=readFileSync(new URL('../tokens.css',import.meta.url),'utf8'),declarations=parseCss(css,'tokens.css').declarations;
const palette=(selector,media='')=>Object.fromEntries(declarations.filter(d=>d.selector===selector&&d.media.join(' ')===media&&d.property.startsWith('--')).map(d=>[d.property,d.value]));
const light=palette(':root'),dark=palette(':root[data-theme="dark"],body.packing-tv'),system=palette(':root:not([data-theme="light"])','@media(prefers-color-scheme:dark)');
const luminance=hex=>hex.slice(1).match(/../g).map(h=>parseInt(h,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
test('light and dark text, semantic chips, and primary controls retain 4.5:1 contrast',()=>{
 for(const [name,overrides] of [['Light',{}],['Dark',dark]]){
  const values={...light,...overrides};const check=(fg,bg)=>assert.ok(contrast(values[fg],values[bg])>=4.5,`${name} ${fg} on ${bg}: ${contrast(values[fg],values[bg]).toFixed(2)}`);
  for(const fg of ['--ink','--ink-2','--brand'])for(const bg of ['--canvas','--surface','--surface-2'])check(fg,bg);
  for(const tone of ['success','warning','danger','info'])check('--'+tone,'--'+tone+'-bg');
  check('--on-brand','--brand');check('--on-brand','--brand-strong');
 }
});
test('system dark uses the same palette, respects explicit Light, and print always overrides either manual theme',()=>{
 assert.deepEqual(system,dark);
 const print=declarations.filter(d=>d.media.includes('@media print'));assert.ok(print.length);
 for(const d of print)assert.equal(d.selector,':root,:root[data-theme],body.packing-tv');
 const values=Object.fromEntries(print.map(d=>[d.property,d.value]));
 assert.equal(values['color-scheme'],'light');assert.equal(values['--surface'],'#ffffff');assert.equal(values['--ink'],light['--ink']);assert.equal(values['--brand'],light['--brand']);
});
