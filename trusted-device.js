'use strict';
// Where the sign-in is kept. Normally only for this browser tab (closing it signs out). After the 6-digit code, a person
// may tick "Trust this device for 30 days": the sign-in then survives closing the browser on this device only. The
// database still refuses data once the last code is more than 30 days old (migration 088), so trust cannot outlive it.
const deviceTrustKey='anudha-trusted-until',deviceTrustDays=30;
function deviceTrustedUntil(){try{return Number(localStorage.getItem(deviceTrustKey)||0)}catch{return 0}}
function deviceTrusted(now=Date.now()){return deviceTrustedUntil()>now}
function deviceStore(){return deviceTrusted()?localStorage:sessionStorage}
const deviceSessionStorage={
 getItem(key){try{return deviceStore().getItem(key)}catch{return null}},
 setItem(key,value){try{deviceStore().setItem(key,value)}catch{}},
 removeItem(key){try{localStorage.removeItem(key)}catch{}try{sessionStorage.removeItem(key)}catch{}}
};
function moveSignIn(from,to){
 const keys=[];for(let i=0;i<from.length;i++){const key=from.key(i);if(key&&key.startsWith('sb-'))keys.push(key);}
 for(const key of keys){to.setItem(key,from.getItem(key));from.removeItem(key);}
}
function trustThisDevice(now=Date.now()){
 try{localStorage.setItem(deviceTrustKey,String(now+deviceTrustDays*86400000));moveSignIn(sessionStorage,localStorage);return true}catch{return false}
}
function forgetThisDevice(){
 try{const was=deviceTrusted();localStorage.removeItem(deviceTrustKey);if(was)moveSignIn(localStorage,sessionStorage);}catch{}
}
// Trust ended (30 days passed): drop the kept sign-in so the next visit asks for the password and code again.
try{if(!deviceTrusted()&&localStorage.getItem(deviceTrustKey)!==null){localStorage.removeItem(deviceTrustKey);for(let i=localStorage.length-1;i>=0;i--){const key=localStorage.key(i);if(key&&key.startsWith('sb-'))localStorage.removeItem(key);}}}catch{}
function deviceTrustField(){return '<label class="two-step-trust"><input type="checkbox" name="trustDevice"> Trust this device for 30 days <small>Do not tick on a shared or public computer.</small></label>'}
