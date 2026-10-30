import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({});
vm.runInContext(readFileSync(new URL('../../status-ui.js',import.meta.url),'utf8'),context);
export const statusTone=context.statusTone;
