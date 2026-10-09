-- Packing queue (migration 078): queue order (customer waiting in the lobby first, then delivery, first come first
-- served within each), one order per packer, Packed frees the packer, put back in the queue, permissions, the
-- 30-minute overdue alert, the lobby flag, the delivery promise and the live order line. The two-session test of
-- Take next is tests/sql/packing-queue-concurrency.sh.
-- Disposable database with the schema and migrations up to 078; fictional users only; everything is rolled back.
--   psql -d <disposable> -v ON_ERROR_STOP=1 -f tests/sql/packing-queue.sql   (prints passed/failed)
begin;
create temp table results(name text, ok boolean, detail text) on commit drop;
grant all on results to authenticated;
create temp table orders(n integer primary key, note uuid, proforma uuid) on commit drop;
grant all on orders to authenticated;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-0000000007a1','owner@pq'),('00000000-0000-4000-8000-0000000007a2','storeshead@pq'),
 ('00000000-0000-4000-8000-0000000007a3','packer1@pq'),('00000000-0000-4000-8000-0000000007a4','packer2@pq'),
 ('00000000-0000-4000-8000-0000000007a5','travelonly@pq'),('00000000-0000-4000-8000-0000000007a6','sales@pq'),
 ('00000000-0000-4000-8000-0000000007a7','packer3@pq'),('00000000-0000-4000-8000-0000000007a8','saleshead@pq');
insert into public.staff(user_id,role,active,department,access) values
 ('00000000-0000-4000-8000-0000000007a1','owner',true,'management','{}'),
 ('00000000-0000-4000-8000-0000000007a2','head',true,'stores','{deliveries,stock}'),
 ('00000000-0000-4000-8000-0000000007a3','staff',true,'stores','{deliveries,stock}'),
 ('00000000-0000-4000-8000-0000000007a4','staff',true,'stores','{deliveries,stock}'),
 ('00000000-0000-4000-8000-0000000007a5','staff',true,'stores','{travel}'),
 ('00000000-0000-4000-8000-0000000007a6','staff',true,'sales','{leads,proformas}'),
 ('00000000-0000-4000-8000-0000000007a7','staff',true,'stores','{deliveries,stock}'),
 ('00000000-0000-4000-8000-0000000007a8','head',true,'sales','{leads,proformas,deliveries}');
set local role authenticated;
do $$ begin perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-4000-8000-0000000007a1','role','authenticated','aal','aal1')::text, true); end $$;
do $$ begin perform public.set_staff_display_name('00000000-0000-4000-8000-0000000007a2',0,'Head Fixture'); end $$;
do $$ begin perform public.set_staff_display_name('00000000-0000-4000-8000-0000000007a3',0,'Juma Fixture'); end $$;
do $$ begin perform public.set_staff_display_name('00000000-0000-4000-8000-0000000007a4',0,'Asha Fixture'); end $$;
do $$ begin perform public.set_staff_display_name('00000000-0000-4000-8000-0000000007a5',0,'Travel Fixture'); end $$;
do $$ begin perform public.set_staff_display_name('00000000-0000-4000-8000-0000000007a6',0,'Jamila Fixture'); end $$;
do $$ begin perform public.set_staff_display_name('00000000-0000-4000-8000-0000000007a7',0,'Baraka Fixture'); end $$;
do $$ begin perform public.set_staff_display_name('00000000-0000-4000-8000-0000000007a8',0,'Sales Head Fixture'); end $$;
reset role;
update public.staff set display_name='Owner Fixture',name_version=1 where user_id='00000000-0000-4000-8000-0000000007a1';
insert into public.organizations(id,name) values('00000000-0000-4000-8000-0000000007b1','Fixture Packing Clinic');
insert into public.contacts(id,organization_id,title,first_name,last_name,position,phone_country,country_code,phone,status)
 values('00000000-0000-4000-8000-0000000007b2','00000000-0000-4000-8000-0000000007b1','Doctor','Neema','Fixture','Buyer','TZ','+255','712345222','review');
