import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../ui-motion.js',import.meta.url),'utf8');
export function installStockTransition(context){
 if(!context.clearWorkspaceStockTransition)vm.runInContext(source.slice(source.indexOf('let workspaceStockTransitionIntent=')),context);
}
