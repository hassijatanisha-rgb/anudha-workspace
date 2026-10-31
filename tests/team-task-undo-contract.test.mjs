import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const migration=readFileSync(new URL('../supabase/migrations/202610290153_team_task_undo.sql',import.meta.url),'utf8');
for(const name of ['close_team_task','undo_team_task'])test(`${name} rechecks effective MFA after locking current staff authorization`,()=>{
 const body=migration.split(`create or replace function public.${name}(`)[1].split('end $$;')[0];
 const lock=body.indexOf('select role into v_role from public.staff where user_id=v_actor and active for share;');
 const gate=body.indexOf('public.inventory_active_staff() is not true',lock);
 const taskLock=body.indexOf('select * into v_row from public.team_tasks where id=p_id for update;');
 assert.ok(lock>=0&&gate>lock&&taskLock>gate,'MFA must be re-evaluated after locking the current role and before task access');
 assert.match(body.slice(lock,gate),/if not found or /);
});