insert into public.products(id,name,sku) values
 ('00000000-0000-4000-8000-0000000007c1','Fixture Glucose Strips','FXP-1'),
 ('00000000-0000-4000-8000-0000000007c2','Fixture Analyser Machine','FXP-2'),
 ('00000000-0000-4000-8000-0000000007c3','Fixture Scarce Reagent','FXP-3');
insert into public.product_inventory_classifications(id,product_id,version,category,reason,created_by) values
 (gen_random_uuid(),'00000000-0000-4000-8000-0000000007c2',1,'machines','Fixture machine','00000000-0000-4000-8000-0000000007a1');
insert into public.inventory_locations(id,name,is_dispatch_hub,active)
 select '00000000-0000-4000-8000-0000000007d1','Fixture Haadi',true,true where not exists(select 1 from public.inventory_locations where is_dispatch_hub and active);
insert into public.product_pack_definitions(id,product_id,version,base_unit,units_per_carton,reason,created_by) values
 ('00000000-0000-4000-8000-0000000007e1','00000000-0000-4000-8000-0000000007c1',1,'box',10,'Fixture pack','00000000-0000-4000-8000-0000000007a1'),
 ('00000000-0000-4000-8000-0000000007e2','00000000-0000-4000-8000-0000000007c2',1,'unit',1,'Fixture pack','00000000-0000-4000-8000-0000000007a1'),
 ('00000000-0000-4000-8000-0000000007e3','00000000-0000-4000-8000-0000000007c3',1,'unit',1,'Fixture pack','00000000-0000-4000-8000-0000000007a1');
insert into public.inventory_lots(id,product_id,location_id,pack_definition_id,batch_number,expiry_date,loose_units)
 select '00000000-0000-4000-8000-0000000007f1'::uuid,'00000000-0000-4000-8000-0000000007c1'::uuid,(select id from public.inventory_locations where is_dispatch_hub and active order by id limit 1),'00000000-0000-4000-8000-0000000007e1'::uuid,'LATE','2030-01-01'::date,500
 union all select '00000000-0000-4000-8000-0000000007f2','00000000-0000-4000-8000-0000000007c1',(select id from public.inventory_locations where is_dispatch_hub and active order by id limit 1),'00000000-0000-4000-8000-0000000007e1','EARLY','2028-01-01',3
 union all select '00000000-0000-4000-8000-0000000007f3','00000000-0000-4000-8000-0000000007c2',(select id from public.inventory_locations where is_dispatch_hub and active order by id limit 1),'00000000-0000-4000-8000-0000000007e2','M1',null,5;

create function pg_temp.as_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-4000-8000-0000000007'||n,'role','authenticated','aal','aal1')::text, true) $$;
create function pg_temp.equals(p_name text, p_sql text, p_expect text) returns void language plpgsql as $$
declare v text; begin execute p_sql into v; insert into results values(p_name, v is not distinct from p_expect, coalesce(v,'null'));
exception when others then insert into results values(p_name,false,sqlerrm); end $$;
create function pg_temp.fails(p_name text, p_sql text, p_expect text) returns void language plpgsql as $$
begin execute p_sql; insert into results values(p_name,false,'did not fail');
exception when others then insert into results values(p_name, sqlerrm ilike '%'||p_expect||'%', sqlerrm); end $$;
-- An order of p_qty of p_product, taken through the existing steps to "Sent to downstairs sales" by the owner.
create function pg_temp.order_to_queue(p_n integer, p_product text, p_qty integer, p_lobby boolean, p_queue boolean default true) returns uuid language plpgsql as $$
declare v_pf uuid := gen_random_uuid(); v_note uuid := gen_random_uuid(); v public.sales_delivery_notes; v_p public.sales_proformas;
begin
 perform pg_temp.as_user('a1');
 v_p := public.save_sales_proforma(v_pf,0,'00000000-0000-4000-8000-0000000007b1','00000000-0000-4000-8000-0000000007b2','TZS',current_date+30,'2 weeks','Cash','',
  jsonb_build_array(jsonb_build_object('productId','00000000-0000-4000-8000-0000000007'||p_product,'description','Fixture','quantity',p_qty,'uom','pc','unitPriceMinor',1000,'discountBasisPoints',0,'taxBasisPoints',0)));
 v_p := public.advance_sales_proforma(v_pf,v_p.version,'send','');
 v_p := public.advance_sales_proforma(v_pf,v_p.version,'accept','LPO fixture');
 v := public.create_sales_delivery_note(v_note,v_pf,v_p.version,'ACC fixture',current_date,'[]');
 if p_lobby then v := public.set_delivery_customer_waiting(v_note,v.version,true); end if;
 if p_queue then
  v := public.advance_sales_delivery(v_note,v.version,'tax_invoice','','','','TI fixture '||p_n);
  v := public.advance_sales_delivery(v_note,v.version,'send_to_sales','','','','');
 end if;
 insert into orders values(p_n,v_note,v_pf);
 return v_note;
