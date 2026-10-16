import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function store(){const m=new Map();return {get length(){return m.size},key:i=>[...m.keys()][i]??null,getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};}
function load(local=store(),session=store()){
 const ctx=vm.createContext({localStorage:local,sessionStorage:session,Date,Number,String,Math});
 vm.runInContext(readFileSync(new URL('../trusted-device.js',import.meta.url),'utf8'),ctx);
 return ctx;
}
test('sign-in stays in the tab until the device is trusted, then moves to the device',()=>{
 const ctx=load();
 vm.runInContext("deviceSessionStorage.setItem('sb-x-auth-token','session')",ctx);
 assert.equal(ctx.sessionStorage.getItem('sb-x-auth-token'),'session');assert.equal(ctx.localStorage.getItem('sb-x-auth-token'),null);
 assert.equal(vm.runInContext('trustThisDevice()',ctx),true);
 assert.equal(ctx.localStorage.getItem('sb-x-auth-token'),'session');assert.equal(ctx.sessionStorage.getItem('sb-x-auth-token'),null);
 assert.equal(vm.runInContext("deviceSessionStorage.getItem('sb-x-auth-token')",ctx),'session');
 vm.runInContext('forgetThisDevice()',ctx);
 assert.equal(ctx.localStorage.getItem('sb-x-auth-token'),null);assert.equal(ctx.localStorage.getItem('anudha-trusted-until'),null);
 assert.equal(ctx.sessionStorage.getItem('sb-x-auth-token'),'session','signing out of a trusted device keeps nothing on the device');
});
test('trust ends after 30 days and the kept sign-in is dropped on the next visit',()=>{
 const local=store();local.setItem('anudha-trusted-until',String(Date.now()-1000));local.setItem('sb-x-auth-token','old session');local.setItem('other','kept');
 load(local);
 assert.equal(local.getItem('sb-x-auth-token'),null);assert.equal(local.getItem('anudha-trusted-until'),null);assert.equal(local.getItem('other'),'kept');
 const ctx=load();vm.runInContext('trustThisDevice(0)',ctx);
 assert.equal(Number(ctx.localStorage.getItem('anudha-trusted-until')),30*86400000);
});
test('the app asks for a new code once the last one is over 30 days old',()=>{
 const ctx=vm.createContext({Date,Math,Number,String});
 const src=readFileSync(new URL('../two-step.js',import.meta.url),'utf8');
 vm.runInContext(src.slice(src.indexOf('function twoStepCodeStale'),src.indexOf('async function twoStepFactor')),ctx);
 const now=Date.UTC(2026,9,16),s=n=>Math.floor((now-n*86400000)/1000);
 ctx.now=now;
 assert.equal(vm.runInContext(`twoStepCodeStale([{method:'totp',timestamp:${s(29)}},{method:'password',timestamp:${s(29)}}],now)`,ctx),false);
 assert.equal(vm.runInContext(`twoStepCodeStale([{method:'totp',timestamp:${s(31)}}],now)`,ctx),true);
 assert.equal(vm.runInContext(`twoStepCodeStale([{method:'password',timestamp:${s(0)}}],now)`,ctx),true);
 assert.equal(vm.runInContext('twoStepCodeStale(undefined,now)',ctx),true);
});
