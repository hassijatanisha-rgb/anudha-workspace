-- Delivery progress for stores and delivery staff. A delivery note belongs to a Pro forma: its card shows the Pro forma
-- number and progress, and packing picks the Pro forma items. Migration 060 let only people with "Pro formas & current
-- orders" read Pro formas and their items, so anyone with Deliveries but not Pro formas (the usual stores, driver and
-- service set) saw Delivery progress stuck on "Loading…" and could not pack or deliver. They may now read them too.
-- Saving and changing Pro formas still needs "proformas".
begin;
alter policy sales_proformas_read on public.sales_proformas
 using ((select public.has_access('proformas')) or (select public.has_access('deliveries')));
alter policy sales_proforma_lines_read on public.sales_proforma_lines
 using ((select public.has_access('proformas')) or (select public.has_access('deliveries')));
commit;