end $$;
create function pg_temp.note(p_n integer) returns uuid language sql as $$ select note from orders where n=p_n $$;
create function pg_temp.number(p_n integer) returns text language sql security definer as $$ select delivery_number from public.sales_delivery_notes where id=(select note from orders where n=p_n) $$;
create function pg_temp.version(p_n integer) returns integer language sql security definer as $$ select version from public.sales_delivery_notes where id=(select note from orders where n=p_n) $$;
create function pg_temp.take(p_user text) returns text language plpgsql as $$
declare v public.sales_delivery_notes; begin perform pg_temp.as_user(p_user); v := public.packing_take_next(); return coalesce((select n::text from orders where note=v.id),'none'); end $$;

set local role authenticated;
-- Orders reach the queue in this order: 1 delivery, 2 lobby, 3 delivery, 4 lobby.
select pg_temp.order_to_queue(1,'c1',2,false);
select pg_temp.order_to_queue(2,'c1',2,true);
select pg_temp.order_to_queue(3,'c1',2,false);
select pg_temp.order_to_queue(4,'c1',2,true);
reset role;
-- Within one transaction now() does not move, so the queue times are spread out by hand.
update public.sales_delivery_notes set packing_queued_at=now()-make_interval(mins=>60-o.n) from orders o where o.note=sales_delivery_notes.id;
-- Pre-existing waiting orders on this database are moved behind the fixtures.
update public.sales_delivery_notes set packing_queued_at=now()+interval '1 day', customer_waiting=false where status='sent_to_sales' and id not in (select note from orders);
set local role authenticated;

select pg_temp.as_user('a3');
select pg_temp.equals('board lists lobby orders first, then delivery, oldest first',
 $$select string_agg((select n::text from orders where note=(w->>'id')::uuid),',' order by ord) from jsonb_array_elements(public.packing_queue_board()->'waiting') with ordinality as t(w,ord) where (w->>'id')::uuid in (select note from orders)$$,'2,4,1,3');
select pg_temp.equals('lobby orders are marked on the board',
 $$select string_agg(w->>'customer_waiting',',' order by ord) from jsonb_array_elements(public.packing_queue_board()->'waiting') with ordinality as t(w,ord) where (w->>'id')::uuid in (select note from orders)$$,'true,true,false,false');
select pg_temp.equals('board shows the client and the items','select (public.packing_queue_board()->''waiting''->0->>''organization'')||'' · ''||(public.packing_queue_board()->''waiting''->0->''items''->0->>''name'')','Fixture Packing Clinic · Fixture Glucose Strips');

select pg_temp.equals('first packer gets the oldest lobby order','select pg_temp.take(''a3'')','2');
select pg_temp.equals('Take next is Start packing, assigned to the packer',
 'select status||'':''||(packer_user_id=''00000000-0000-4000-8000-0000000007a3'')||'':''||packing_auto_reserved from public.sales_delivery_notes where id=pg_temp.note(2)','packing:true:true');
