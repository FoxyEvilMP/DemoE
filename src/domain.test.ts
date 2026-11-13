import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { aggregateStatus, escapeHTML, parseRecipients, routeFor, sha256, templateFile, validateFile, type DocumentRecord } from './domain';
import { buildArchive, protocolFor } from './archive';
describe('Recipient isolation and input', () => {
  it('normalizes, splits and deduplicates addresses', () => expect(parseRecipients(' A@EXAMPLE.COM; b@example.com\na@example.com ')).toEqual(['a@example.com', 'b@example.com']));
  it('rejects an invalid address, no recipient, self-send and excessive recipients', () => {
    for (const emails of ['', 'bad-email', 'a@b.c', Array.from({length:11},(_,i)=>`u${i}@example.com`).join(',')]) expect(() => parseRecipients(emails,'a@b.c')).toThrow();
  });
  it('routes UPD through the simulated operator', () => { expect(routeFor('upd').saving).toBe(0); expect(routeFor('act').saving).toBe(15); });
  it('computes the standard SHA-256 test vector', async () => expect(await sha256(new TextEncoder().encode('abc').buffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));
  it('rejects executable, empty and oversized files', () => {
    for (const file of [new File(['x'],'malware.exe'), new File([],'empty.xml'), new File([new Uint8Array(10485761)],'large.pdf')]) expect(() => validateFile(file)).toThrow();
    expect(() => validateFile(templateFile('contract'))).not.toThrow();
  });
});
const doc: DocumentRecord = { id:'test',sender_id:'sender',sender_email:'sender@example.com',title:'<script>alert(1)</script>',kind:'contract',number:'1',date:'2026-11-13',amount:10,filename:'../../file.xml',file_size:3,file_path:'test',sha256:'a'.repeat(64),created_at:'2026-11-13T12:00:00Z',quarantine_reason:null,receipts:[],document_recipients:[{email:'a@example.com',status:'signed',reason:null,updated_at:'2026-11-13T12:00:00Z'},{email:'b@example.com',status:'delivered',reason:null,updated_at:'2026-11-13T12:00:00Z'}] };
describe('Multi-recipient exchange and exports', () => {
  it('waits for all recipients to sign and preserves rejection/quarantine', () => {
    expect(aggregateStatus(doc)).toBe('delivered');
    expect(aggregateStatus({...doc,document_recipients:doc.document_recipients.map(r=>({...r,status:'signed'}))})).toBe('signed');
    expect(aggregateStatus({...doc,document_recipients:[{...doc.document_recipients[0],status:'rejected'}]})).toBe('rejected');
    expect(aggregateStatus({...doc,document_recipients:[{...doc.document_recipients[0],status:'quarantine'}]})).toBe('quarantine');
  });
  it('escapes all document text in the printable protocol', () => {
    expect(protocolFor(doc)).not.toContain('<script>alert(1)</script>');
    expect(protocolFor(doc)).toContain('&lt;script&gt;');
    expect(escapeHTML('"<&')).toBe('&quot;&lt;&amp;');
  });
  it('packages actual bytes and marks signatures as simulations, with safe paths', async () => {
    const blob = await buildArchive(doc,new Blob(['abc']));
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const originals = Object.keys(zip.files).filter(p => p.startsWith('original/') && !zip.files[p].dir);
    expect(originals).toHaveLength(1); expect(originals[0]).not.toContain('../');
    expect(await zip.file(originals[0])!.async('string')).toBe('abc');
    expect(JSON.parse(await zip.file('manifest.json')!.async('string')).demo).toBe(true);
    expect(JSON.parse(await zip.file('signatures/demo-2.sig')!.async('string')).signer).toBe('a@example.com');
    expect(zip.file('signatures/demo-3.sig')).toBeNull();
    expect(await zip.file('README.txt')!.async('string')).toContain('не CMS/CAdES');
  });
});
