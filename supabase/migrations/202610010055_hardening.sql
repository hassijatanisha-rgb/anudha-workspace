-- Hardening from the 1 October review. No behaviour change:
-- 1. Signed-in users still held direct INSERT/UPDATE/DELETE grants on older workflow and inventory tables. No RLS
--    policy allows writes, so they were unusable, but every legitimate write goes through checked RPCs (which run as
--    the function owner), so the grants are removed as a second barrier.
-- 2. Five read policies re-evaluated auth.uid() per row; they now evaluate it once per query (same rule).
-- Rollback: re-grant in a forward migration (not expected to be needed).
begin;

revoke insert, update, delete, truncate on
 public.equipment_assets, public.inventory_issues, public.inventory_locations, public.inventory_lots, public.inventory_movements,
 public.inventory_transfers, public.product_inventory_classifications, public.product_pack_definitions,
 public.sales_delivery_events, public.sales_delivery_lines, public.sales_delivery_notes, public.sales_proforma_events,
 public.sales_proforma_lines, public.sales_proforma_revisions, public.sales_proformas, public.service_case_events,
 public.service_cases, public.service_report_accessories, public.service_reports, public.service_training_attendees
from authenticated, anon, public;

alter policy staff_read on public.staff using ((user_id = (select auth.uid())) or (select public.is_owner()));
alter policy approval_question_read on public.project_approval_questions using (exists (select 1 from public.staff where staff.user_id = (select auth.uid()) and staff.active and staff.role = 'owner'));
alter policy approval_answer_read on public.project_approval_answers using (exists (select 1 from public.staff where staff.user_id = (select auth.uid()) and staff.active and staff.role = 'owner'));
alter policy workspace_entries_read on public.workspace_entries using ((select public.inventory_active_staff()) and deleted_at is null and (owner_id = (select auth.uid()) or visibility = 'company'));
alter policy workspace_entry_audit_read on public.workspace_entry_audit using ((select public.inventory_active_staff()) and ((new_entry ->> 'owner_id') = ((select auth.uid()))::text or (new_entry ->> 'visibility') = 'company'));
commit;