select pg_temp.equals('stock is picked earliest expiry first, Haadi only','select string_agg(l.batch_number||''=''||d.quantity,'','' order by l.batch_number) from public.sales_delivery_lines d join public.inventory_lots l on l.id=d.lot_id where d.delivery_note_id=pg_temp.note(2)','EARLY=2');
select pg_temp.equals('the existing history row is written','select reference from public.sales_delivery_events where delivery_note_id=pg_temp.note(2) and to_status=''packing''','Packing started and stock reserved');
select pg_temp.equals('the work is handed to the packer','select count(*)::text from public.work_assignments where record_id=pg_temp.note(2) and status=''open'' and assignee_user_id=''00000000-0000-4000-8000-0000000007a3''','1');
select pg_temp.fails('one order per packer: a second Take next is refused','select pg_temp.take(''a3'')','Press Packed');
select pg_temp.equals('second packer gets the next lobby order','select pg_temp.take(''a4'')','4');
select pg_temp.equals('the earliest lot is shared out without over-reserving','select string_agg(l.batch_number||''=''||d.quantity,'','' order by l.batch_number) from public.sales_delivery_lines d join public.inventory_lots l on l.id=d.lot_id where d.delivery_note_id=pg_temp.note(4)','EARLY=1,LATE=1');
select pg_temp.equals('third packer gets the oldest delivery order','select pg_temp.take(''a7'')','1');
select pg_temp.equals('the packing list shows who packs what','select string_agg(p->>''packer_name'','','' order by p->>''packer_name'') from jsonb_array_elements(public.packing_queue_board()->''packing'') p where (p->>''id'')::uuid in (select note from orders)','Asha Fixture,Baraka Fixture,Juma Fixture');

-- Packed frees the packer for the next one.
select pg_temp.as_user('a4');
select pg_temp.fails('only the packer who took it (or the stores head / owner) marks it Packed','select public.packing_mark_packed(pg_temp.note(2),pg_temp.version(2))','Juma Fixture');
select pg_temp.as_user('a3');
select pg_temp.fails('Packed needs the current version','select public.packing_mark_packed(pg_temp.note(2),pg_temp.version(2)-1)','refresh');
select pg_temp.equals('Packed is Mark ready for delivery','select (public.packing_mark_packed(pg_temp.note(2),pg_temp.version(2))).status','ready');
select pg_temp.equals('the existing ready history row is written','select reference from public.sales_delivery_events where delivery_note_id=pg_temp.note(2) and to_status=''ready''','Packing and stock checked');
select pg_temp.equals('after Packed the packer takes the next order','select pg_temp.take(''a3'')','3');

-- Put back in the queue.
select pg_temp.as_user('a3');
select pg_temp.fails('a packer cannot put an order back','select public.packing_release(pg_temp.note(3),pg_temp.version(3),''Fixture reason'')','owner or the stores head');
select pg_temp.as_user('a8');
select pg_temp.fails('a head of another department cannot put an order back','select public.packing_release(pg_temp.note(3),pg_temp.version(3),''Fixture reason'')','owner or the stores head');
select pg_temp.as_user('a2');
select pg_temp.fails('a reason is required','select public.packing_release(pg_temp.note(3),pg_temp.version(3),'' '')','why');
select pg_temp.equals('the stores head puts it back in the queue','select (public.packing_release(pg_temp.note(3),pg_temp.version(3),''Juma went home sick'')).status','sent_to_sales');
select pg_temp.equals('its picked stock is released','select count(*)::text from public.sales_delivery_lines where delivery_note_id=pg_temp.note(3)','0');
select pg_temp.equals('reserved units are back to what the open orders hold','select reserved_units::text from public.inventory_lots where id=''00000000-0000-4000-8000-0000000007f1''',
 '3');
select pg_temp.equals('the packer is cleared and the reason is in the history',
 'select (packer_user_id is null)||'':''||(select reference from public.sales_delivery_events e where e.delivery_note_id=n.id and e.from_status=''packing'' and e.to_status=''sent_to_sales'') from public.sales_delivery_notes n where id=pg_temp.note(3)',
 'true:Put back in the packing queue (was with Juma Fixture): Juma went home sick');
