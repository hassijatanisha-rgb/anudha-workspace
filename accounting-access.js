'use strict';

// UX gate only: every financial table/RPC also requires database authorization.
// Never infer financial access from a display name, email substring or owner role.
async function requireAccountingAccess(backend,currentIdentity){
 const actor=currentIdentity()?.user_id;
 if(!actor)throw Error('Sign in before opening accounting.');
 let result;
 try{result=await backend.rpc('accounting_access')}
 catch{throw Error('Accounting access could not be verified. Please retry.');}
 if(currentIdentity()?.user_id!==actor)throw Error('Your login changed. Reopen accounting.');
 if(result?.error)throw Error('Accounting access could not be verified. Please retry.');
 if(result?.data!==true)throw Error('Accounting access is restricted to approved financial users.');
 return actor;
}
