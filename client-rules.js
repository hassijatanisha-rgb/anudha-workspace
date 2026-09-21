'use strict';
function titleCase(value){return String(value||'').trim().toLowerCase().replace(/(^|[^\p{L}\p{N}])([\p{L}\p{N}])/gu,(_,prefix,letter)=>prefix+letter.toUpperCase())}
const countryNames=new Intl.DisplayNames(['en'],{type:'region'});
function countryOptions(selected){return Object.keys(window.PHONE_RULES).sort((a,b)=>countryNames.of(a).localeCompare(countryNames.of(b))).map(code=>`<option value="${code}" ${code===selected?'selected':''}>${esc(countryNames.of(code))} (+${window.PHONE_RULES[code].code})</option>`).join('')}
function phoneLengths(country){return country==='TZ'?[9]:country==='US'?[10]:window.PHONE_RULES[country]?.lengths||[]}
function phoneLengthMessage(country){const lengths=phoneLengths(country);return lengths.length?`Enter ${lengths.length===1?'exactly '+lengths[0]:lengths.join(' or ')} digits after +${window.PHONE_RULES[country].code}, including any regional area code.`:'Choose a country to see its phone-number requirements.'}
function contactFieldErrors(c){
 const errors={};
 if(!c.organization_id)errors.organization_id='Choose an account / branch.';
 if(!['Doctor','Mr.','Mrs.','N/A'].includes(c.title))errors.title='Choose Doctor, Mr., Mrs. or N/A.';
 for(const [key,label] of [['first_name','First name'],['last_name','Last name']]){const value=String(c[key]||'').trim();if(!value)errors[key]=label+' is required.';else if(!/^\p{Lu}/u.test(value))errors[key]=label+' must start with a capital letter.';}
 if(!c.position?.trim())errors.position='Position / role is required.';
 const rule=window.PHONE_RULES[c.phone_country];
 if(!rule)errors.phone_country='Choose a country.';
 if(!c.country_code||rule&&c.country_code!=='+'+rule.code)errors.country_code='Calling code must match the selected country.';
 if(!c.phone?.trim())errors.phone='Phone number is required.';
 else if(!/^\d+$/.test(c.phone))errors.phone='Use digits only, without the country code, spaces or punctuation.';
 else if(rule&&!phoneLengths(c.phone_country).includes(c.phone.length))errors.phone=phoneLengthMessage(c.phone_country);
 else if(rule&&!new RegExp('^(?:'+rule.pattern+')$').test(c.phone))errors.phone='Field invalid: this number does not match the selected country’s numbering plan.';
 if(c.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email))errors.email='Enter a valid email address or leave it blank.';
 return errors;
}
function contactNeedsRevision(contact,issues=[],duplicateIssues=[]){return contact.status!=='incorrect'&&(contact.status!=='kept'||issues.length>0||duplicateIssues.length>0)}
function contactReviewQueue(contactRows,organizationRows,duplicateRows=new Map()){
 const organizationsById=new Map(organizationRows.map(o=>[o.id,o]));
 return contactRows.filter(c=>c.status!=='incorrect').map(contact=>{const reasons=Object.values(contactFieldErrors(contact));if(contact.status!=='kept'&&!reasons.length)reasons.push('Contact has not been marked complete');for(const duplicate of duplicateRows.get(contact.id)||[])reasons.push(`Possible duplicate: ${duplicate.reason}`);return {contact,organization:organizationsById.get(contact.organization_id)||{id:'',name:'Account missing',location:''},reasons}}).filter(row=>contactNeedsRevision(row.contact,row.reasons,duplicateRows.get(row.contact.id)||[])).sort((a,b)=>a.organization.name.localeCompare(b.organization.name)||String(a.contact.first_name||'').localeCompare(String(b.contact.first_name||''))||a.contact.id.localeCompare(b.contact.id));
}
function showFieldErrors(form,errors){
 form.querySelectorAll('.field-error').forEach(el=>el.remove());
 form.querySelectorAll('[aria-invalid]').forEach(el=>{el.removeAttribute('aria-invalid');el.removeAttribute('aria-describedby')});
 for(const [key,message] of Object.entries(errors)){const control=form.elements.namedItem(key);if(!control)continue;control.setAttribute('aria-invalid','true');const error=document.createElement('small');error.className='field-error';error.id='error-'+form.id+'-'+key;error.textContent='Field invalid: '+message;control.setAttribute('aria-describedby',error.id);control.closest('label')?.append(error)}
 const first=Object.keys(errors)[0];if(first)form.elements.namedItem(first)?.focus();
}
function invalidateLocalApproval(id){const seen=new Set();while(id&&!seen.has(id)){seen.add(id);const o=orgIndex.get(id);if(!o)break;o.approval_status='review';id=o.parent_id}}
