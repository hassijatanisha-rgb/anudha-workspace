#!/usr/bin/env bash
# Packing queue (migration 078): two packers pressing Take next at the same moment never get the same order, and one
# packer pressing twice at once gets only one order. Two real database sessions; the first holds its transaction open
# while the second presses. Fixtures are COMMITTED, so use a disposable database (fictional users, fresh ids per run).
#   PSQL="psql -h /home/pgtest -p 55432 -U postgres" tests/sql/packing-queue-concurrency.sh <disposable-db>
set -euo pipefail
DB=${1:?disposable database name}
PSQL=${PSQL:-psql}
q(){ $PSQL -d "$DB" -v ON_ERROR_STOP=1 -qAt "$@"; }
RUN=$(printf '%08x' $((RANDOM*32768+RANDOM)))
U(){ echo "00000000-0000-4000-${RUN:0:4}-${RUN:4:4}0000000$1"; }
OWNER=$(U 1); P1=$(U 2); P2=$(U 3); P3=$(U 4); ORG=$(U 5); CON=$(U 6); PROD=$(U 7); PACK=$(U 8); LOT=$(U 9)
claims(){ echo "select set_config('request.jwt.claims','{\"sub\":\"$1\",\"role\":\"authenticated\",\"aal\":\"aal1\"}',false);"; }

q <<SQL >/dev/null
insert into auth.users(id,email) values('$OWNER','o$RUN@pq'),('$P1','p1$RUN@pq'),('$P2','p2$RUN@pq'),('$P3','p3$RUN@pq');
insert into public.staff(user_id,role,active,department,access) values('$OWNER','owner',true,'management','{}'),
 ('$P1','staff',true,'stores','{deliveries}'),('$P2','staff',true,'stores','{deliveries}'),('$P3','staff',true,'stores','{deliveries}');
insert into public.organizations(id,name) values('$ORG','Fixture Concurrency Clinic $RUN');
insert into public.contacts(id,organization_id,title,first_name,last_name,position,phone_country,country_code,phone,status)
 values('$CON','$ORG','Doctor','Neema','Fixture','Buyer','TZ','+255','712345333','review');
insert into public.products(id,name,sku) values('$PROD','Fixture Concurrency Strips $RUN','FXC-$RUN');
insert into public.product_pack_definitions(id,product_id,version,base_unit,units_per_carton,reason,created_by) values('$PACK','$PROD',1,'box',10,'Fixture pack','$OWNER');
insert into public.inventory_lots(id,product_id,location_id,pack_definition_id,batch_number,loose_units)
 values('$LOT','$PROD',(select id from public.inventory_locations where is_dispatch_hub and active order by id limit 1),'$PACK','C$RUN',100);
set role authenticated;
$(claims "$OWNER")
create function pg_temp.order_to_queue() returns uuid language plpgsql as \$\$
declare v_pf uuid := gen_random_uuid(); v_note uuid := gen_random_uuid(); v public.sales_delivery_notes; v_p public.sales_proformas;
begin
 v_p := public.save_sales_proforma(v_pf,0,'$ORG','$CON','TZS',current_date+30,'2 weeks','Cash','',
  jsonb_build_array(jsonb_build_object('productId','$PROD','description','Fixture','quantity',1,'uom','pc','unitPriceMinor',1000,'discountBasisPoints',0,'taxBasisPoints',0)));
 v_p := public.advance_sales_proforma(v_pf,v_p.version,'send','');
 v_p := public.advance_sales_proforma(v_pf,v_p.version,'accept','LPO fixture');
 v := public.create_sales_delivery_note(v_note,v_pf,v_p.version,'ACC fixture',current_date,'[]');
 v := public.set_delivery_customer_waiting(v_note,v.version,true);
 v := public.advance_sales_delivery(v_note,v.version,'tax_invoice','','','','TI fixture');
 v := public.advance_sales_delivery(v_note,v.version,'send_to_sales','','','','');
 return v_note;
end \$\$;
select pg_temp.order_to_queue(); select pg_temp.order_to_queue(); select pg_temp.order_to_queue();
reset role;
-- The fixture orders go to the very top of the queue.
update public.sales_delivery_notes set packing_queued_at='2000-01-01'::timestamptz+make_interval(secs=>extract(epoch from created_at-now())), customer_waiting=true
 where organization_id='$ORG';
SQL

fails=0
check(){ if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 (got '$2', expected '$3')"; fails=$((fails+1)); fi; }

# Two packers at once: A takes the top order and keeps its transaction open for 3 s; B presses 1 s later.
( q <<SQL >/dev/null
begin; set local role authenticated; $(claims "$P1")
select public.packing_take_next(); select pg_sleep(3); commit;
SQL
) & A=$!
sleep 1
start=$(date +%s%N)
q <<SQL >/dev/null
set role authenticated; $(claims "$P2")
select public.packing_take_next();
SQL
took=$(( ($(date +%s%N)-start)/1000000 ))
wait $A
check "the second packer is not kept waiting by the first (skip locked)" "$([ $took -lt 2500 ] && echo yes || echo "no, ${took} ms")" yes
check "two packers pressing at once get two different orders" \
 "$(q -c "select count(distinct id)||':'||count(distinct packer_user_id) from public.sales_delivery_notes where organization_id='$ORG' and status='packing'")" "2:2"
check "nobody else's order was double assigned" \
 "$(q -c "select count(*) from public.sales_delivery_notes where organization_id='$ORG' and status='packing' and packer_user_id not in ('$P1','$P2')")" "0"

# One packer pressing twice at once (double tap on two phones): only one order.
( q <<SQL >/dev/null 2>&1 || true
begin; set local role authenticated; $(claims "$P3")
select public.packing_take_next(); select pg_sleep(2); commit;
SQL
) & A=$!
sleep 0.5
second=$(q 2>&1 <<SQL || true
set role authenticated; $(claims "$P3")
select public.packing_take_next();
SQL
)
wait $A
check "the same packer pressing twice at once gets one order" \
 "$(q -c "select count(*) from public.sales_delivery_notes where status='packing' and packer_user_id='$P3'")" "1"
check "the second press is told to finish the first" "$(echo "$second" | grep -c 'Press Packed' || true)" "1"

echo "passed=$((5-fails)) failed=$fails"
[ $fails -eq 0 ]
