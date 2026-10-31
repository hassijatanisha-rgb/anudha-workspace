import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../ui-motion.js',import.meta.url),'utf8');
// Load the actual disclosure helpers without the unrelated document-level account-menu listener.
export function installDisclosureMotion(context){vm.runInContext(source.slice(source.indexOf('const workspaceDisclosures='),source.indexOf('let workspaceStockTransitionIntent=')),context);}
