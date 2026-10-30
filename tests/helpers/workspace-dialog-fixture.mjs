import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const snapshot=readFileSync(new URL('../../ui-dialogs.js',import.meta.url),'utf8').split('\n').find(line=>line.startsWith('function workspaceFormSnapshot('));
// Caller tests retain native close effects; the shared helper suite owns animation and backdrop behavior.
export function installWorkspaceDialogFixture(context){
 const state={opened:[],bindings:new Map(),closeCalls:0,wait:null,discard:false};
 if(!context.FormData)context.FormData=class{constructor(form){this.form=form;}get(name){return this.form.querySelector(`[name="${name}"]`)?.value??null;}};
 context.FormData.prototype[Symbol.iterator]=function*(){
  for(const input of this.form.querySelectorAll('[name]')){
   if(input.disabled)continue;const type=input.getAttribute('type'),name=input.getAttribute('name');
   if(['checkbox','radio'].includes(type)&&!input.checked&&input.getAttribute('checked')===null)continue;
   yield [name,type==='file'?(input.files?.[0]||{name:'',size:0,lastModified:0}):input.value];
  }
 };
 vm.runInContext(snapshot,context);
 context.showWorkspaceDialog=(dialog,options)=>{state.opened.push({dialog,...options});dialog.showModal();dialog.open=true;return dialog;};
 context.closeWorkspaceDialog=async dialog=>{state.closeCalls++;if(state.wait&&!await state.wait.promise)return false;dialog.close();dialog.open=false;const trigger=state.opened.find(item=>item.dialog===dialog)?.trigger;if(trigger?.isConnected&&!trigger.disabled)trigger.focus();return true;};
 context.bindWorkspaceDialogDismiss=(dialog,options)=>{
  state.bindings.set(dialog,options);
  const requestClose=async()=>{if(options.isBusy()||options.isDirty()&&!state.discard)return false;return context.closeWorkspaceDialog(dialog);};
  dialog.addEventListener('cancel',event=>{event.preventDefault();return requestClose();});return requestClose;
 };
 return state;
}