select pg_temp.equals('it keeps its place: the next Take next gets it again','select pg_temp.take(''a3'')','3');

-- Stock shortage: skipped, shown as waiting for stock, the order behind it is taken.
select pg_temp.order_to_queue(5,'c3',4,true);
select pg_temp.order_to_queue(6,'c1',1,false);
reset role;
update public.sales_delivery_notes set packing_queued_at=now()-interval '2 hours' where id=(select note from orders where n=5);
update public.sales_delivery_notes set packing_queued_at=now()-interval '2 hours' where id=(select note from orders where n=6);
set local role authenticated;
select pg_temp.as_user('a2');
select pg_temp.equals('an order without stock is skipped; the next one is taken','select pg_temp.take(''a2'')','6');
select pg_temp.equals('the skipped order shows it is waiting for stock','select packing_blocked_reason from public.sales_delivery_notes where id=pg_temp.note(5)','Waiting for stock: Not enough stock at Haadi for Fixture Scarce Reagent (4 more needed)');

-- Overdue alert after packing_overdue_minutes() (30).
select pg_temp.equals('the setting is 30 minutes, amber at 20','select public.packing_overdue_minutes()||'':''||public.packing_amber_minutes()','30:20');
reset role;
update public.sales_delivery_notes set packing_taken_at=now()-interval '29 minutes' where id=(select note from orders where n=4);
update public.sales_delivery_notes set packing_taken_at=now()-interval '31 minutes' where id=(select note from orders where n=1);
set local role authenticated;
select pg_temp.as_user('a3');
select pg_temp.equals('29 minutes is not overdue; 31 minutes is','select public.packing_raise_overdue_alerts()::text','1');
select pg_temp.as_user('a1');
select pg_temp.equals('alert tasks go to the stores head and the owner, not the packer',
 'select bool_or(assignee_user_id=''00000000-0000-4000-8000-0000000007a1'')||'':''||bool_or(assignee_user_id=''00000000-0000-4000-8000-0000000007a2'')||'':''||bool_or(assignee_user_id in (''00000000-0000-4000-8000-0000000007a7'',''00000000-0000-4000-8000-0000000007a3'',''00000000-0000-4000-8000-0000000007a8'')) from public.team_tasks t where t.id=any((select packing_alert_task_ids from public.sales_delivery_notes where id=pg_temp.note(1))::uuid[])',
 'true:true:false');
select pg_temp.equals('the alert is urgent and names the order and packer',
 'select urgency||'' · ''||title from public.team_tasks t where t.id=(select packing_alert_task_ids[1] from public.sales_delivery_notes where id=pg_temp.note(1))',
 'do_now · Packing over 30 min: '||pg_temp.number(1)||' · Baraka Fixture');
select pg_temp.equals('alerts are raised once per take','select public.packing_raise_overdue_alerts()::text','0');
select pg_temp.equals('the board marks the overdue order as alerted','select string_agg(p->>''alerted'','','') from jsonb_array_elements(public.packing_queue_board()->''packing'') p where (p->>''id'')::uuid=pg_temp.note(1)','true');
select pg_temp.as_user('a7');
select public.packing_mark_packed(pg_temp.note(1),pg_temp.version(1));
select pg_temp.equals('Packed closes the alert tasks','select string_agg(status||'':''||close_note,'','') from (select distinct status,close_note from public.team_tasks t where t.id=any((select packing_alert_task_ids from public.sales_delivery_notes where id=pg_temp.note(1)) || (select array_agg(id) from public.team_tasks where title like ''%''||pg_temp.number(1)||''%''))) x','done:Packed after 31 min');

