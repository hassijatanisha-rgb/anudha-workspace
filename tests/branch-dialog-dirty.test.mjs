import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dom} from './helpers/dom-identity.mjs';
import {installNativeFormControls} from './helpers/native-form-controls.mjs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
function fixture(){
 const document=dom(),prototype=Object.getPrototypeOf(document.body),questions=[];
 installNativeFormControls(document);
 Object.defineProperties(prototype,{
  id:{get(){return this.attrs.id||''},set(value){this.attrs.id=value}},className:{get(){return this.attrs.class||''},set(value){this.attrs.class=value}},
  elements:{get(){return {namedItem:name=>this.querySelector(`[name="${name}"]`)}}},
  style:{get(){return this._style??={setProperty(){},removeProperty(key){delete this[key]}}}},
  classList:{get(){return {add:token=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),token])].join(' ')},remove:token=>{this.className=this.className.split(' ').filter(value=>value!==token).join(' ')}}}}
 });
 prototype.reset=function(){};prototype.add=function(option){this.append(option)};prototype.reportValidity=()=>true;prototype.getBoundingClientRect=()=>({left:0,top:0,width:400,height:300,right:400,bottom:300});prototype.animate=()=>({finished:Promise.resolve(),cancel(){}});
 const trigger=document.createElement('button');document.body.append(trigger);trigger.focus();
 const rows=[{id:'parent',name:'Main Clinic',location:'City',type:'Clinic'},{id:'branch',name:'Suggested Branch',location:'City',type:'Clinic'},{id:'other',name:'Other Branch',location:'City',type:'Clinic'}];
 const context=vm.createContext({document,me:{user_id:'owner'},actionFeedbackEpoch:1,canEditRecords:()=>true,recordsLockedText:'Locked',organizations:rows,organizationSaveContext:()=>({current:()=>true}),esc:String,actionFeedbackRememberDialog(){},linkBranch:()=>assert.fail('Dismissal must not write'),matchMedia:()=>({matches:false}),getComputedStyle:()=>({opacity:'1',transform:'none',getPropertyValue:key=>key==='--m-fade'?'150ms':'200ms'}),FormData:class{
  constructor(form){this.entries=form.querySelectorAll('[name]').filter(node=>!node.disabled&&(node.tag!=='select'||node.querySelector('option'))).map(node=>[node.getAttribute('name'),node.value]);}
  [Symbol.iterator](){return this.entries[Symbol.iterator]();}
 },Option:function(label,value){const option=document.createElement('option');option.value=value;option.setAttribute('value',value);option.textContent=label;return option;}});
 vm.runInContext(read('client-rules.js')+'\n'+read('ui-dialogs.js')+'\n'+read('action-forms.js'),context);context.askConfirm=async options=>{questions.push(options);return false};
 const form=context.openBranchForm(rows[0],rows[1]),dialog=form.closest('dialog'),select=form.elements.namedItem('branch_id'),search=form.elements.namedItem('branch_search');
 const close=()=>form.querySelector('#actionCancel').events.click[0].fn();
 return {context,form,dialog,select,search,questions,close,get:code=>vm.runInContext(code,context)};
}
test('untouched prefilled branch suggestion closes without a discard prompt',async()=>{
 const f=fixture();assert.equal(f.select.value,'branch');assert.equal(f.get('actionInitialValues'),f.context.workspaceFormSnapshot(f.form));assert.equal(await f.close(),true);assert.equal(f.questions.length,0);assert.equal(f.dialog.open,false);
});
test('changing the prefilled branch asks before dismissal and declining preserves the selection',async()=>{
 const f=fixture();f.select.value='other';f.select.emit('change');assert.equal(await f.close(),false);assert.equal(f.dialog.open,true);assert.equal(f.select.value,'other');assert.match(f.form.querySelector('#branchRelationship').textContent,/Other Branch/);assert.equal(f.questions[0].confirmLabel,'Discard changes');f.context.askConfirm=async()=>true;assert.equal(await f.close(),true);assert.equal(f.dialog.open,false);
});
test('subsequent search population never resets the initial selection baseline',async()=>{
 const f=fixture(),initial=f.get('actionInitialValues');f.search.value='Other';f.search.emit('input');f.select.value='other';f.select.emit('change');assert.equal(f.get('actionInitialValues'),initial);assert.notEqual(f.context.workspaceFormSnapshot(f.form),initial);assert.equal(await f.close(),false);assert.equal(f.select.value,'other');assert.equal(f.questions.length,1);
});
