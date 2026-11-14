import {describe,expect,it} from 'vitest';
import {checkedDraft,codeDigest,emailIdentifier,fileDigest,sixDigitCode} from '../supabase/functions/pep-email/core';
import {manifestFor,protocolFor,buildArchive} from './archive';
import JSZip from 'jszip';
import type {DocumentRecord} from './domain';
describe('Server Email OTP primitives',()=>{
 it('normalizes email and rejects phone, header injection and address-list injection',()=>{
  expect(emailIdentifier(' USER@Example.COM ')).toBe('user@example.com');
  for(const email of ['+79991234567','a@example.com\r\nBcc:x@y.com','a@example.com;b@example.com','x<victim@example.com>','invalid'])expect(()=>emailIdentifier(email)).toThrow();
 });
 it('generates six digits and HMAC-binds codes to a specific challenge and server secret',async()=>{
  for(let i=0;i<20;i++)expect(sixDigitCode()).toMatch(/^\d{6}$/);
  const h=await codeDigest('server-secret','challenge-one','123456');
  expect(h).toMatch(/^[a-f0-9]{64}$/);
  expect(await codeDigest('server-secret','challenge-two','123456')).not.toBe(h);
  expect(await codeDigest('other-secret','challenge-one','123456')).not.toBe(h);
  expect(await codeDigest('server-secret','challenge-one','654321')).not.toBe(h);
  expect(await fileDigest(new TextEncoder().encode('abc').buffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 });
 it('rejects a foreign storage path, formalized UPD, self-addressing and invalid file metadata',()=>{
  const d={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',kind:'contract',file_path:'owner/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/file.xml',filename:'file.xml',file_size:3,sha256:'a'.repeat(64),title:'Contract',number:'1',date:'2026-11-14',amount:100,emails:['recipient@example.com']};
  expect(checkedDraft(d,'owner','sender@example.com').emails).toEqual(['recipient@example.com']);
  for(const invalid of [{...d,file_path:'other/file.xml'},{...d,kind:'upd'},{...d,emails:['sender@example.com']},{...d,sha256:'wrong'},{...d,file_size:0}])expect(()=>checkedDraft(invalid,'owner','sender@example.com')).toThrow();
 });
 it('exports online evidence as Email OTP, without demo signature labels or OTP codes',async()=>{
  const doc:DocumentRecord={id:'one',sender_id:'owner',sender_email:'sender@example.com',title:'Contract',kind:'contract',number:'1',date:'2026-11-14',amount:1,filename:'file.xml',file_size:3,file_path:'one',sha256:'a'.repeat(64),created_at:'2026-11-14T10:00:00Z',quarantine_reason:null,document_recipients:[{email:'r@example.com',status:'delivered',reason:null,updated_at:'2026-11-14T10:00:00Z'}],receipts:[{id:'r',document_id:'one',actor_email:'sender@example.com',kind:'sender_signed',created_at:'2026-11-14T10:00:00Z',details:{method:'pep',simulated:false,signerName:'Sender',pepIdentifier:'sender@example.com',authChannel:'email_otp',offerVersion:'v1.2-PEP',offerAcceptedAt:'2026-11-14T09:00:00Z',documentSha256:'a'.repeat(64),signedAt:'2026-11-14T10:00:00Z'}}]};
  expect(manifestFor(doc).demo).toBe(false);expect(protocolFor(doc)).toContain('ПОДПИСАНО ПЭП · EMAIL OTP');
  const zip=await JSZip.loadAsync(await(await buildArchive(doc,new Blob(['abc']))).arrayBuffer());
  const signature=JSON.parse(await zip.file('signatures/pep-1.json')!.async('string'));
  expect(signature.format).toBe('pep-email-otp');expect(signature.simulated).toBe(false);expect(signature).not.toHaveProperty('code');
 });
});