-- Lobby flag.
select pg_temp.order_to_queue(7,'c1',1,false,false);
select pg_temp.as_user('a6');
select pg_temp.equals('sales (Pro formas access) can mark the customer waiting at hand-off','select (public.set_delivery_customer_waiting(pg_temp.note(7),pg_temp.version(7),true)).customer_waiting::text','true');
select pg_temp.as_user('a1');
select pg_temp.equals('the change is in the delivery history','select reference from public.sales_delivery_events where delivery_note_id=pg_temp.note(7) and from_status=to_status','Customer waiting in the lobby — cash, collecting now');
select pg_temp.as_user('a5');
select pg_temp.fails('staff without Pro formas or Deliveries cannot change it','select public.set_delivery_customer_waiting(pg_temp.note(7),pg_temp.version(7),false)','access');
select pg_temp.as_user('a3');
select pg_temp.fails('it cannot change once packing has started','select public.set_delivery_customer_waiting(pg_temp.note(3),pg_temp.version(3),true)','already started');

-- Permissions.
select pg_temp.as_user('a5');
select pg_temp.fails('Take next needs Deliveries access','select public.packing_take_next()','access');
select pg_temp.fails('the board needs Deliveries access','select public.packing_queue_board()','access');
select pg_temp.as_user('a6');
select pg_temp.fails('sales without Deliveries cannot take orders','select public.packing_take_next()','access');
reset role;
select pg_temp.equals('anon cannot call Take next','select has_function_privilege(''anon'',''public.packing_take_next()'',''execute'')::text','false');
select pg_temp.equals('the stock picker is not callable by staff','select has_function_privilege(''authenticated'',''public.packing_pick_lots(public.sales_delivery_notes)'',''execute'')::text','false');
set local role authenticated;

-- Delivery promise.
select pg_temp.equals('24 working hours skip Sunday (Saturday 15:00 → Monday 15:00, Dar es Salaam)','select to_char(public.add_working_hours(''2026-10-10 15:00+03'',24) at time zone ''Africa/Dar_es_Salaam'',''Dy HH24:MI'')','Mon 15:00');
select pg_temp.order_to_queue(8,'c2',1,false,false);
select pg_temp.equals('an order with a machine is promised by availability (its agreed date)','select promise_kind||'':''||(promised_by=((expected_delivery_date+1)::timestamp at time zone ''Africa/Dar_es_Salaam''))::text from public.sales_delivery_notes where id=pg_temp.note(8)','machines:true');
select pg_temp.equals('consumables are promised within 24 working hours','select promise_kind||'':''||(promised_by=public.add_working_hours(created_at,24))::text from public.sales_delivery_notes where id=pg_temp.note(6)','consumables:true');
reset role;
update public.sales_delivery_notes set promised_by=now()-interval '3 days' where id=(select note from orders where n=3);
set local role authenticated;
select pg_temp.as_user('a3');
select pg_temp.equals('more than 2 days past the promise: Call the customer','select string_agg(p->>''call_customer'','','') from jsonb_array_elements(public.packing_queue_board()->''packing'') p where (p->>''id'')::uuid=pg_temp.note(3)','true');

-- Live line for the person who placed the order.
select pg_temp.as_user('a6');
select pg_temp.equals('sales sees their waiting order with its queue position',
 'select s->>''status''||'':''||(s->>''queue_position'') from jsonb_array_elements(public.order_live_status(array[(select proforma from orders where n=5)])) s','sent_to_sales:1');
select pg_temp.equals('and who is packing an order',
 'select s->>''status''||'':''||(s->>''packer_name'') from jsonb_array_elements(public.order_live_status(array[(select proforma from orders where n=3)])) s','packing:Juma Fixture');
select pg_temp.equals('and when it was packed',
 'select s->>''status''||'':''||((s->>''ready_at'') is not null) from jsonb_array_elements(public.order_live_status(array[(select proforma from orders where n=2)])) s','ready:true');
select pg_temp.as_user('a5');
select pg_temp.fails('staff without Pro formas or Deliveries cannot read the live line','select public.order_live_status(array[(select proforma from orders where n=2)])','access');
reset role;

select name, case when ok then 'ok' else 'FAIL' end, detail from results order by ok, name;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from results;
rollback;
