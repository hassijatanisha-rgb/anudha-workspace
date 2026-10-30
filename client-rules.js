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
const fieldErrorNodes=new WeakMap();let fieldErrorSequence=0;
function fieldValidationSource(control){
 const box=control._lookupBox||control.closest('.lookup'),source=box?._lookupSource;
 return source&&source._lookupBox===box&&box.contains(source)&&(control===source||control===box.querySelector('input.lookup-input'))?source:control;
}
function fieldErrorControl(control){
 const source=fieldValidationSource(control),box=source._lookupBox;
 return box?._lookupSource===source&&box.contains(source)?box.querySelector('input.lookup-input')||source:source;
}
function clearFieldError(control){
 const state=fieldErrorNodes.get(control);if(!state)return;
 const descriptions=(control.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!==state.node.id);
 if(descriptions.length)control.setAttribute('aria-describedby',descriptions.join(' '));else control.removeAttribute('aria-describedby');
 if(state.invalid===null)control.removeAttribute('aria-invalid');else control.setAttribute('aria-invalid',state.invalid);
 state.node.remove();fieldErrorNodes.delete(control);
}
function showFieldError(control,message){
 const source=fieldValidationSource(control);control=fieldErrorControl(source);
 if(source!==control)clearFieldError(source);
 if(!message){clearFieldError(control);return;}
 let state=fieldErrorNodes.get(control);
 if(!state){
  const node=document.createElement('small');node.className='field-error';node.id='field-error-'+(++fieldErrorSequence);
  state={node,invalid:control.getAttribute('aria-invalid')};fieldErrorNodes.set(control,state);control.closest('label')?.append(node);
 }
 state.node.textContent='⚠ '+message;control.setAttribute('aria-invalid','true');
 const descriptions=new Set(((control.getAttribute('aria-describedby')||'')+' '+(source.getAttribute('aria-describedby')||'')).split(/\s+/).filter(Boolean));descriptions.add(state.node.id);control.setAttribute('aria-describedby',[...descriptions].join(' '));
}
function fieldErrorSummary(count){return count?`${count} ${count===1?'field needs':'fields need'} attention`:'';}
function nativeFieldError(control){
 control=fieldValidationSource(control);
 if(!control.willValidate)return '';
 const value=String(control.value??''),trimmed=value.trim(),minimum=control.getAttribute('minlength'),maximum=control.getAttribute('maxlength');
 if(control.validity.customError)return control.validationMessage;
 if(control.required&&!trimmed&&!['checkbox','radio','file'].includes(control.type))return 'Complete this field.';
 if(!control.validity.valid)return control.validationMessage;
 if(trimmed&&minimum!==null&&trimmed.length<Number(minimum))return `Enter at least ${minimum} characters.`;
 if(maximum!==null&&value.length>Number(maximum))return `Use no more than ${maximum} characters.`;
 const visible=fieldErrorControl(control);
 if(visible!==control&&visible.willValidate){
  if(!visible.validity.valid)return visible.validationMessage;
  // Blur validation can precede the lookup's delayed leave handler.
  if(!value&&String(visible.value??'').trim())return 'Choose one from the list';
 }
 return '';
}
function nativeFormErrors(form){const errors=new Map();for(const control of form.querySelectorAll('input,select,textarea')){if(fieldValidationSource(control)!==control)continue;const message=nativeFieldError(control);if(message)errors.set(control,message);}return errors;}
function showFieldErrors(form,errors){
 let first;
 for(const control of form.querySelectorAll('input,select,textarea')){
  if(fieldValidationSource(control)!==control)continue;
  const problem=(errors instanceof Map?errors.get(control):errors[control.name])||'';showFieldError(control,problem);
  const visible=fieldErrorControl(control);
  if(problem&&!first&&!control.disabled&&control.type!=='hidden'&&!visible.disabled&&!visible.closest('[hidden],[inert]'))first=visible;
 }
 if(first){first.scrollIntoView({block:'center',behavior:'instant'});first.focus({preventScroll:true});}
}
function invalidateLocalApproval(id){const seen=new Set();while(id&&!seen.has(id)){seen.add(id);const o=orgIndex.get(id);if(!o)break;o.approval_status='review';id=o.parent_id}}
