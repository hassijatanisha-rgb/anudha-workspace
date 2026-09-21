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
assert.match(html,/<button data-view="review">Needs revision<\/button>/);

console.log('PASS: contact UI exposes only All contacts and Needs revision.');
