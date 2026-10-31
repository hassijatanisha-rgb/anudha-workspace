import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {statusTone} from './helpers/status-ui.mjs';

const today='2026-10-29',now=Date.parse(today+'T10:00:00Z');
class Clock extends Date{static now(){return now}}
function fixture(){
 const c=vm.createContext({statusTone,Date:Clock,me:{user_id:'actor',role:'owner'},companyDate:()=>today,employeeName:id=>id||'Unassigned',products:[{id:'product',name:'Product'}],organizations:[],orgIndex:new Map([['client',{name:'Client'}]]),salesProformas:[],rowsWhere:(rows,key,id)=>rows.filter(row=>row[key]===id),esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')});
 for(const file of ['sales-domain.js','pending-stock.js','purchasing.js','customer-requests.js','travel.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),c);
 vm.runInContext("pendingToday=()=> '2026-10-29';travelPageData={as_of:'2026-10-29T10:00:00Z'}",c);return c;
}
function chip(html,legacy,tone,label){assert.ok(html.includes(`class="${legacy} chip chip--${tone}">${label}</span>`),`${label}: ${legacy} / ${tone}`);}

test('Pending status chips distinguish fulfilled from cancelled/expired and preserve advisory availability states',()=>{
 const c=fixture(),base={id:'pending',request_number:'PS-1',product_id:'product',organization_id:'client',quantity:5,salesperson_user_id:'actor',status:'waiting',expires_on:'2027-01-01',extension_count:0};
 for(const [change,available,tone,detailLabel,summaryLabel]of [
  [{},5,'success','Stock arrived: 5 available — reconfirm with the customer','Stock arrived'],
  [{},2,'warning','Partly available: 2 of 5 — reconfirm with the customer','Partly available'],
  [{},0,'warning','Waiting for stock','Waiting for stock'],
  [{},null,'warning','Stock check unavailable','Stock check unavailable'],
  [{expires_on:'2026-10-28'},5,'danger','Pending period ended — close or extend','Close or extend'],
  [{expires_on:'2026-10-28',proforma_line_id:'line'},5,'danger','Follow-up overdue · order remains pending','Follow-up overdue'],
  [{status:'fulfilled'},5,'success','Fulfilled','Fulfilled'],
  [{status:'fulfilled',proforma_line_id:'line'},5,'success','Allocated to invoice','Allocated to invoice'],
  [{status:'cancelled'},5,'neutral','Cancelled','Cancelled'],
  [{status:'expired'},5,'neutral','Closed after six months','Closed after six months']
 ]){
  const row={...base,...change,available_units:available},before=JSON.stringify(row),state=c.pendingStockState(row,available,today);
  chip(c.pendingCard({row,state}),'tag',tone,detailLabel);chip(c.pendingSummaryCard(row,available===null),'tag',tone,summaryLabel);assert.equal(JSON.stringify(row),before);
 }
});
test('Purchasing status chips distinguish approval, waiting goods, overdue arrival, confirmed arrival and cancellation',()=>{
 const c=fixture(),labels={requested:'Needs owner approval',approved:'Approved · order now',ordered:'Ordered · waiting for goods',closed:'Goods arrived',cancelled:'Cancelled'};
 for(const [status,date,tone]of [['requested',null,'warning'],['approved','2026-10-01','info'],['ordered','2026-10-30','warning'],['ordered','2026-10-28','danger'],['closed','2026-10-01','success'],['cancelled',null,'neutral']]){
  const row={id:'purchase',po_number:'PO-1',kind:'orders',status,expected_on:date,requested_by:'actor'},before=JSON.stringify(row);
  for(const html of [c.purchaseCard(row),c.purchaseSummaryCard(row)])chip(html,`tag purchase-tag-${status}`,tone,labels[status]);assert.equal(JSON.stringify(row),before);
 }
});
test('Supplier availability is consistent between the register and complete card',()=>{
 const c=fixture();for(const active of [true,false]){const row={id:'supplier',kind:'suppliers',supplier_number:'SUP-1',name:'Supplier',active};for(const html of [c.supplierCard(row),c.purchaseSummaryCard(row)])chip(html,'tag',active?'success':'neutral',active?'Active':'Inactive');}
});
test('Customer Requests closed is neutral because closure does not prove resolution; sent confirmation remains success',()=>{
 const c=fixture();for(const [status,tone,label]of [['received','warning','New'],['in_progress','info','Being handled'],['resolved','success','Resolved'],['closed','neutral','Closed']]){
  const row={id:'request',kind:'inquiry',status,request_number:'REQ-1',name:'Client',phone:'0712345678',message:'Question',confirmation_status:'sent'},before=JSON.stringify(row);
  const detail=c.requestCard(row);chip(detail,`travel-tag request-tag-${status}`,tone,label);chip(c.requestSummaryCard(row),`tag request-tag-${status}`,tone,label);chip(detail,'tag request-sent','success','Confirmation sent');assert.equal(JSON.stringify(row),before);
 }
});
test('Travel distinguishes declined from cancelled despite their shared closed feature class and never treats approval as completion',()=>{
 const c=fixture();for(const [status,depart,ret,state,tone,label]of [
  ['requested','11:00','12:00','waiting','warning','Waiting for approval'],
  ['approved','11:00','12:00','approved','info','Approved'],
  ['approved','09:00','11:00','away','info','Away now'],
  ['approved','08:00','09:00','approved','info','Approved'],
  ['declined','11:00','12:00','closed','danger','Declined'],
  ['cancelled','11:00','12:00','closed','neutral','Cancelled'],
  ['done','08:00','09:00','done','success','Trip done']
 ]){
  const row={id:'trip',request_number:'TR-1',status,created_by:'actor',travellers:['actor'],traveller_ids:['actor'],traveller_count:1,stop_count:1,first_place:'Destination',destination:'Destination',purpose:'meeting',depart_at:today+'T'+depart+':00Z',return_at:today+'T'+ret+':00Z'},before=JSON.stringify(row);
  for(const html of [c.travelCard(row),c.travelSummaryCard(row)])chip(html,`travel-tag travel-tag-${state}`,tone,label);assert.equal(JSON.stringify(row),before);
 }
});
