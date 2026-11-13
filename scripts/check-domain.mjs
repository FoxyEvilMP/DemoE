// Dependency-free core checks for Node.js 22.13+ / 24.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source = await readFile(new URL('../src/domain.ts', import.meta.url), 'utf8');
const js = stripTypeScriptTypes(source, { mode: 'strip' });
const d = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
check('Normalize and deduplicate multiple recipients', () => assert.deepEqual(d.parseRecipients(' A@EXAMPLE.COM; b@example.com\na@example.com '), ['a@example.com','b@example.com']));
check('Reject invalid email', () => assert.throws(() => d.parseRecipients('invalid')));
check('Reject self-send', () => assert.throws(() => d.parseRecipients('a@b.com','a@b.com')));
check('Require a recipient', () => assert.throws(() => d.parseRecipients('')));
check('Limit recipient count', () => assert.throws(() => d.parseRecipients(Array.from({length:11},(_,i)=>`u${i}@example.com`).join(','))));
check('UPD uses the simulated operator', () => assert.equal(d.routeFor('upd').title,'Коннектор СБИС'));
check('Contract uses direct route', () => assert.equal(d.routeFor('contract').saving,15));
check('Reject executable', () => assert.throws(() => d.validateFile(new File(['x'],'x.exe'))));
check('Reject an empty document', () => assert.throws(() => d.validateFile(new File([],'x.xml'))));
check('Reject an oversized document', () => assert.throws(() => d.validateFile(new File([new Uint8Array(10485761)],'x.pdf'))));
check('Accept genuine XML demo template', () => { const f = d.templateFile('contract'); assert.match(f.name,/\.xml$/); d.validateFile(f); });
const doc = { document_recipients:[{status:'signed'},{status:'delivered'}] };
check('Wait for every recipient', () => assert.equal(d.aggregateStatus(doc),'delivered'));
check('All signatures complete an exchange', () => assert.equal(d.aggregateStatus({document_recipients:[{status:'signed'},{status:'signed'}]}),'signed'));
check('Preserve rejection', () => assert.equal(d.aggregateStatus({document_recipients:[{status:'signed'},{status:'rejected'}]}),'rejected'));
check('Preserve quarantine', () => assert.equal(d.aggregateStatus({document_recipients:[{status:'signed'},{status:'quarantine'}]}),'quarantine'));
check('Escape user-controlled printable text', () => assert.equal(d.escapeHTML('<script>"&\''),'&lt;script&gt;&quot;&amp;&#39;'));
assert.equal(await d.sha256(new TextEncoder().encode('abc').buffer),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'); checks++; console.log('PASS SHA-256 standard test vector');
console.log(`${checks} core checks passed.`);
