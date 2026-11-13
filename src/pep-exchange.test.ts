import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { authorizePep, confirmEnrollment, OtpChallenge } from './pep';
import { aggregateStatus, sha256, templateFile, type Draft } from './domain';
import { buildArchive, protocolFor, manifestFor } from './archive';
import type { Identity } from './api';
const db = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb-keyval', () => ({ get: async (key: string) => structuredClone(db.get(key)), set: async (key: string, value: unknown) => { db.set(key, structuredClone(value)); } }));
let api: typeof import('./api');
beforeAll(async () => {
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('window', new EventTarget());
  api = await import('./api');
});
beforeEach(() => db.clear());
afterAll(() => vi.unstubAllGlobals());
function user(email: string): Identity {
  const c = new OtpChallenge('enroll', email);
  return { id: email, email, local: true, displayName: email, pep: confirmEnrollment(c, c.code, new Date().toISOString()) };
}
function proofFor(u: Identity, hash: string) {
  const c = new OtpChallenge('sign', u.email, hash);
  return authorizePep(c, c.code, u.pep!, u.displayName!, hash);
}
function draft(): Draft { return { title: 'Договор', kind: 'contract', number: '1', date: '2026-11-13', amount: 100, recipients: 'recipient@example.com', quarantineReason: '', file: templateFile('contract') }; }
describe('Local PEP exchange and evidence export', () => {
  it('signs a document as sender and recipient and exports PEP metadata without OTP', async () => {
    const sender = user('sender@example.com'), recipient = user('recipient@example.com');
    const d = draft(); const hash = await sha256(await d.file.arrayBuffer());
    const result = await api.createDocument(sender, d, proofFor(sender, hash));
    let doc = (await api.listDocuments(recipient))[0]; expect(doc.id).toBe(result.id);
    await expect(api.respond(user('outsider@example.com'), doc, 'signed', '', proofFor(recipient, hash))).rejects.toThrow(/получателю/);
    await api.respond(recipient, doc, 'signed', '', proofFor(recipient, hash));
    doc = (await api.listDocuments(sender))[0]; expect(aggregateStatus(doc)).toBe('signed');
    expect(doc.receipts.filter(r => r.details.method === 'pep')).toHaveLength(2);
    await expect(api.respond(recipient, doc, 'signed', '', proofFor(recipient, hash))).rejects.toThrow(/уже принято/);
    expect(manifestFor(doc).signatures.filter(s => s.method === 'pep')).toHaveLength(2);
    const html = protocolFor(doc); expect(html).toContain('ПОДПИСАНО ПЭП'); expect(html).toContain('v1.1-PEP');
    const zip = await JSZip.loadAsync(await (await buildArchive(doc, await api.downloadOriginal(sender, doc))).arrayBuffer());
    const signature = JSON.parse(await zip.file('signatures/pep-1.json')!.async('string'));
    expect(signature.documentSha256).toBe(hash); expect(signature.pepIdentifier).toBe(sender.email); expect(signature).not.toHaveProperty('code');
    expect(zip.file('signatures/pep-2.json')).not.toBeNull();
    expect(zip.file('signatures/demo-1.sig')).toBeNull();
  });
  it('rejects changed file bytes and a sender using another profile PEP', async () => {
    const sender = user('sender@example.com'), other = user('other@example.com'); const d = draft();
    const hash = await sha256(await d.file.arrayBuffer());
    await expect(api.createDocument(sender, d, proofFor(other, hash))).rejects.toThrow(/другому/);
    await expect(api.createDocument(sender, { ...d, file: new File(['changed'], 'changed.xml') }, proofFor(sender, hash))).rejects.toThrow();
    expect(await api.listDocuments(sender)).toEqual([]);
  });
  it('keeps the existing KEP simulation available', async () => {
    const sender = user('sender@example.com');
    await api.createDocument(sender, draft());
    expect((await api.listDocuments(sender))[0].receipts[0].details.method).toBe('kep_demo');
  });
});
