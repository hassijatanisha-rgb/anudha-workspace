-- Speed: 32 read rules called the access check once for every row read. Wrapped in (select …) the check runs once
-- per request. Same rules, same answers; measured on a 4,756-Pro-forma test copy, a list read fell from about 2 s.
-- Rollback: not needed (identical permissions); the previous form can be restored with alter policy.
begin;
alter policy accounting_draft_history_read on public.accounting_draft_history using ((select public.accounting_access()));
alter policy accounting_drafts_read on public.accounting_drafts using ((select public.accounting_access()));
alter policy audit_read on public.audit_log using ((select public.is_owner()));
alter policy contacts_read on public.contacts using ((select public.is_active_staff()));
alter policy equipment_assets_read on public.equipment_assets using ((select public.inventory_active_staff()));
alter policy checklist_read on public.feature_checklist using ((select public.is_active_staff()));
alter policy inventory_issues_read on public.inventory_issues using ((select public.inventory_active_staff()));
alter policy inventory_locations_read on public.inventory_locations using ((select public.inventory_active_staff()));
alter policy inventory_lots_read on public.inventory_lots using ((select public.inventory_active_staff()));
alter policy inventory_movements_read on public.inventory_movements using ((select public.inventory_active_staff()));
alter policy inventory_transfers_read on public.inventory_transfers using ((select public.inventory_active_staff()));
alter policy organizations_read on public.organizations using ((select public.is_active_staff()));
alter policy product_detail_reviews_read on public.product_detail_reviews using ((select public.inventory_active_staff()));
alter policy product_inventory_classifications_read on public.product_inventory_classifications using ((select public.inventory_active_staff()));
alter policy product_machine_link_reviews_read on public.product_machine_link_reviews using ((select public.inventory_active_staff()));
alter policy product_pack_definitions_read on public.product_pack_definitions using ((select public.inventory_active_staff()));
alter policy product_source_mapping_reviews_read on public.product_source_mapping_reviews using ((select public.inventory_active_staff()));
alter policy products_read on public.products using ((select public.is_active_staff()));
alter policy sales_delivery_events_read on public.sales_delivery_events using ((select public.inventory_active_staff()));
alter policy sales_delivery_lines_read on public.sales_delivery_lines using ((select public.inventory_active_staff()));
alter policy sales_delivery_notes_read on public.sales_delivery_notes using ((select public.inventory_active_staff()));
alter policy sales_proforma_events_read on public.sales_proforma_events using ((select public.inventory_active_staff()));
alter policy sales_proforma_lines_read on public.sales_proforma_lines using ((select public.inventory_active_staff()));
alter policy sales_proforma_revisions_read on public.sales_proforma_revisions using ((select public.inventory_active_staff()));
alter policy sales_proformas_read on public.sales_proformas using ((select public.inventory_active_staff()));
alter policy service_case_events_read on public.service_case_events using ((select public.inventory_active_staff()));
alter policy service_cases_read on public.service_cases using ((select public.inventory_active_staff()));
alter policy service_report_accessories_read on public.service_report_accessories using ((select public.inventory_active_staff()));
alter policy service_reports_read on public.service_reports using ((select public.inventory_active_staff()));
alter policy service_training_attendees_read on public.service_training_attendees using ((select public.inventory_active_staff()));
alter policy tally_corrections_read on public.tally_stock_corrections using ((select public.inventory_active_staff()));
alter policy tally_sources_read on public.tally_stock_sources using ((select public.inventory_active_staff()));
commit;
