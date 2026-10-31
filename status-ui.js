'use strict';

// Domain renderers translate ambiguous states such as "closed" before choosing a tone.
const statusTones={
 danger:'danger',overdue:'danger',out_of_stock:'danger',refused:'danger',rejected:'danger',failed:'danger',
 warning:'warning',waiting:'warning',awaiting_approval:'warning',invoice_pending:'warning',low_stock:'warning',due_soon:'warning',report_required:'warning',
 success:'success',done:'success',completed:'success',paid:'success',delivered:'success',installed:'success',in_stock:'success',resolved:'success',
 info:'info',in_progress:'info',packing:'info',in_transit:'info',scheduled:'info',reserved:'info',assigned:'info',on_site:'info',partially_delivered:'info',
 neutral:'neutral',draft:'neutral',inactive:'neutral',archived:'neutral',not_started:'neutral',not_counted:'neutral',cancelled:'neutral'
};
function statusTone(status){return Object.hasOwn(statusTones,status)?statusTones[status]:'neutral';}
