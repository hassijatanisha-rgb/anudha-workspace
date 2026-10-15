-- Stock count: add the two in-house stores, Haadi (in the building) and Main store (in the office), to the godowns
-- staff can count in. The list is otherwise unchanged.
begin;
alter table public.stock_count_entries drop constraint stock_count_entries_godown_check;
alter table public.stock_count_entries add constraint stock_count_entries_godown_check check (godown in (
 'Haadi','Main store','City Printer Godown','City Printer Godown 2','City Printer Godown 04','Keko Manga A','New Dakawa','New Dakawa Godown A',
 'RK Chudasama No.7','RK Chudasama No.8','Other location'));
commit;
