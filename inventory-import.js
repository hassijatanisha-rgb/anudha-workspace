'use strict';

function inventoryImportCleanName(value){return String(value||'').replace(/\s+/g,' ').trim()}
function inventoryImportNormalizedName(value){return inventoryImportCleanName(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function inventoryImportQuantityKey(key){return /^(?:closing[_ ]?balance|quantity|stock[_ ]?(?:quantity|count|balance)|on[_ ]?hand|sealed[_ ]?cartons|loose[_ ]?units)$/i.test(String(key||''))}
function inventoryImportHasQuantity(value,key=''){
 if(inventoryImportQuantityKey(key)&&value!==null&&value!==undefined&&value!=='')return true;
 if(Array.isArray(value))return value.some(item=>inventoryImportHasQuantity(item));
 if(value&&typeof value==='object')return Object.entries(value).some(([childKey,child])=>inventoryImportHasQuantity(child,childKey));
 return false;
}
function inventoryImportRows(product){
 const rows=[...(Array.isArray(product?.source?.source_rows)?product.source.source_rows:[])];
 if(product?.source?.source_row!==undefined&&product.source.source_row!==null&&product.source.source_row!=='')rows.push(product.source.source_row);
 return [...new Set(rows.map(Number).filter(Number.isFinite))].sort((a,b)=>a-b);
}
function inventoryImportPlan(payload,existingProducts=[]){
 if(payload?.metadata?.kind!=='inventory-product-list'||!Array.isArray(payload?.products))throw Error('Choose the prepared inventory product list.');
 if(payload.metadata.quantities_supplied!==false||inventoryImportHasQuantity(payload.products))throw Error('This file contains stock quantity data. Book2 quantities were not supplied, so only product names may be imported.');
 const groups=new Map();
 for(const product of payload.products){
  const name=inventoryImportCleanName(product?.name),normalized=inventoryImportNormalizedName(name);
  if(!normalized)continue;
  const current=groups.get(normalized)||{name,products:[],sourceRows:[]};
  current.products.push(product);current.sourceRows.push(...inventoryImportRows(product));groups.set(normalized,current);
 }
 const existing=new Map(existingProducts.map(product=>[inventoryImportNormalizedName(product.name),product]).filter(([name])=>name));
 const newProducts=[],existingMatches=[],duplicateGroups=[];
 for(const [normalized,group] of groups){
  group.sourceRows=[...new Set(group.sourceRows)].sort((a,b)=>a-b);
  if(group.products.length>1||group.sourceRows.length>1)duplicateGroups.push({name:group.name,count:group.products.length,sourceRows:group.sourceRows});
  const saved=existing.get(normalized);
  if(saved){existingMatches.push({name:group.name,existingProduct:saved,sourceRows:group.sourceRows});continue;}
  const first=group.products[0],source={...(first.source||{}),source_rows:group.sourceRows};delete source.source_row;
  if(group.sourceRows.length>1)source.review_notes=[...(Array.isArray(source.review_notes)?source.review_notes:[]),`Repeated in Book2 rows: ${group.sourceRows.join(', ')}`];
  newProducts.push({...first,name:group.name,sku:String(first.sku||'').trim(),source});
 }
 return {sourceRows:payload.products.length,uniqueNames:groups.size,newProducts,existingMatches,duplicateGroups};
}
