import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../ui-page-header.js',import.meta.url),'utf8');
export function installPageHeader(context){if(typeof context.workspacePageHeader!=='function')vm.runInContext(source,context);}
const context=vm.createContext({esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))});
installPageHeader(context);
export const workspacePageHeader=context.workspacePageHeader;
