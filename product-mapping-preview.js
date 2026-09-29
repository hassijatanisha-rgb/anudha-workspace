'use strict';
// Mapping proposals only. Never posts stock, creates products or merges IDs.
function mappingSourceFields(record){
 if(!record||typeof record!=='object'||Array.isArray(record))throw Error('Invalid source record');
 const out={};
 for(const key of ['name','originalName','model','manufacturer','description','active','source','units','totalStock','locations','matchStatus','matchConfidence','notes']){
  if(!Object.prototype.hasOwnProperty.call(record,key))continue;
  const value=record[key];
  if(value!==null&&typeof value!=='string'&&!(typeof value==='number'&&Number.isFinite(value)&&['totalStock','matchConfidence'].includes(key)))throw Error('Invalid source field: '+key);
  if(typeof value==='string'&&value.length>20000)throw Error('Source field is too long: '+key);
  out[key]=value;
 }
 return out;
}
function buildProductMappingPreview(payload,catalog){
 if(payload?.schema!=='anudha-product-mapping-v1'||!Array.isArray(payload.rows)||payload.rows.length>20000)throw Error('Choose the ERP mapping JSON format, with at most 20,000 rows');
 if(!Array.isArray(catalog))throw Error('Load the ERP product catalog first');
 const byId=new Map(),byName=new Map();
 for(const product of catalog.filter(p=>!p.deleted_at)){
  const source=product.source||{},entry={id:product.id,name:product.name,sku:product.sku||'',manufacturer:source.company||'',specification:source.specification||source.model||'',packUnit:source.units||source.pack_unit||''};
  if(typeof entry.id!=='string'||!entry.id.trim())throw Error('Catalog product is missing its ID');
  normalizedProductIdentity(entry);
  if(!byId.has(entry.id))byId.set(entry.id,[]);byId.get(entry.id).push(entry);
  const name=normalizeProductIdentityText(entry.name);
  if(!byName.has(name))byName.set(name,new Set());byName.get(name).add(entry.id);
 }
 const keys=new Set(),counts={exact:0,ambiguous:0,needs_review:0,unmatched:0};
 const rows=payload.rows.map(row=>{
  if(typeof row?.sourceKey!=='string'||!row.sourceKey.trim()||row.sourceKey!==row.sourceKey.trim())throw Error('Source key is missing or invalid');
  if(keys.has(row.sourceKey))throw Error('Duplicate source key: '+row.sourceKey);keys.add(row.sourceKey);
  const original=mappingSourceFields(row.original),corrected=mappingSourceFields(row.corrected);
  for(const field of ['originalName','source','units','totalStock','locations','matchConfidence'])if(original[field]!==corrected[field])throw Error('Stock/source provenance changed: '+field);
  const identity={name:corrected.name||'',manufacturer:corrected.manufacturer||'',specification:corrected.model||'',packUnit:corrected.units||''};
  const ids=byName.get(normalizeProductIdentityText(identity.name))||new Set();
  const match=productIdentityCandidates(identity,[...ids].flatMap(id=>byId.get(id))),issues=[];
  const quantity=corrected.totalStock;
  if(quantity==null||(typeof quantity==='string'&&!quantity.trim()))issues.push('stock_not_reported');
  else if(!Number.isFinite(Number(quantity)))issues.push('stock_not_numeric');
  else if(Number(quantity)<0)issues.push('negative_stock');
  if(!String(corrected.locations||'').trim())issues.push('godown_missing');
  counts[match.status]++;
  return {sourceKey:row.sourceKey,original,corrected,editedLocally:row.editedLocally===true,editedAt:Number.isFinite(row.editedAt)?row.editedAt:null,match,issues};
 });
 return {schema:'anudha-product-mapping-preview-v1',sourceExportedAt:typeof payload.exportedAt==='string'?payload.exportedAt:'',rows,counts,postsStock:false};
}
