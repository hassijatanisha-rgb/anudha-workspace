// Disposable database identities only: no real authentication, network, inventory,
// fiscal operations, or multi-connection load. Actor handoffs are sequential.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

assert.ok(process.env.PGLITE_MODULE, 'Set PGLITE_MODULE to the local PGlite module');
const {PGlite} = await import(process.env.PGLITE_MODULE);
const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const employees = Array.from({length: 20}, (_, i) => ({
  id: id(i + 1),
  name: `Simulation Employee ${String(i + 1).padStart(2, '0')}`,
  role: i === 0 ? 'owner' : 'staff',
  active: i !== 19,
}));
const active = employees.filter(employee => employee.active);
const inactive = employees[19];
const as = actor => db.query("select set_config('test.actor', $1, false)", [actor ?? '']);
const save = (lead, version, fields) => db.query(
  'select * from public.save_sales_lead($1,$2,$3::jsonb)',
  [lead, version, JSON.stringify(fields)],
).then(result => result.rows[0]);
const advance = (lead, version, action, assignee = null, note = '') => db.query(
  'select * from public.advance_sales_lead($1,$2,$3,$4,$5,null)',
  [lead, version, action, assignee, note],
).then(result => result.rows[0]);
const events = lead => db.query(
  `select action,from_stage,to_stage,assigned_user_id,note,actor_user_id
   from public.sales_lead_events where lead_id=$1 order by action`, [lead],
).then(result => result.rows);
const snapshot = async lead => ({
  row: (await db.query('select * from public.sales_leads where id=$1', [lead])).rows,
  events: await events(lead),
});

