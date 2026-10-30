import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const migration=readFileSync(new URL('../supabase/migrations/202610290154_proforma_archive_undo.sql',import.meta.url),'utf8');
for(const name of ['set_draft_proforma_archived','undo_draft_proforma_archive'])test(`${name} rechecks effective owner/MFA authorization after locking current staff`,()=>{
 const body=migration.split(`function public.${name}(`)[1].split('end $$;')[0];
 const lock=body.indexOf("perform 1 from public.staff where user_id=v_actor and active and role='owner' for share;");
 const gate=body.indexOf('public.inventory_owner() is not true',lock);
 const rowLock=body.indexOf('select * into v_row from public.sales_proformas where id=p_id for update;');
 assert.ok(lock>=0&&gate>lock&&rowLock>gate);
 assert.match(body.slice(lock,gate),/if not found or /);
 assert.ok(body.indexOf('v_now:=clock_timestamp();')>rowLock,'Capture the Undo clock only after row serialization');
});
