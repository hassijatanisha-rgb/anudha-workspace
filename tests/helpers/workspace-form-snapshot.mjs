import vm from 'node:vm';
import {readFileSync} from 'node:fs';

// Supply successful controls to the real snapshot helper in the small DOM fixtures.
export function installWorkspaceFormSnapshot(context){
 context.FormData.prototype[Symbol.iterator]=function*(){
  for(const control of this.form.querySelectorAll('input,select,textarea')){
   const name=control.name||control.getAttribute?.('name')||control.attributes?.name;
   if(!name||control.disabled||(['checkbox','radio'].includes(control.type)&&!control.checked))continue;
   yield [name,control.type==='checkbox'?(control.value||'on'):control.value??''];
  }
 };
 const source=readFileSync(new URL('../../ui-dialogs.js',import.meta.url),'utf8');
 vm.runInContext(source.split('\n').find(line=>line.startsWith('function workspaceFormSnapshot(')),context);
}