try {
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as
      $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create table public.staff(user_id uuid primary key,role text,active boolean);
    create function public.inventory_active_staff() returns boolean language sql
      stable security definer set search_path=public as
      $$select exists(select 1 from public.staff where user_id=auth.uid() and active)$$;
    create table public.organizations(id uuid primary key,name text,deleted_at timestamptz);
    create table public.contacts(id uuid primary key,organization_id uuid,deleted_at timestamptz);
    create table public.sales_proformas(id uuid primary key,organization_id uuid,deleted_at timestamptz);
    create function public.inventory_owner() returns boolean language sql
      stable security definer set search_path=public as
      $$select exists(select 1 from public.staff where user_id=auth.uid() and active and role='owner')$$;
    create table public.products(id uuid primary key,deleted_at timestamptz);
    create table public.inventory_lots(id uuid primary key,product_id uuid,loose_units integer,reserved_units integer);
  `);
  for (const employee of employees) {
    await db.query('insert into auth.users values($1)', [employee.id]);
    await db.query('insert into public.staff values($1,$2,$3)', [employee.id, employee.role, employee.active]);
  }
  assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n, 20);
  await db.exec(readFileSync(new URL('../supabase/migrations/202609300042_sales_leads.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/202609300043_pending_stock_requests.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/202609300046_suppliers_purchasing.sql', import.meta.url), 'utf8'));
  await db.query('insert into public.organizations values($1,$2,null)', [id(3000), 'Fictional simulation clinic']);
  await db.query('insert into public.products values($1,null)', [id(3001)]);
  await db.query('insert into public.inventory_lots values($1,$2,100,10)', [id(3002),id(3001)]);
  await db.exec('set role authenticated');
  assert.equal((await db.query('select current_user as actor_role')).rows[0].actor_role, 'authenticated');

  for (let i = 0; i < active.length; i++) {
    const actor = offset => active[(i + offset) % active.length].id;
    const lead = id(1000 + i);
    const fields = {
      subject: `SIMULATION inquiry ${i + 1}`,
      caller_name: `Fictional Caller ${i + 1}`,
      caller_phone: `SIM-${String(i + 1).padStart(6, '0')}`,
      source: 'phone',
    };
    const expected = [];
    const event = (action, from, to, assigned, note, by) => expected.push({
      action, from_stage: from, to_stage: to, assigned_user_id: assigned,
      note, actor_user_id: by,
    });
    await as(actor(0));
    let row = await save(lead, 0, fields);
    assert.equal(row.stage, 'inquiry');
    assert.equal(row.created_by, actor(0));
    event('create', null, 'inquiry', null, fields.subject, actor(0));

    // Two employees have observed version 1; the later stale write must fail.
    const observedVersion = row.version;
    await as(actor(1));
    row = await advance(lead, observedVersion, 'qualify', actor(1), 'Qualified by simulated employee');
    event('qualify', 'inquiry', 'lead', actor(1), 'Qualified by simulated employee', actor(1));
    const beforeConflict = await snapshot(lead);
    await as(actor(2));
    await assert.rejects(save(lead, observedVersion, {...fields, subject: 'Stale employee edit'}), /changed/);
    assert.deepEqual(await snapshot(lead), beforeConflict, 'stale edit leaves record and history unchanged');
    await assert.rejects(advance(lead, observedVersion, 'assign', actor(2)), /changed/);
    assert.deepEqual(await snapshot(lead), beforeConflict, 'stale handoff leaves record and history unchanged');
    await assert.rejects(advance(lead, row.version, 'assign', inactive.id), /active employee/);

    row = await advance(lead, row.version, 'assign', actor(2), 'Simulated sales handoff');
    event('assign', 'lead', 'lead', actor(2), 'Simulated sales handoff', actor(2));
    await as(actor(3));
    row = await save(lead, row.version, {...fields, next_action: 'Call fictional customer', next_action_on: '2099-01-01'});
    assert.equal(row.next_action, 'Call fictional customer');
    assert.equal(row.owner_user_id, actor(2));
    event('edit', 'lead', 'lead', actor(2), 'Details updated', actor(3));
    await as(actor(4));
    row = await advance(lead, row.version, 'opportunity', null, 'Fictional customer interested');
    event('opportunity', 'lead', 'opportunity', actor(2), 'Fictional customer interested', actor(4));
    await as(actor(5));
    row = await advance(lead, row.version, 'lost', null, 'Fictional customer postponed');
    event('lost', 'opportunity', 'lost', actor(2), 'Fictional customer postponed', actor(5));
    await as(active[0].id);
    row = await advance(lead, row.version, 'reopen', null, 'Fictional customer returned');
    event('reopen', 'lost', 'lead', actor(2), 'Fictional customer returned', active[0].id);
    assert.equal(row.version, 7);
    assert.equal(row.stage, 'lead');
    assert.equal(row.lost_reason, '');
    assert.deepEqual(await events(lead), expected.sort((a, b) => a.action.localeCompare(b.action)));
  }

  await assert.rejects(db.query('update public.sales_leads set subject=$1', ['Forbidden direct edit']), /permission denied/);
  await assert.rejects(db.query('update public.sales_lead_events set note=$1', ['Forbidden rewrite']), /permission denied/);
  await assert.rejects(db.query('delete from public.sales_leads'), /permission denied/);
  const beforeDenied = await snapshot(id(1000));
  await as(inactive.id);
  await assert.rejects(save(id(2000), 0, {subject: 'Inactive inquiry'}), /Active staff/);
  await assert.rejects(advance(id(1000), 7, 'lost', null, 'Inactive closure'), /Active staff/);
  assert.equal((await db.query('select count(*)::int n from public.sales_leads')).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int n from public.sales_lead_events')).rows[0].n, 0);
  await as(null);
  await assert.rejects(advance(id(1000), 7, 'lost', null, 'Missing identity'), /Active staff/);
  await db.exec('reset role; set role anon');
  await assert.rejects(save(id(2000), 0, {subject: 'Anonymous inquiry'}), /permission denied/);
  await db.exec('reset role; set role authenticated');
  await as(active[0].id);
  assert.deepEqual(await snapshot(id(1000)), beforeDenied);
  assert.equal((await db.query('select count(*)::int n from public.sales_leads')).rows[0].n, 19);
  assert.equal((await db.query('select count(*)::int n from public.sales_lead_events')).rows[0].n, 133);
  assert.equal((await db.query('select count(distinct actor_user_id)::int n from public.sales_lead_events')).rows[0].n, 19);

  // Actual 043 contract linked to actual 042 leads, not a placeholder lead table.
  // Keep balances waiting: a string reference is not proof of invoice issuance.
  for(let i=0;i<active.length;i++){
    const creator=active[i].id,salesperson=active[(i+1)%active.length].id,request=id(4000+i);
    const args=[request,id(3000),null,id(3001),i+1,null,id(1000+i),salesperson,'Fictional stock follow-up'];
    const create=()=>db.query('select * from public.create_pending_stock_request($1,$2,$3,$4,$5,$6,$7,$8,$9)',args).then(r=>r.rows[0]);
    await as(creator);
    const pending=await create();assert.equal(pending.lead_id,id(1000+i));assert.equal(pending.salesperson_user_id,salesperson);
    assert.equal(pending.status,'waiting');assert.equal((await create()).id,request);
    assert.equal((await db.query('select count(*)::int n from public.pending_stock_events where request_id=$1',[request])).rows[0].n,1);
    const due=(await db.query("select (current_date+interval '6 months')::date d")).rows[0].d;
    assert.equal(new Date(pending.expires_on).getTime(),new Date(due).getTime());
    await as(active[1].id);
    await assert.rejects(db.query("select public.advance_pending_stock_request($1,1,'extend','Simulation extension',1)",[request]),/Only the owner/);
    await as(active[0].id);
    const extended=(await db.query("select * from public.advance_pending_stock_request($1,1,'extend','Simulation extension',1)",[request])).rows[0];
    assert.equal(extended.version,2);assert.equal(extended.extension_count,1);
    await assert.rejects(db.query("select public.advance_pending_stock_request($1,1,'extend','Stale extension',1)",[request]),/changed/);
    const trail=(await db.query('select action,actor_user_id from public.pending_stock_events where request_id=$1 order by action',[request])).rows;
    assert.deepEqual(trail,[{action:'create',actor_user_id:creator},{action:'extend',actor_user_id:active[0].id}]);
  }
  await as(inactive.id);
  assert.equal((await db.query('select count(*)::int n from public.pending_stock_requests')).rows[0].n,0);
  await as(active[0].id);
  assert.equal((await db.query("select count(*)::int n from public.pending_stock_requests where status='waiting'")).rows[0].n,19);
  assert.equal((await db.query('select count(*)::int n from public.pending_stock_events')).rows[0].n,38);
  await assert.rejects(db.query('delete from public.pending_stock_requests'),/permission denied/);

  // Purchasing references the real pending rows created above. No outbound transport exists.
  await as(active[1].id);
  const supplier=(await db.query('select * from public.save_supplier($1,0,$2::jsonb)',[id(5000),JSON.stringify({name:'SIMULATION supplier',email:'orders@example.invalid'})])).rows[0];
  for(let i=0;i<active.length;i++){
    const buyer=active[i].id,po=id(6000+i),pending=id(4000+i);
    const lines=JSON.stringify([{product_id:id(3001),quantity:i+1,pending_request_id:pending,note:'Fictional linked purchase'}]);
    await as(buyer);
    const request=(await db.query("select * from public.save_purchase_request($1,0,$2,'TZS',null,'Simulation only',$3::jsonb)",[po,supplier.id,lines])).rows[0];
    assert.equal(request.status,'requested');assert.equal(request.requested_by,buyer);
    assert.equal((await db.query('select pending_request_id from public.purchase_order_lines where purchase_order_id=$1',[po])).rows[0].pending_request_id,pending);
    // Every ordinary active employee attempts approval; all must be refused.
    await as(active[(i%18)+1].id);
    await assert.rejects(db.query("select public.advance_purchase_order($1,1,'approve')",[po]),/Only the owner can approve/);
    await assert.rejects(db.query("select public.advance_purchase_order($1,1,'order','','SIM-LPO')",[po]),/Approve the purchase/);
    await as(active[0].id);
    const approved=(await db.query("select * from public.advance_purchase_order($1,1,'approve')",[po])).rows[0];
    assert.equal(approved.approved_by,active[0].id);assert.equal(approved.version,2);
    await as(buyer);
    await assert.rejects(db.query("select public.advance_purchase_order($1,1,'order','','SIM-LPO')",[po]),/changed/);
    const ordered=(await db.query("select * from public.advance_purchase_order($1,2,'order','',$2)",[po,`SIM-LPO-${i+1}`])).rows[0];
    assert.equal(ordered.status,'ordered');assert.equal(ordered.ordered_by,buyer);
    const trail=(await db.query('select action,actor_user_id from public.purchase_order_events where purchase_order_id=$1 order by action',[po])).rows;
    assert.deepEqual(trail,[{action:'approve',actor_user_id:active[0].id},{action:'order',actor_user_id:buyer},{action:'request',actor_user_id:buyer}]);
  }
  await as(inactive.id);
  await assert.rejects(db.query("select public.advance_purchase_order($1,3,'close','Fictional delivery')",[id(6000)]),/Active staff/);
  assert.equal((await db.query('select count(*)::int n from public.purchase_orders')).rows[0].n,0);
  await as(active[0].id);
  assert.equal((await db.query('select count(*)::int n from public.purchase_orders')).rows[0].n,19);
  assert.equal((await db.query('select count(*)::int n from public.purchase_order_events')).rows[0].n,57);
  await assert.rejects(db.query('update public.purchase_orders set notes=$1',['Forbidden']),/permission denied/);

  // Check trigger immutability separately from authenticated privilege denial.
  await db.exec('reset role');
  assert.deepEqual((await db.query('select loose_units,reserved_units from public.inventory_lots')).rows,[{loose_units:100,reserved_units:10}]);
  await assert.rejects(db.query('update public.sales_lead_events set note=$1', ['Forbidden rewrite']), /immutable/);
  assert.equal((await db.query('select count(*)::int n from public.sales_proformas')).rows[0].n, 0);
  console.log('PASS: 20 fictional database identities (19 active, 1 inactive); 19 sequential lead workflows; 133 actor-verified events; authenticated RPCs and RLS; assignment, follow-up, stage transitions, stale conflicts, inactive/anonymous denial, and immutable history.');
  console.log('PASS: 19 linked pending requests, 38 actor-verified events, stable-ID replay, six-month deadlines, owner-only extensions, stale rejection and inactive RLS; sentinel stock unchanged. No pending balance marked invoiced or fulfilled.');
  console.log('PASS: 19 linked purchase orders, 57 actor-verified events; all 18 active non-owners denied approval, owner approval and buyer ordering verified, stale writes/inactive access/direct updates denied. Ordered is database state only, not an actual sent order; receipt remains untested.');
  console.log('LIMIT: simulated database identities, not real authentication logins or genuine concurrent connections. In-memory PGlite only; no network, inventory, fiscal, or production operations.');
} finally {
  await db.close();
}
