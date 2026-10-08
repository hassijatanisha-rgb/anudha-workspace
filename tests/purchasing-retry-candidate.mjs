// TEST-ONLY SQL predicate prototype. Not a migration or deployment script.
// Keep deployed migration 046 immutable; fail if its expected baseline changes.
export function purchasingRetryCandidate(sql){
 const replaceOnce=(before,after)=>{
  if(sql.split(before).length!==2)throw Error('Purchasing retry prototype baseline changed');
  sql=sql.replace(before,after);
 };
 replaceOnce("v_row.created_by=auth.uid() and v_row.version=1 and v_row.name=trim(coalesce(p_fields->>'name',''))",`v_row.created_by=auth.uid() and v_row.version=1
    and row(v_row.name,v_row.country,v_row.contact_name,v_row.phone,v_row.email,v_row.tin,v_row.payment_terms,v_row.notes,v_row.active)
     is not distinct from row(trim(coalesce(p_fields->>'name','')),trim(coalesce(p_fields->>'country','')),
      trim(coalesce(p_fields->>'contact_name','')),trim(coalesce(p_fields->>'phone','')),lower(trim(coalesce(p_fields->>'email',''))),
      trim(coalesce(p_fields->>'tin','')),trim(coalesce(p_fields->>'payment_terms','')),coalesce(p_fields->>'notes',''),v_active)`);
 replaceOnce("and (select count(*) from public.purchase_order_lines where purchase_order_id=p_id)=jsonb_array_length(p_lines)",`and row(v_row.supplier_id,v_row.currency,v_row.expected_on,v_row.notes)
     is not distinct from row(p_supplier_id,coalesce(p_currency,'TZS'),p_expected_on,coalesce(p_notes,''))
    and (select jsonb_agg(jsonb_build_array(product_id,quantity,unit_price_minor,pending_request_id,note) order by line_number)
     from public.purchase_order_lines where purchase_order_id=p_id)
     = (select jsonb_agg(jsonb_build_array((item->>'product_id')::uuid,(item->>'quantity')::integer,
       nullif(item->>'unit_price_minor','')::bigint,nullif(item->>'pending_request_id','')::uuid,left(coalesce(item->>'note',''),500)) order by position)
      from jsonb_array_elements(p_lines) with ordinality as incoming(item,position))`);
 return sql;
}
export function purchasingRetryUpgrade(sql){
 const candidate=purchasingRetryCandidate(sql);
 const functions=candidate.match(/create function public\.save_(?:supplier|purchase_request)\([\s\S]*?end \$\$;/g);
 if(functions?.length!==2)throw Error('Expected exactly two purchasing save functions');
 return 'begin;\n'+functions.map(fn=>fn.replace('create function','create or replace function')).join('\n')+'\ncommit;';
}
