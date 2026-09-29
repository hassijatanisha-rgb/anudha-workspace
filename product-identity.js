'use strict';
// Local mapping proposals only. No merges, stock arithmetic or production writes.
// Callers provide explicit canonical fields: name, sku, manufacturer,
// specification and packUnit; represent unknown fields as null or empty text.
// Never infer manufacturer from a related machine.
function normalizeProductIdentityText(value){
 if(value===null||value===undefined)return '';
 if(typeof value!=='string')throw Error('Product identity fields must be text.');
 return value.trim().replace(/\s+/g,' ').toLowerCase();
}
function normalizedProductIdentity(record){
 if(!record||typeof record!=='object'||Array.isArray(record))throw Error('Provide a product identity record.');
 return Object.fromEntries(['name','sku','manufacturer','specification','packUnit'].map(field=>[field,normalizeProductIdentityText(record[field])]));
}
function productIdentityCandidates(source,products){
 if(!Array.isArray(products))throw Error('Provide candidate products as an array.');
 const wanted=normalizedProductIdentity(source),required=['name','manufacturer','specification','packUnit'];
 const reasons=new Set(required.filter(field=>!wanted[field]).map(field=>'source_missing_'+field));
 const grouped=new Map();
 for(const product of products){
  if(typeof product?.id!=='string'||!product.id.trim()||product.id!==product.id.trim())throw Error('Each product needs an exact stable ID.');
  const identity=normalizedProductIdentity(product);
  if(!grouped.has(product.id))grouped.set(product.id,[]);
  grouped.get(product.id).push(identity);
 }
 const candidateIds=[],matches=[];
 for(const id of [...grouped.keys()].sort()){
  const identities=grouped.get(id);
  const related=identities.some(row=>(wanted.name&&row.name===wanted.name)||(wanted.sku&&row.sku===wanted.sku));
  if(!related)continue;
  candidateIds.push(id);
  if(new Set(identities.map(row=>JSON.stringify(row))).size>1){
   reasons.add('conflicting_identity_for_product_id:'+id);continue;
  }
  const row=identities[0];let exact=required.every(field=>Boolean(wanted[field]));
  for(const field of required){
   if(!row[field]){reasons.add('candidate_missing_'+field+':'+id);exact=false;}
   else if(wanted[field]&&wanted[field]!==row[field]){reasons.add('different_'+field+':'+id);exact=false;}
  }
  if(wanted.sku&&row.sku&&wanted.sku!==row.sku){reasons.add('different_sku:'+id);exact=false;}
  if(exact)matches.push(id);
 }
 // A clean exact identity still cannot resolve another incomplete/conflicting
 // candidate that might represent the same product. Require human review.
 const uncertain=[...reasons].some(reason=>reason.startsWith('source_missing_')||reason.startsWith('candidate_missing_')||reason.startsWith('conflicting_identity_'));
 const status=matches.length>1?'ambiguous':matches.length===1&&!uncertain?'exact':candidateIds.length||uncertain?'needs_review':'unmatched';
 if(matches.length>1)reasons.add('multiple_exact_product_ids');
 return {status,productIds:status==='exact'?matches:[],candidateIds,reasons:[...reasons].sort(),autoMerge:false};
}
