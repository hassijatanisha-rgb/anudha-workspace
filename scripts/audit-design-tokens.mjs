// Read-only source audit. The manifest is the authored ERP boundary, not generated bundles.
import {readFileSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const lineAt=(text,offset)=>text.slice(0,offset).split('\n').length;
const cssWide=new Set(['inherit','initial','unset','revert','revert-layer']);
const systemColours=new Set('accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field fieldtext graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext'.split(' '));
const colourNames=Object.fromEntries(('aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32').split(' ').map(pair=>pair.split(':')));

// These are syntax exceptions, not exemptions for a file or a family of visual values.
export const syntaxExceptions={
 zero:'Zero removes a dimension; it does not add a scale value.',
 percentage:'Relative sizing, alignment and colour mixing retain their percentage.',
 fraction:'Grid fr units distribute available space.',
 intrinsic:'auto, min-content, max-content, fit-content and stretch are intrinsic layout.',
 cssWide:'CSS cascade keywords retain their native semantics.',
 none:'none removes a style.',
 currentColor:'currentColor inherits the current foreground.',
 transparent:'transparent has no visible pigment.',
 systemColour:'System colours are permitted only inside forced-colors queries.',
 media:'Media/container conditions cannot reference ordinary CSS custom properties.',
 structure:'Unitless flex/grid/order/opacity/transform values describe structure, not a type or spacing scale.'
};

// Existing viewport/document spacing and the two screen-reader clipping patterns are retained.
// A new selector, value or context is not covered by these reviewed exceptions.
export const geometryExceptions=[
 ['style.css','.login','margin','7vh auto',''],
 ['style.css','header','padding','var(--space-3) max(var(--space-5),4vw)',''],
 ['style.css','main','padding','var(--space-7) max(var(--space-5),4vw) var(--space-7)',''],
 ['style.css','','margin','10mm','@page'],
 ...[
  ['header','gap','5mm'],['header','padding','0 0 3mm'],['.print-grid','gap','0 5mm'],
  ['.print-grid p','margin','2mm 0'],['h3','margin','3mm 0 1mm'],['h3','padding-bottom','1mm'],
  ['p','margin','1.5mm 0'],['th,.service-report-print td','padding','1.5mm'],
  ['.print-signatures','gap','8mm'],['.print-signatures','margin-top','4mm'],['.print-signatures p','padding-top','3mm']
 ].map(([selector,property,value])=>['style.css','.service-report-print '+selector,property,value,'@media print']),
 ['company-forms.css','.company-form-document','padding','12mm',''],
 ['company-forms.css','','margin','12mm','@media print > @page'],
 ['workspace-skeleton.css','.workspace-skeleton-status','margin','-1px',''],
 ['ui-polish.css','.action-feedback-sr-only','margin','-1px!important','']
].map(([file,selector,property,value,context])=>({file,selector,property,value,context,reason:/mm/.test(value)?'Existing physical print geometry; not spacing-scale compliance.':/^-1px/.test(value)?'Existing 1px screen-reader clipping pattern; not visual spacing.':'Existing viewport layout geometry; not spacing-scale compliance.'}));

function skipComment(text,i){const end=text.indexOf('*/',i+2);if(end<0)throw Error('Unclosed CSS comment');return end+2;}
function skipString(text,i){const quote=text[i];for(let j=i+1;j<text.length;j++){if(text[j]==='\\'){j++;continue;}if(text[j]===quote)return j+1;}throw Error('Unclosed string');}
function matching(text,start,open,close){let depth=1;for(let i=start+1;i<text.length;i++){
 if(text.startsWith('/*',i)){i=skipComment(text,i)-1;continue;}
 if(text[i]==='"'||text[i]==="'"){i=skipString(text,i)-1;continue;}
 if(text[i]===open)depth++;else if(text[i]===close&&!--depth)return i;
 }throw Error(`Unclosed ${open}`);}
function withoutComments(text){return text.replace(/\/\*[\s\S]*?\*\//g,match=>match.replace(/[^\n]/g,' '));}

export function parseCss(text,file='fixture.css'){
 const declarations=[],rules=[],statements=[];
 function block(start,end,selectors=[],contexts=[]){let from=start,paren=0,bracket=0;
  const declaration=until=>{const source=text.slice(from,until),clean=withoutComments(source),m=clean.match(/^\s*([\w-]+)\s*:/);if(!m){if(clean.trim())statements.push({file,line:lineAt(text,from),raw:clean.trim(),contexts});return;}
   const offset=from+clean.indexOf(m[1]),colon=from+m[0].lastIndexOf(':');
   declarations.push({file,line:lineAt(text,offset),selector:selectors.join(' / '),contexts:[...contexts],media:contexts.filter(x=>/^@media\b/i.test(x)),property:m[1].startsWith('--')?m[1]:m[1].toLowerCase(),value:text.slice(colon+1,until).trim()});
  };
  for(let i=start;i<end;i++){
   if(text.startsWith('/*',i)){i=skipComment(text,i)-1;continue;}
   if(text[i]==='"'||text[i]==="'"){i=skipString(text,i)-1;continue;}
   if(text[i]==='(')paren++;else if(text[i]===')')paren--;else if(text[i]==='[')bracket++;else if(text[i]===']')bracket--;
   if(paren<0||bracket<0)throw Error(`${file}:${lineAt(text,i)}: unmatched value delimiter`);
   if(paren||bracket)continue;
   if(text[i]==='{'){
    const header=withoutComments(text.slice(from,i)).trim(),close=matching(text,i,'{','}');
    if(/^--[\w-]+\s*:/.test(header)){i=close;continue;}
    const atRule=header.startsWith('@');rules.push({file,line:lineAt(text,from+text.slice(from,i).indexOf(header)),header,contexts:[...contexts]});
    block(i+1,close,atRule?selectors:[...selectors,header],atRule?[...contexts,header]:contexts);i=close;from=i+1;
   }else if(text[i]===';'){declaration(i);from=i+1;}
  }
  if(paren||bracket)throw Error(`${file}:${lineAt(text,end)}: unclosed value delimiter`);
  declaration(end);
 }
 block(0,text.length);return {declarations,rules,statements};
}

const rounded=n=>Number(n.toFixed(4));
const rgba=(r,g,b,a=1)=>`rgba(${[r,g,b,a].map(rounded).join(',')})`;
export function normalizeColour(raw){
 let value=raw.trim().toLowerCase();if(colourNames[value])value='#'+colourNames[value];
 if(/^#[\da-f]{3,4}$/.test(value))value='#'+[...value.slice(1)].map(x=>x+x).join('');
 if(/^#[\da-f]{6}([\da-f]{2})?$/.test(value))return rgba(...[1,3,5].map(i=>parseInt(value.slice(i,i+2),16)),value.length===9?parseInt(value.slice(7),16)/255:1);
 const match=value.match(/^(rgba?|hsla?)\((.*)\)$/s);
 if(match&&!/\b(var|calc|none|from)\b/.test(match[2])){
  const parts=match[2].trim().split(/\s*[,/]\s*|\s+/),number=s=>parseFloat(s),alpha=s=>s===undefined?1:number(s)/(s.endsWith('%')?100:1);
  if(parts.length>=3&&parts.length<=4&&parts.every(x=>Number.isFinite(number(x)))){
   if(match[1].startsWith('rgb'))return rgba(...parts.slice(0,3).map(x=>number(x)*(x.endsWith('%')?255/100:1)),alpha(parts[3]));
   let h=number(parts[0]);if(parts[0].endsWith('turn'))h*=360;else if(parts[0].endsWith('grad'))h*=.9;else if(parts[0].endsWith('rad'))h*=180/Math.PI;
   h=((h%360)+360)%360/360;const s=number(parts[1])/100,l=number(parts[2])/100;
   const hue=n=>{const k=(n+h*12)%12;return 255*(l-s*Math.min(l,1-l)*Math.max(-1,Math.min(k-3,9-k,1)));};
   return rgba(hue(0),hue(8),hue(4),alpha(parts[3]));
  }
 }
 // Preserve colour-space identity for modern functions; do not claim an sRGB conversion.
 return value.replace(/\s+/g,' ').replace(/\s*([,()/])\s*/g,'$1');
}

export function inspectValue(value){
 const tokens=[],references=[],colours=[];
 function scan(text,functions=[]){for(let i=0;i<text.length;){
  if(text.startsWith('/*',i)){i=skipComment(text,i);continue;}
  if(text[i]==='"'||text[i]==="'"){const end=skipString(text,i);tokens.push({kind:'string',raw:text.slice(i,end),functions});i=end;continue;}
  if(/\s/.test(text[i])){i++;continue;}
  const rest=text.slice(i),hex=rest.match(/^#[\da-f]+\b/i);
  if(hex){const raw=hex[0];tokens.push({kind:'colour',raw,functions});colours.push({raw,normalized:normalizeColour(raw)});i+=raw.length;continue;}
  const number=rest.match(/^[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?(?:[a-z]+|%)?/i);
  if(number){const raw=number[0],unit=raw.match(/[a-z%]+$/i)?.[0].toLowerCase()||'';tokens.push({kind:'number',raw,number:parseFloat(raw),unit,functions});i+=raw.length;continue;}
  const ident=rest.match(/^(?:--)?[a-z_][\w-]*/i);
  if(ident){const raw=ident[0],name=raw.toLowerCase();let next=i+raw.length;while(/\s/.test(text[next]||'')&&next<text.length)next++;
   if(text[next]==='('){const end=matching(text,next,'(',')'),inner=text.slice(next+1,end),whole=text.slice(i,end+1);
    if(name==='var'){const clean=withoutComments(inner),comma=clean.indexOf(','),ref=(comma<0?clean:clean.slice(0,comma)).trim();references.push({name:ref,fallback:comma<0?null:inner.slice(comma+1).trim()});tokens.push({kind:'reference',raw:ref,functions});if(comma>=0)scan(inner.slice(comma+1),[...functions,'var-fallback']);}
    else if(name==='url'){tokens.push({kind:'url',raw:whole,functions});}
    else if(/^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)$/.test(name)){tokens.push({kind:'colour',raw:whole,functions});colours.push({raw:whole,normalized:normalizeColour(whole)});scan(inner,[...functions,'colour-components']);}
    else {tokens.push({kind:'function',raw:name,functions});scan(inner,[...functions,name]);}
    i=end+1;continue;
   }
   const kind=colourNames[name]?'colour':'keyword';tokens.push({kind,raw,functions});if(kind==='colour')colours.push({raw,normalized:normalizeColour(raw)});i+=raw.length;continue;
  }
  i++;
 }}scan(value);return {tokens,references,colours};
}

export function category(property){
 if(property.startsWith('--'))return 'custom-property';
 if(/^(?:margin|padding)(?:-|$)/.test(property))return 'spacing';
 if(/^(?:(?:row|column)-)?gap$/.test(property))return 'gap';
 if(/radius$/.test(property))return 'radius';
 if(/shadow$/.test(property))return 'shadow';
 if(/^(?:font(?:$|-)|line-height|letter-spacing|word-spacing)/.test(property))return 'type';
 if(/^(?:transition|animation)(?:-|$)|scroll-behavior/.test(property))return 'motion';
 if(/color$|^(?:background|fill|stroke|accent-color)$/.test(property))return 'colour';
 return 'layout';
}

export function classifyDeclaration(declaration){
 const {property,value,media}=declaration,group=category(property),inspection=inspectValue(value),literals=[],geometry=[],classifications=[];
 const exception=geometryExceptions.find(x=>x.file===declaration.file&&x.selector===declaration.selector&&x.property===property&&x.value===value&&x.context===(declaration.contexts||[]).join(' > '));
 const add=(token,reason)=>literals.push({raw:token.raw,reason});
 for(const token of inspection.tokens){const lower=token.raw.toLowerCase();
  if(token.kind==='reference'||token.kind==='url')continue;
  if(token.functions.includes('colour-components'))continue;
  if(token.kind==='colour'){add(token,'colour literal');continue;}
  if(token.kind==='number'){
   if(token.number===0){classifications.push('zero');continue;}
   if(token.unit==='%'){classifications.push('percentage');continue;}
   if(token.unit==='fr'){classifications.push('fraction');continue;}
   if(token.unit){
    if(/^(?:ms|s)$/.test(token.unit))add(token,'motion duration');
    else if((group==='layout'||group==='colour'||exception)&&!token.functions.includes('drop-shadow'))geometry.push({raw:token.raw,reason:exception?.reason||'Structural dimension outside the current visual-token gate.'});
    else add(token,'fixed dimension');continue;
   }
   if(group==='type'||group==='custom-property'){add(token,group==='type'?'type metric':'custom-property literal');continue;}
   if(group==='motion'&&!token.functions.includes('steps')){add(token,'motion metric');continue;}
   if(['spacing','gap','radius','shadow'].includes(group)){add(token,`${group} literal`);continue;}
   classifications.push('structure');continue;
  }
  if(cssWide.has(lower)){classifications.push('cssWide');continue;}
  if(lower==='important')continue;
  if(['none','transparent','currentcolor'].includes(lower)){classifications.push(lower==='currentcolor'?'currentColor':lower);continue;}
  if(systemColours.has(lower)){if(media.some(x=>/forced-colors\s*:\s*active/i.test(x)))classifications.push('systemColour');else add(token,'system colour outside forced-colors');continue;}
  if(['auto','min-content','max-content','fit-content','stretch'].includes(lower)){classifications.push('intrinsic');continue;}
  if(token.kind==='function'){
   if(['cubic-bezier','linear','steps'].includes(lower))add(token,'motion easing');
   continue;
  }
  if(group==='type'&&['font','font-size','font-family','font-weight','line-height','letter-spacing','word-spacing'].includes(property))add(token,'type literal');
  else if(group==='motion'&&['ease','ease-in','ease-out','ease-in-out','linear','step-start','step-end'].includes(lower))add(token,'motion easing');
 }
 return {...inspection,category:group,literals,geometry,exception:exception||null,classifications:[...new Set(classifications)]};
}

function localPath(root,name){const clean=name.split(/[?#]/)[0],absolute=resolve(root,clean),rel=relative(root,absolute);if(!clean||/^(?:[a-z]+:|\/)/i.test(clean)||isAbsolute(rel)||rel.startsWith('..'))throw Error(`Non-local source in index.src.html: ${name}`);return clean;}
export function sourceManifest(html,root='.'){
 const styles=[],scripts=[],excluded=[];
 for(const match of html.replace(/<!--[\s\S]*?-->/g,'').matchAll(/<(link|script)\b[^>]*>/gi)){
  const attrs=Object.fromEntries([...match[0].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)].map(m=>[m[1].toLowerCase(),m[2]??m[3]??m[4]]));
  const isStyle=match[1].toLowerCase()==='link'&&attrs.rel?.toLowerCase().split(/\s+/).includes('stylesheet');
  const href=isStyle?attrs.href:match[1].toLowerCase()==='script'?attrs.src:null;if(!href)continue;
  const name=localPath(root,href);if(name.startsWith('vendor/')||/\.bundle\.(?:css|js)$/.test(name)){excluded.push({file:name,reason:name.startsWith('vendor/')?'vendor':'generated bundle'});continue;}
  (isStyle?styles:scripts).push(name);
 }
 return {styles,scripts,excluded};
}

// Runtime style expressions are reported for manual review, never presented as parsed CSS.
function jsMask(text){
 const masked=text.split('');
 const blank=(start,end)=>{for(let j=start;j<end;j++)if(masked[j]!=='\n')masked[j]=' ';};
 function region(start,closing=''){let previous='';for(let i=start;i<text.length;i++){
  const c=text[i];if(c===closing)return i+1;if(/\s/.test(c))continue;
  let end=i;
  if(text.startsWith('/*',i))end=skipComment(text,i);
  else if(text.startsWith('//',i))end=text.indexOf('\n',i)<0?text.length:text.indexOf('\n',i);
  else if(c==='"'||c==="'")end=skipString(text,i);
  else if(c==='`'){
   end=i+1;for(;end<text.length;end++){if(text[end]==='\\'){end++;continue;}if(text[end]==='`'){end++;break;}if(text.startsWith('${',end))end=region(end+2,'}')-1;}
  }else if(c==='/'&&(!previous||/[=(:,!&|?{};\[]/.test(previous.at(-1))||/^(?:return|throw|case)$/.test(previous))){
   end=i+1;let bracket=false;for(;end<text.length;end++){if(text[end]==='\\'){end++;continue;}if(text[end]==='[')bracket=true;else if(text[end]===']')bracket=false;else if(text[end]==='/'&&!bracket){end++;while(/[a-z]/i.test(text[end]||'')&&end<text.length)end++;break;}}
  }else if(c==='{'){
   const next=region(i+1,'}');previous='}';i=next-1;continue;
  }
  if(end>i){blank(i,end);previous='literal';i=end-1;continue;}
  const word=text.slice(i).match(/^[\w$]+/);if(word){previous=word[0];i+=word[0].length-1;}else previous=c;
 }return text.length;}
 region(0);return masked.join('');
}
export function inspectAuthoredStyles(text,file){
 const runtime=[],inline=[];
 const masked=file.endsWith('.js')?jsMask(text):text;
 for(const prefix of masked.matchAll(/\.style\b/g)){
  const match=text.slice(prefix.index).match(/^\.style\s*(?:\.\s*([\w]+)\s*(=|\()|\[\s*(["'])(.*?)\3\s*\]\s*=)/);if(!match)continue;match.index=prefix.index;
  const start=match.index;let end=start+match[0].length,depth=match[2]==='('?1:0;
  for(;end<text.length;end++){const c=text[end];if(c==='"'||c==="'"||c==='`'){end=skipString(text,end)-1;continue;}if('([{'.includes(c))depth++;else if(')]}'.includes(c)){if(!depth)break;depth--;}if(c===';'&&!depth)break;}
  const raw=text.slice(start,end).trim(),name=raw.match(/^\.style\.setProperty\(\s*['"](--[\w-]+)['"]/);
  runtime.push({file,line:lineAt(text,start),property:match[1]||match[4],raw,dynamicDefinition:name?.[1]||null});
 }
 for(const match of text.matchAll(/\bstyle\s*=\s*(["'])(.*?)\1|<style\b[^>]*>([\s\S]*?)<\/style>/gi))inline.push({file,line:lineAt(text,match.index),raw:match[0],value:match[2]??match[3],kind:match[3]===undefined?'attribute':'block'});
 return {runtime,inline};
}

export function auditDesignTokens(root=fileURLToPath(new URL('..',import.meta.url))){
 const read=name=>readFileSync(resolve(root,name),'utf8'),html=read('index.src.html'),manifest=sourceManifest(html,root);
 const declarations=[],rules=[],statements=[],runtime=[],inline=[],errors=[];
 const issue=(code,location,detail)=>errors.push({code,...location,detail});
 for(const file of manifest.styles){try{const parsed=parseCss(read(file),file);declarations.push(...parsed.declarations);rules.push(...parsed.rules);statements.push(...parsed.statements);}catch(error){issue('parse',{file,line:1},error.message);}}
 for(const file of ['index.src.html',...manifest.scripts]){const found=inspectAuthoredStyles(read(file),file);runtime.push(...found.runtime);inline.push(...found.inline);}
 if(manifest.styles[0]!=='tokens.css')issue('token-order',{file:'index.src.html',line:1},'tokens.css must be the first stylesheet.');
 const definitions=declarations.filter(x=>x.property.startsWith('--')),known=new Set([...definitions.map(x=>x.property),...runtime.map(x=>x.dynamicDefinition).filter(Boolean)]),tokenNames=new Set(definitions.filter(x=>x.file==='tokens.css').map(x=>x.property));
 const references=[],redefinitions=[],inventory=[];
 const seen=new Map();
 for(const definition of definitions){if(seen.has(definition.property))redefinitions.push({...definition,previous:seen.get(definition.property)});seen.set(definition.property,{file:definition.file,line:definition.line,selector:definition.selector,contexts:definition.contexts});}
 for(const declaration of declarations){const inspected=classifyDeclaration(declaration),entry={...declaration,...inspected};inventory.push(entry);
  for(const ref of inspected.references){const reference={...declaration,...ref,resolved:known.has(ref.name)};references.push(reference);if(!reference.resolved)issue('unresolved-reference',declaration,`Undefined ${ref.name}${ref.fallback!==null?' (fallback does not define a token)':''}.`);}
  if(declaration.file==='tokens.css')continue;
  if(tokenNames.has(declaration.property))issue('token-redefinition',declaration,'Shared tokens must be defined in tokens.css, including theme and accessibility variants.');
  if(inspected.literals.length)issue('literal',declaration,inspected.literals.map(x=>`${x.reason}: ${x.raw}`).join('; '));
 }
 for(const statement of statements)issue('unparsed-statement',statement,'Unexpected statement or @import outside the linked stylesheet manifest.');
 const rootFonts=declarations.filter(x=>x.selector.split(/\s*,\s*/).some(x=>x===':root'||x==='html')&&['font','font-size'].includes(x.property));
 if(rootFonts.length!==1||rootFonts[0]?.file!=='tokens.css'||rootFonts[0]?.property!=='font'||rootFonts[0]?.value.replace(/\s/g,'')!=='100%/1.5system-ui,sans-serif')issue('root-font',{file:'tokens.css',line:1},'Exactly one :root font:100%/1.5 system-ui,sans-serif declaration is required.');
 for(const item of inline)issue('inline-style',item,'Authored inline styling requires declaration review; move static visual values to linked token consumers.');
 const breakpoints=rules.filter(x=>/^@(?:media|container)\b/i.test(x.header)).map(x=>({...x,literals:inspectValue(x.header).tokens.filter(t=>t.kind==='number'),classification:'media'}));
 const categories={};for(const entry of inventory){const list=categories[entry.category]??=[];list.push(entry);}
 const geometry=inventory.filter(x=>x.geometry.length&&x.file!=='tokens.css');
 return {manifest,declarations:inventory,categories,definitions,references,redefinitions,breakpoints,geometry,geometryExceptions,runtimeStyles:runtime,inlineStyles:inline,syntaxExceptions,errors,
  summary:{stylesheets:manifest.styles.length,declarations:declarations.length,definitions:definitions.length,references:references.length,unresolved:references.filter(x=>!x.resolved).length,redefinitions:redefinitions.length,errors:errors.length,geometry:geometry.length,runtimeStyles:runtime.length,inlineStyles:inline.length}};
}

export function formatReport(report){
 const location=x=>`${x.file}:${x.line}${x.selector?' '+x.selector:''}${x.property?' | '+x.property:''}${x.media?.length?' | '+x.media.join(' > '):''}`;
 const lines=[`ERP token source audit: ${report.summary.stylesheets} linked stylesheets, ${report.summary.declarations} declarations.`,...report.errors.map(x=>`${location(x)} [${x.code}] ${x.detail}${x.value!==undefined?' | '+x.value:''}`)];
 lines.push(`\n${report.errors.length} acceptance error(s); ${report.summary.unresolved} unresolved reference(s).`);
 lines.push('\nMedia/container syntax exceptions:',...report.breakpoints.map(x=>`${location(x)} | ${x.header}`));
 lines.push('\nCustom-property redefinitions (including intentional token themes):',...report.redefinitions.map(x=>`${location(x)} | ${x.value} (previous ${x.previous.file}:${x.previous.line})`));
 lines.push('\nPreserved geometry — inventory only, not claimed token compliant:',...report.geometry.map(x=>`${location(x)} | ${x.value}${x.exception?' | '+x.exception.reason:''}`));
 lines.push('\nRuntime styles — separate manual review, not CSS token acceptance:',...report.runtimeStyles.map(x=>`${location(x)} | ${x.raw}`));
 lines.push('\nUse --json for the complete raw/normalized colour, category, definition/reference and classification inventory. Source checks do not establish rendered contrast, layout, print or accessibility acceptance.');return lines.join('\n');
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.some(x=>x!=='--json'))throw Error('Usage: node scripts/audit-design-tokens.mjs [--json]');
 const report=auditDesignTokens();console.log(args.includes('--json')?JSON.stringify(report,null,2):formatReport(report));process.exitCode=report.errors.length?1:0;
}
