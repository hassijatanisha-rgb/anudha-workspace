begin;

alter table public.sales_delivery_notes drop constraint sales_delivery_notes_status_check;
alter table public.sales_delivery_notes add constraint sales_delivery_notes_status_check
 check (status in ('accounts_approved','tax_invoice_created','sent_to_sales','packing','ready','out_for_delivery','delivered','cancelled'));

commit;
