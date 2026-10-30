import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {draftFixture,recordId} from './proforma-draft-fixture.mjs';
import {dispatchFocusout} from './native-form-controls.mjs';
const read=name=>readFileSync(new URL('../../'+name,import.meta.url),'utf8');
export function deliveryApprovalFixture({runtime=false}={}){
 const f=draftFixture({mount:false});f.actor.access=['deliveries'];f.ctx.location.hash='#/go/sales/delivery';
 f.get("salesSection='delivery';salesEditing='p';salesLoaded=true;salesProformas=[{id:'p',version:3,status:'accepted',document_number:'PF-FICTIONAL'},{id:'other',version:1}];salesProformaPageKey='cached';salesDeliveryPageKey='cached';");
 f.ctx.FormData=class{constructor(form){this.values=form.querySelectorAll('[name]').filter(control=>!control.disabled&&!(['radio','checkbox'].includes(control.type)&&!control.checked)).map(control=>[control.name,control.value]);}get(name){return this.values.find(([key])=>key===name)?.[1]??null;}};
 const content=f.document.querySelector('#content');content.innerHTML=f.ctx.deliveryEditor({id:'p',version:3,document_number:'PF-FICTIONAL'});const form=content.querySelector('#deliveryForm');
 f.form=()=>form;f.field=name=>form.querySelector(`[name="${name}"]`);f.select=value=>{form.querySelectorAll('[name="collection"]').forEach(control=>control.checked=control.value===value);};f.field('accountsReference').value='Approved reference';f.select('delivery');
 f.ctx.confirmWorkspaceLeave=current=>f.ctx.salesConfirmLeave(current);f.ctx.askConfirm=async()=>false;f.write=()=>({data:{id:recordId,version:1}});f.ctx.bindSalesDelivery();
 if(runtime){
  const proto=Object.getPrototypeOf(f.document.body);proto.getBoundingClientRect=()=>({left:40,top:40,bottom:84,width:180,height:44});proto.getClientRects=function(){return this.isConnected?[{}]:[];};
  Object.defineProperties(proto,{classList:{get(){return {add:name=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),name])].join(' ');},remove:name=>{this.className=this.className.split(' ').filter(value=>value!==name).join(' ');},contains:name=>this.className.split(' ').includes(name)};}},form:{get(){return this.closest('form');}}});
  f.document.addEventListener=()=>{};f.document.documentElement={clientWidth:1280,clientHeight:900};f.ctx.getComputedStyle=()=>({visibility:'visible'});const notice=f.document.createElement('div');notice.setAttribute('id','notice');f.document.body.append(notice);
  const app=read('app.js');vm.runInContext(read('action-feedback.js')+'\n'+app.split('\n').find(line=>line.startsWith('function message('))+'\n'+app.slice(app.indexOf('function friendlyError('),app.indexOf('let editSaving=false;')),f.ctx);
 }
 f.blur=dispatchFocusout;f.submit=()=>f.ctx.createDeliveryForm(form);f.submitEvent=()=>form.events.submit[0].fn({preventDefault(){},currentTarget:form,submitter:form.querySelector('[type="submit"]')});return f;
}
