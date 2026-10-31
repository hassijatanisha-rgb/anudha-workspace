# Anudha interface baseline

The owner selected [Emil Kowalski's Apple Design guide](https://www.ui-skills.com/skills/emilkowalski/apple-design) on 27 October 2026 as the minimum design standard. It applies alongside the specific brief for each feature.

## ERP decisions

- Keep Anudha's logo and green action colour. Use a pale navigation surface, a quiet canvas, and white work surfaces. Status and danger colours retain their meanings.
- Put shared visual values in `tokens.css`, loaded first, and shared interface rules in `ui-polish.css`, loaded last. The 29 October brief supplies the seven type and spacing roles, three corner radii, palette, elevations and motion values. Keep feature layouts in their current files. Rebuild with `node scripts/build-bundle.mjs`; do not hand-edit generated bundles.
- Use the existing quarter-rem spacing scale, relative control text, unitless line heights, and a 2.75rem minimum for shared buttons. Large amounts and quantities use tabular numerals. Tables may scroll within their containers.
- Keep the selected navigation item visibly marked. Preserve group disclosure, hidden permission-restricted items, and the measured header offset. Product pickers must remain within their available width.
- Keep financial documents independent of screen-only surface styling. Do not change prices, stock quantities, permissions, posting logic, or workflow states to improve a visual demonstration.

## Review before delivery

Inspect the rendered page at a wide and narrow viewport. Check focus, wrapped labels, long item names, form errors, modal overflow, and enlarged text. Check reduced-motion, reduced-transparency, increased-contrast, and forced-colour rules when the browser supports those preferences. Report untested states explicitly.

A clean screen is not evidence that an order succeeded. Missing prices, reserved stock, pending quantities, the next responsible person, and the next required action must remain understandable. The employee workflow review is a separate acceptance requirement.
