import { createClient } from '@supabase/supabase-js';
import { get, set } from 'idb-keyval';
import { type DocumentRecord, type Draft, type Receipt, type Status, LOCAL_RECIPIENT, LOCAL_SENDER, normalizeEmail, parseRecipients, sha256, templateFile, validateFile } from './domain';
import { consumePep, type PepProfile, type PepProof } from './pep';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;
const LOCAL_KEY = 'e-shlyuz-local-v1';
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('e-shlyuz-demo') : null;
export const notify = () => { channel?.postMessage('update'); window.dispatchEvent(new Event('documents-update')); };
channel?.addEventListener('message', () => window.dispatchEvent(new Event('documents-update')));
export interface Identity { id: string; email: string; local: boolean; displayName?: string; pep?: PepProfile }
const receipt = (id: string, email: string, kind: string, details = {}): Receipt => ({ id: crypto.randomUUID(), document_id: id, actor_email: email, kind, details, created_at: new Date().toISOString() });
async function localDocuments(): Promise<DocumentRecord[]> { return await get<DocumentRecord[]>(LOCAL_KEY) || []; }
export async function seedDemo() {
  if ((await localDocuments()).length) return;
  const file = templateFile('contract'); const id = crypto.randomUUID(); const now = new Date().toISOString();
  const hash = await sha256(await file.arrayBuffer());
  await set(`file:${id}`, file);
  await set(LOCAL_KEY, [{ id, sender_id: 'local-sender', sender_email: LOCAL_SENDER, title: 'Договор поставки № 44-П', kind: 'contract', number: '44-П', date: now.slice(0,10), amount: 125000, filename: file.name, file_size: file.size, file_path: id, sha256: hash, created_at: now, quarantine_reason: null, document_recipients: [{ email: LOCAL_RECIPIENT, status: 'delivered', reason: null, updated_at: now, mail_status: 'not_configured' }], receipts: [receipt(id, LOCAL_SENDER, 'sender_signed', { simulated: true, sha256: hash }), receipt(id, LOCAL_SENDER, 'delivered', { transport: 'local_demo' })] }]);
}
export async function listDocuments(user: Identity): Promise<DocumentRecord[]> {
  if (user.local) return (await localDocuments()).filter(d => d.sender_email === user.email || d.document_recipients.some(r => r.email === user.email));
  const { data, error } = await supabase!.from('documents').select('*,document_recipients(*),receipts(*)').order('created_at', { ascending: false });
  if (error) throw error;
  return data as DocumentRecord[];
}
export async function createDocument(user: Identity, draft: Draft, proof?: PepProof) {
  validateFile(draft.file);
  const emails = parseRecipients(draft.recipients, user.email, user.local);
  if (!draft.title.trim() || !draft.number.trim() || !draft.date || !Number.isFinite(draft.amount) || draft.amount < 0) throw new Error('Заполните реквизиты документа.');
  const hash = await sha256(await draft.file.arrayBuffer());
  if (proof && !user.local) throw new Error('Демо-ПЭП не используется для онлайн-обмена.');
  if (proof && proof.pepIdentifier !== user.email) throw new Error('ПЭП принадлежит другому участнику.');
  const signature = proof ? consumePep(proof, user.pep, hash, draft.kind) : { method: 'kep_demo', simulated: true, sha256: hash };
  const id = crypto.randomUUID();
  if (user.local) {
    const now = new Date().toISOString();
    const doc: DocumentRecord = { id, sender_id: user.id, sender_email: user.email, title: draft.title.trim(), kind: draft.kind, number: draft.number.trim(), date: draft.date, amount: draft.amount, filename: draft.file.name, file_size: draft.file.size, file_path: id, sha256: hash, created_at: now, quarantine_reason: draft.quarantineReason || null, document_recipients: emails.map(email => ({ email, status: draft.quarantineReason ? 'quarantine' : 'delivered', reason: draft.quarantineReason || null, updated_at: now, mail_status: 'not_configured' })), receipts: [receipt(id, user.email, 'sender_signed', signature), receipt(id, user.email, 'delivered', { transport: 'local_demo' })] };
    await set(`file:${id}`, draft.file); await set(LOCAL_KEY, [doc, ...await localDocuments()]); notify(); return { id, mail: 'Локальное демо: письма не отправлены.' };
  }
  const path = `${user.id}/${id}/${draft.file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { error: uploadError } = await supabase!.storage.from('documents').upload(path, draft.file, { upsert: false, contentType: draft.file.type || 'application/octet-stream' });
  if (uploadError) throw uploadError;
  const { error } = await supabase!.rpc('create_document', { p_id: id, p_title: draft.title.trim(), p_kind: draft.kind, p_number: draft.number.trim(), p_date: draft.date, p_amount: draft.amount, p_filename: draft.file.name, p_file_size: draft.file.size, p_file_path: path, p_sha256: hash, p_emails: emails, p_quarantine_reason: draft.quarantineReason || null });
  if (error) {
    await supabase!.storage.from('documents').remove([path]);
    throw error;
  }
  notify();
  // A notification failure must never cause the user to submit the document twice.
  try { return { id, mail: await sendNotifications(id) }; }
  catch { return { id, mail: 'Документ сохранён. Уведомления не отправлены; повторите отправку из карточки.' }; }
}
export async function sendNotifications(id: string) {
  if (!supabase) throw new Error('Почтовый сервис не подключён.');
  const { data, error } = await supabase.functions.invoke('notify-document', { body: { documentId: id } });
  if (error) throw new Error('Документ сохранён, но почтовый сервис недоступен. Проверьте настройку и повторите.');
  if (data?.error) throw new Error(data.error);
  if (data.results?.some((r: { status?: string }) => r.status === 'uncertain')) return 'Результат отправки некоторых писем неизвестен. Документ сохранён. Проверьте почту; автоматический повтор SMTP остановлен, чтобы избежать дублей.';
  const failed = data.results?.filter((r: { accepted: boolean }) => !r.accepted).length || 0;
  return failed ? `Не все письма приняты сервисом: ${failed}. Можно повторить отправку.` : 'Почтовый сервис принял уведомления. Доставка в ящик может занять время.';
}
export async function respond(user: Identity, doc: DocumentRecord, status: Status, reason = '', proof?: PepProof) {
  if (!['signed', 'rejected', 'delivered'].includes(status)) throw new Error('Недопустимое действие.');
  if (status === 'rejected' && !reason.trim()) throw new Error('Укажите причину отказа.');
  if (user.local) {
    const docs = await localDocuments(); const current = docs.find(d => d.id === doc.id);
    const me = current?.document_recipients.find(r => r.email === user.email);
    if (!current || !me) throw new Error('Действие доступно только получателю.');
    if (['signed','rejected'].includes(me.status)) throw new Error('По документу уже принято решение.');
    if (me.status === 'quarantine' && status !== 'delivered') throw new Error('Сначала повторите проверки карантина.');
    if (status === 'delivered' && me.status !== 'quarantine') throw new Error('Документ уже прошёл проверки.');
    let signature: Record<string, unknown> = {};
    if (status === 'signed') {
      await downloadOriginal(user, current);
      if (proof && proof.pepIdentifier !== user.email) throw new Error('ПЭП принадлежит другому участнику.');
      signature = proof ? consumePep(proof, user.pep, current.sha256, current.kind) : { method: 'kep_demo', sha256: current.sha256 };
    } else if (proof) throw new Error('Код ПЭП предназначен только для подписания.');
    me.status = status; me.reason = reason || null; me.updated_at = new Date().toISOString();
    current.receipts.push(receipt(doc.id, user.email, status === 'signed' ? 'recipient_signed' : status === 'rejected' ? 'rejected' : 'quarantine_released', { simulated: true, reason, ...signature }));
    await set(LOCAL_KEY, docs); notify(); return;
  }
  if (proof) throw new Error('Демо-ПЭП не используется для онлайн-обмена.');
  const { error } = await supabase!.rpc('respond_document', { p_document_id: doc.id, p_status: status, p_reason: reason || null });
  if (error) throw error; notify();
}
export async function downloadOriginal(user: Identity, doc: DocumentRecord): Promise<Blob> {
  let blob: Blob;
  if (user.local) {
    const value = await get<Blob>(`file:${doc.id}`);
    if (!value) throw new Error('Локальный файл недоступен.'); blob = value;
  } else {
    const { data, error } = await supabase!.storage.from('documents').download(doc.file_path);
    if (error) throw error; blob = data;
  }
  if (await sha256(await blob.arrayBuffer()) !== doc.sha256) throw new Error('Нарушена целостность: SHA-256 файла не совпадает с конвертом.');
  return blob;
}
