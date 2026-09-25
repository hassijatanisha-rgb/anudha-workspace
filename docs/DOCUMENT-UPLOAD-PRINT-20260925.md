# Document upload and print requirements

Source: user supplied Anudha_Handover_Installation_Report.pdf, Anudha_Quotation_QUO-21092026-4907.pdf and Anudha_Service_Report.pdf on 25 September 2026. These are format references, not customer transactions. Inspected text and rendered first pages; each has one page.

## Required behaviour

- Each saved pro forma, delivery note, service/installation case and accounting draft has record-linked supporting documents.
- Private PDF and photographed-document JPEG/PNG uploads, not publicly accessible files or arbitrary executable uploads.
- Authenticated users may only access attachments for records they may access. Accounting attachments retain accounting access restrictions.
- Upload status must distinguish uploaded bytes from confirmed saved attachment metadata. Retry must not duplicate files or records.
- Reopen a record, retrieve its attachments and open them for printing. Browser print supports Save as PDF; printing alone does not save the form.
- Generated form print output must use saved or clearly marked unsaved/draft information, and must not imply a fiscal-issued invoice.
- Preserve the uploaded original, uploader and timestamp; do not overwrite signed evidence.

## Format references

Pro forma: green/grey Anudha branding, customer details, quantity/description/unit/total, E&OE, validity period, goods delivery period, notes, bank details, prepared by, company address/contact/TIN/VRN, warranty exclusions, installation/application-charge note, VAT wording and page numbering. The reference's bank details are blank: do not invent them. Its ISO9001:2008 statement is historical template content, not evidence of current certification.

Installation: reference, equipment and serial, installation site/project, up to ten training attendees (name/phone/designation), QC training, accessories, warranty text, Anudha and customer names/signatures/dates.

Service: job number, customer and contact, project, equipment/model/serials/accessories, requested work/subject/fault/work done, engineer, charges, dates and engineer/customer/collection signatures.

## Verification gates

- Upload, reopen and download byte-identical file for every parent type.
- Reject missing parent, unauthorized accounting access, invalid file, oversize file and overwrite attempt.
- Show explicit errors and preserve retry state on storage/metadata failure.
- Print each generated document without clipping, hidden content or leftover print-only markup.
- Confirm policies on the actual Supabase Storage service before calling uploads live.

Status: private bucket and migration027 applied successfully to Supabase with explicit user approval. Local checks: 13 attachment unit tests, 8 isolated Chrome attachment/integration tests, PGlite permission tests; broader focused suite79/79 passed. Live binary upload remains to be verified; no customer attachment written in verification so far.

User clarified VAT is added on top of entered prices. The original VAT-inclusive sentence is intentionally replaced accordingly. Full company address and contact wording, enquiry and warranty terms are restored in generated proformas. Bank details and ISO certification still need verified configuration; demo sample values are not copied. This is not yet word-for-word parity of every generated form.

Visual direction: original forest-green sidebar (#1f3928), lime selection, light canvas and quiet white panels, retaining the current five clearly labelled navigation groups. Source is the original ERP app/globals.css; financial calculations and saved records are not changed by the styling.
