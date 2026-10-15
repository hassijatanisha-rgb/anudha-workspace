'use strict';
// Pages look rows up by id, or collect a record's lines, once for every row they draw. Searching the whole list each
// time (20,000 contacts, tens of thousands of order lines) made some pages and search boxes take seconds, so each
// list is indexed once and again whenever it is replaced or changes length.
// rowById: a hit is checked against the list, so a row replaced or moved in place is never returned stale; an id that
// is not indexed is looked for in the list as before. The first row with the id wins, as with find.
// rowsWhere: rows whose key equals value, in list order. Only for lists that are replaced or added to (loaded order
// lines), never edited in place; the array returned is shared, so copy it before sorting.
const rowIndexes=new WeakMap();
function rowIndex(rows){let index=rowIndexes.get(rows);if(!index||index.length!==rows.length){index={length:rows.length,ids:null,groups:new Map()};rowIndexes.set(rows,index);}return index;}
function rowById(rows,id){
 const index=rowIndex(rows);
 if(!index.ids){index.ids=new Map();for(let i=rows.length-1;i>=0;i--)index.ids.set(rows[i]?.id,i);}
 const at=index.ids.get(id);
 if(at===undefined)return rows.find(row=>row.id===id);
 if(rows[at]?.id===id)return rows[at];
 index.ids=null;return rowById(rows,id);
}
function rowsWhere(rows,key,value){
 const index=rowIndex(rows);let group=index.groups.get(key);
 if(!group){group=new Map();for(const row of rows){const list=group.get(row[key]);if(list)list.push(row);else group.set(row[key],[row]);}index.groups.set(key,group);}
 return group.get(value)||[];
}
