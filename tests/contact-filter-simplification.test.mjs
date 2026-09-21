import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const profiles=fs.readFileSync(new URL('../client-profile-pages.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');

for(const source of [app,profiles]){
 assert.match(source,/\[\['all','All contacts'\],\['revision','Needs revision'\]\]/);
 assert.doesNotMatch(source,/\['review','To review'\]|\['kept','Kept'\]|\['incorrect','Incorrect'\]|\['duplicates','Possible duplicates'\]/);
}
assert.doesNotMatch(app,/data-incorrect=/,'The active contact card must not expose a hidden incorrect category.');
assert.doesNotMatch(app,/<span>Review status<\/span>/,'Staff should not have to choose among internal review states.');
assert.ok((app.match(/>Edit contact<\/button>/g)||[]).length>=2,'Both contact views should provide a clear Edit contact action.');
assert.ok((app.match(/data-delete-contact=/g)||[]).length>=2,'Both contact views should provide a recoverable Delete contact action.');
assert.match(app,/>Mark complete ✓<\/button>/,'Contacts needing review should provide a clear completion action.');
assert.match(html,/<button data-view="review">Fix contacts<\/button>/);

console.log('PASS: contact UI exposes only All contacts and Needs revision.');
