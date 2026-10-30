import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCss,inspectValue,normalizeColour,classifyDeclaration,sourceManifest,inspectAuthoredStyles,auditDesignTokens,formatReport,geometryExceptions} from '../scripts/audit-design-tokens.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const declaration=(property,value,extra={})=>({file:'fixture.css',line:1,selector:'.card',contexts:[],media:[],property,value,...extra});
const baseTokens=':root{font:100%/1.5 system-ui,sans-serif;--ink:#1b2a24;--space-1:.25rem;--t-body:.9375rem;--e-1:0 1px 2px rgba(16,32,24,.06)}';
function fixture(t,css,js=''){
 const dir=mkdtempSync(join(tmpdir(),'erp-design-tokens-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 writeFileSync(join(dir,'index.src.html'),'<link rel="stylesheet" href="tokens.css?v=1"><link rel="stylesheet" href="fixture.css?v=2"><script src="fixture.js"></script>');
 writeFileSync(join(dir,'tokens.css'),baseTokens);writeFileSync(join(dir,'fixture.css'),css);writeFileSync(join(dir,'fixture.js'),js);return dir;
}

test('parser preserves declarations, real lines and nested media in minified rules',()=>{
 const css='/* head */\n@media (max-width:40rem){\n.card:hover,[data-label="a:b;{}"]{padding:0 var(--space-1);content:"x;}:/* not a comment */";background:url("data:image/svg+xml,<svg fill=\'#fff\'>{;}</svg>")}\n@supports(display:grid){.row{gap:var(--space-1)}}}';
 const parsed=parseCss(css,'min.css');assert.equal(parsed.declarations.length,4);assert.equal(parsed.rules.length,4);
 assert.deepEqual(parsed.declarations.map(x=>[x.property,x.line]),[['padding',3],['content',3],['background',3],['gap',4]]);
 assert.deepEqual(parsed.declarations.at(-1).contexts,['@media (max-width:40rem)','@supports(display:grid)']);
 assert.equal(parsed.declarations[1].value,'"x;}:/* not a comment */"');assert.equal(parsed.statements.length,0);
 assert.match(parsed.declarations[0].selector,/data-label="a:b;\{\}"/);
});

test('parser respects nested selectors, keyframes, semicolons in functions and custom values',()=>{
 const parsed=parseCss('.card{--payload:{x:y;z:q};color:var(--ink);&:focus{COLOR:var(--ink)}}@keyframes spin{from{transform:rotate(0)}to{transform:rotate(1turn)}}');
 assert.equal(parsed.declarations.length,5);assert.equal(parsed.declarations[0].value,'{x:y;z:q}');
 assert.equal(parsed.declarations[2].selector,'.card / &:focus');assert.equal(parsed.declarations[2].property,'color');
 assert.deepEqual(parsed.declarations.at(-1).contexts,['@keyframes spin']);
});

test('malformed blocks, strings and comments cannot silently disappear from the audit',()=>{
 for(const css of ['.a{color:red','.a{color:rgb(1,2,3}','.a{content:"oops}','.a{/*oops'])assert.throws(()=>parseCss(css));
 assert.equal(parseCss('@import "hidden.css";.a{color:red}').statements[0].raw,'@import "hidden.css"');
});

test('value inspection sees every shorthand literal and nested var fallback without URL colours',()=>{
 const result=inspectValue('0 8px 24px rgba(16,32,24,.12),inset 0 0 0 var(--edge,var(--line,#fff));url("data:image/svg+xml,<svg fill=\"red\"/>")');
 assert.deepEqual(result.references.map(x=>x.name),['--edge','--line']);
 assert.deepEqual(result.colours.map(x=>x.raw),['rgba(16,32,24,.12)','#fff']);
 assert.equal(result.colours[1].normalized,'rgba(255,255,255,1)');
 assert.deepEqual(inspectValue('var(--ink /* comma, here */,red)').references,[{name:'--ink',fallback:'red'}]);
 const spacing=classifyDeclaration(declaration('padding','var(--space-1) 3px 0 7px'));
 assert.deepEqual(spacing.literals.map(x=>x.raw),['3px','7px']);
});

test('colour normalization includes aliases, alpha, RGB percentages and HSL hue units',()=>{
 for(const raw of ['#fff','#FFFFFF','white','rgb(255,255,255)','rgb(100% 100% 100%)','hsl(0 0% 100%)'])assert.equal(normalizeColour(raw),'rgba(255,255,255,1)',raw);
 assert.equal(normalizeColour('#1234'),'rgba(17,34,51,0.2667)');
 assert.equal(normalizeColour('rgba(255, 0, 0, 50%)'),'rgba(255,0,0,0.5)');
 assert.equal(normalizeColour('hsl(.5turn 100% 50% / .25)'),'rgba(0,255,255,0.25)');
 assert.equal(normalizeColour('hsl(100grad 100% 50%)'),'rgba(127.5,255,0,1)');
 assert.equal(normalizeColour('oklch(60% .1 200)'),'oklch(60% .1 200)');
 assert.equal(inspectValue('rebeccapurple').colours[0].normalized,'rgba(102,51,153,1)');
});

test('zero, cascade, transparent, currentColor, relative and intrinsic semantics are explicit',()=>{
 const cases=[['padding','0'],['color','currentColor'],['background','transparent'],['box-shadow','none'],['font','inherit'],['width','100%'],['width','min-content'],['grid-template-columns','minmax(0,1fr) 2fr'],['opacity','.5']];
 for(const [property,value] of cases){const result=classifyDeclaration(declaration(property,value));assert.equal(result.literals.length,0,`${property}:${value}`);assert.ok(result.classifications.length,`${property}:${value}`);}
 assert.equal(classifyDeclaration(declaration('color','CanvasText')).literals.length,1);
 const forced=classifyDeclaration(declaration('color','CanvasText',{contexts:['@media(forced-colors:active)'],media:['@media(forced-colors:active)']}));
 assert.deepEqual(forced.classifications,['systemColour']);assert.equal(forced.literals.length,0);
});

test('type roles, weight, leading, tracking, radius, shadow and motion remain strict',()=>{
 for(const [property,value] of [['font','600 1rem/1.5 system-ui'],['font-size','1rem'],['font-weight','600'],['line-height','1.5'],['letter-spacing','.01em'],['gap','8px'],['margin','1rem auto'],['border-radius','8px'],['box-shadow','0 1px 2px black'],['transition','opacity 200ms ease'],['animation','spin .75s linear infinite']])assert.ok(classifyDeclaration(declaration(property,value)).literals.length,`${property}:${value}`);
 for(const [property,value] of [['font-size','var(--t-body)!important'],['box-shadow','var(--e-1)'],['padding','var(--space-1) 0']])assert.equal(classifyDeclaration(declaration(property,value)).literals.length,0);
});

test('structural geometry is visible separately without granting visual-token compliance',()=>{
 const result=classifyDeclaration(declaration('grid-template-columns','minmax(210px,1fr) 2fr'));
 assert.equal(result.literals.length,0);assert.deepEqual(result.geometry.map(x=>x.raw),['210px']);
 const border=classifyDeclaration(declaration('border','1px solid #fff'));
 assert.deepEqual(border.geometry.map(x=>x.raw),['1px']);assert.deepEqual(border.literals.map(x=>x.raw),['#fff']);
 const width=classifyDeclaration(declaration('width','min(40rem,95vw)'));
 assert.deepEqual(width.geometry.map(x=>x.raw),['40rem','95vw']);
 assert.ok(classifyDeclaration(declaration('padding','2vw')).literals.length);
 assert.ok(classifyDeclaration(declaration('filter','drop-shadow(0 4px 8px var(--ink))')).literals.length);
});

test('print, viewport and clipping spacing exceptions require their exact source declaration',()=>{
 assert.equal(geometryExceptions.length,19);
 for(const exception of geometryExceptions){const contexts=exception.context?exception.context.split(' > '):[],row=declaration(exception.property,exception.value,{file:exception.file,selector:exception.selector,contexts,media:contexts.filter(x=>x.startsWith('@media'))});
  const allowed=classifyDeclaration(row);assert.equal(allowed.literals.length,0,JSON.stringify(exception));assert.ok(allowed.geometry.length);assert.equal(allowed.exception.reason,exception.reason);
  assert.ok(classifyDeclaration({...row,selector:row.selector+' .new'}).literals.length,'new selector must not inherit an exception');
  assert.ok(classifyDeclaration({...row,value:row.value.replace(/(?:\d*\.)?\d+(?:mm|vw|vh|px)/, '99mm')}).literals.length,'new value must not inherit an exception');
 }
});

test('the two permitted negative margins remain the complete 1px screen-reader clipping pattern',()=>{
 for(const [file,selector] of [['workspace-skeleton.css','.workspace-skeleton-status'],['ui-polish.css','.action-feedback-sr-only']]){
  const rows=parseCss(readFileSync(join(root,file),'utf8'),file).declarations.filter(x=>x.selector===selector&&!x.contexts.length),values=Object.fromEntries(rows.map(x=>[x.property,x.value.replace(/!important/g,'').trim()]));
  for(const [property,value] of Object.entries({position:'absolute',width:'1px',height:'1px',padding:'0',margin:'-1px',overflow:'hidden','clip-path':'inset(50%)','white-space':'nowrap',border:'0'}))assert.equal(values[property],value,`${file} ${property}`);
  assert.equal(classifyDeclaration(rows.find(x=>x.property==='margin')).literals.length,0);
 }
});

test('manifest preserves authored order/query removal and excludes only explicit vendor/generated sources',()=>{
 const manifest=sourceManifest('<link href="tokens.css?v=1" rel="stylesheet"><link rel="stylesheet" href="screen.css?q=2#x"><script src="app.js?v=3"></script><script src="vendor/x.js"></script><script src="app.bundle.js"></script>');
 assert.deepEqual(manifest.styles,['tokens.css','screen.css']);assert.deepEqual(manifest.scripts,['app.js']);assert.equal(manifest.excluded.length,2);
 assert.deepEqual(sourceManifest('<!-- <link rel="stylesheet" href="old.css"> --><LINK REL=stylesheet HREF=tokens.css>').styles,['tokens.css']);
 for(const href of ['../outside.css','https://host/test.css','/absolute.css'])assert.throws(()=>sourceManifest(`<link rel="stylesheet" href="${href}">`),/Non-local source/);
});

test('runtime styles retain expressions and definitions without mistaking strings/comments for writes',()=>{
 const source='// ignored.style.color="red";\nconst example="x.style.left=12";\n/* ignored.style.top=9 */\n// 😀\nnode.style.setProperty("--measured",`${bounds.height}px`);\nnode.style["left"]=Math.max(8,bounds.left)+"px";';
 const found=inspectAuthoredStyles(source,'view.js');assert.equal(found.runtime.length,2);assert.equal(found.runtime[0].line,5);assert.equal(found.runtime[0].dynamicDefinition,'--measured');assert.equal(found.runtime[1].property,'left');assert.match(found.runtime[1].raw,/Math.max\(8,bounds.left\)/);
 assert.equal(inspectAuthoredStyles('const card=`<p style="color:red">Hello</p>`;','view.js').inline.length,1);
});

test('runtime inspection tolerates authored apostrophes, regexes and nested template strings',()=>{
 const source="// Staff's own display name\nconst quote = text.replace(/\"/g, '&quot;').replace(/['`]/g,'');\nconst html = `outer ${ok ? `inner ${name}` : 'empty'}`;\nnode.style.left = Math.max(8, rect.left) + 'px';\n/* don't interpret fake.style.color = 'red' */";
 const found=inspectAuthoredStyles(source,'view.js');assert.equal(found.runtime.length,1);assert.equal(found.runtime[0].property,'left');assert.equal(found.runtime[0].line,4);assert.deepEqual(found.inline,[]);
});

test('audit resolves token definitions and measured runtime properties but rejects missing names with fallbacks',t=>{
 const dir=fixture(t,'.card{color:var(--ink);height:var(--measured);padding:var(--space-1);background:var(--missing,#fff)}','node.style.setProperty("--measured",`${bounds.height}px`);');
 const report=auditDesignTokens(dir);assert.equal(report.summary.unresolved,1);assert.ok(report.references.find(x=>x.name==='--measured').resolved);
 assert.deepEqual(report.errors.map(x=>x.code),['unresolved-reference','literal']);
 assert.equal(report.errors[0].property,'background');assert.match(report.errors[0].detail,/fallback does not define/);
 assert.match(formatReport(report),/fixture.css:1 .card \| background/);
});

test('audit detects palette overrides, imported sources, duplicate root fonts and inline styles',t=>{
 const dir=fixture(t,'@import "extra.css";:root{--ink:var(--space-1);font-size:16px}.card{color:var(--ink)}','const card=`<b style="color:red">x</b>`;');
 const report=auditDesignTokens(dir);for(const code of ['token-redefinition','literal','unparsed-statement','root-font','inline-style'])assert.ok(report.errors.some(x=>x.code===code),code);
 assert.equal(report.redefinitions[0].previous.file,'tokens.css');
});

test('clean source fixture passes while preserving separate geometry and media inventories',t=>{
 const dir=fixture(t,'@media(max-width:40rem){.card{color:var(--ink);padding:var(--space-1);width:min(600px,95vw);font-size:var(--t-body);box-shadow:var(--e-1)}}');
 const report=auditDesignTokens(dir);assert.deepEqual(report.errors,[]);assert.equal(report.geometry.length,1);assert.equal(report.breakpoints[0].literals[0].raw,'40rem');
 assert.equal(report.categories.type.at(-1).value,'var(--t-body)');assert.match(formatReport(report),/not claimed token compliant/);
});

test('authored token contract keeps the specified palette, seven type/spacing roles and elevations',()=>{
 const parsed=parseCss(readFileSync(join(root,'tokens.css'),'utf8'),'tokens.css');const base=parsed.declarations.filter(x=>x.selector===':root'&&!x.contexts.length),tokens=Object.fromEntries(base.map(x=>[x.property,x.value]));
 const palette={'--brand':'#176149','--brand-strong':'#104936','--ink':'#1b2a24','--ink-2':'#4f5f57','--ink-3':'#6b7a72','--canvas':'#f5f7f6','--surface':'#ffffff','--surface-2':'#eef3f0','--line':'#dce3de','--success':'#1e7a4a','--success-bg':'#e3f4ea','--warning':'#8a5a00','--warning-bg':'#fff4d6','--danger':'#a12a2a','--danger-bg':'#fde8e8','--info':'#2a5c8a','--info-bg':'#e5eff9','--neutral-bg':'#eef1ef'};
 for(const [name,value] of Object.entries(palette))assert.equal(normalizeColour(tokens[name]),normalizeColour(value),name);
 const roles={display:[2,1.1,700,-.02],title:[1.375,1.2,650,-.01],headline:[1.0625,1.3,600,0],body:[.9375,1.5,400,0],callout:[.875,1.45,400,0],caption:[.75,1.35,500,.02],overline:[.6875,1.3,600,.06]};
 assert.deepEqual(Object.keys(tokens).filter(x=>x.startsWith('--t-')).sort(),Object.keys(roles).map(x=>'--t-'+x).sort());
 for(const [name,[size,leading,weight,tracking]] of Object.entries(roles)){assert.equal(parseFloat(tokens['--t-'+name]),size,name);assert.match(tokens['--t-'+name],/rem$/);assert.equal(Number(tokens['--lh-'+name]),leading);assert.equal(Number(tokens['--w-'+name]),weight);assert.equal(parseFloat(tokens['--ls-'+name]||'0'),tracking);}
 assert.deepEqual(Object.keys(tokens).filter(x=>/^--space-/.test(x)).sort(),Array.from({length:7},(_,i)=>'--space-'+(i+1)));
 [.25,.5,.75,1,1.5,2,3].forEach((value,i)=>{assert.equal(parseFloat(tokens['--space-'+(i+1)]),value);assert.match(tokens['--space-'+(i+1)],/rem$/);});
 for(const [name,value] of Object.entries({'--r-sm':'.5rem','--r-md':'.75rem','--r-lg':'1rem','--r-pill':'999px','--e-0':'none','--e-1':'0 1px 2px rgba(16,32,24,.06)','--e-2':'0 8px 24px rgba(16,32,24,.12)','--e-3':'0 16px 48px rgba(16,32,24,.18)','--m-fast':'100ms','--m-base':'200ms','--m-slow':'300ms','--ease-in':'cubic-bezier(.2,.8,.2,1)','--ease-out':'cubic-bezier(.8,0,.8,.2)'}))assert.equal(tokens[name],value,name);
 assert.equal(tokens.font,'100%/1.5 system-ui,sans-serif');
});

test('linked ERP source passes the strict visual-token gate (geometry/runtime remain separate)',()=>{
 const report=auditDesignTokens(root);assert.equal(report.manifest.styles[0],'tokens.css');
 assert.equal(report.errors.length,0,report.errors.map(x=>`${x.file}:${x.line} ${x.selector||''} ${x.property||''}: ${x.detail}`).join('\n'));
});
