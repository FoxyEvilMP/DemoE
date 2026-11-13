export type Kind = 'contract' | 'act' | 'upd';
export type Status = 'delivered' | 'signed' | 'rejected' | 'quarantine';
export interface Recipient { email: string; status: Status; reason: string | null; updated_at: string; mail_status?: string }
export interface Receipt { id: string; document_id: string; actor_email: string; kind: string; created_at: string; details: Record<string, unknown> }
export interface DocumentRecord {
  id: string; sender_id: string; sender_email: string; title: string; kind: Kind;
  number: string; date: string; amount: number; filename: string; file_size: number;
  file_path: string; sha256: string; created_at: string; quarantine_reason: string | null;
  document_recipients: Recipient[]; receipts: Receipt[];
}
export interface Draft { title: string; kind: Kind; number: string; date: string; amount: number; recipients: string; quarantineReason: string; file: File }
export const KINDS: Record<Kind, string> = { contract: 'Договор', act: 'Акт', upd: 'УПД с НДС' };
export const STATUSES: Record<Status, string> = { delivered: 'Ожидает подписи', signed: 'Подписан', rejected: 'Отказ', quarantine: 'В карантине' };
export const MAX_FILE = 10 * 1024 * 1024;
export const LOCAL_SENDER = 'sender@vector-b2b.ru';
export const LOCAL_RECIPIENT = 'partner@alfa-supply.ru';
export function normalizeEmail(value: string) { return value.trim().toLowerCase(); }
export function parseRecipients(raw: string, sender?: string): string[] {
  const emails = [...new Set(raw.split(/[\s,;]+/).filter(Boolean).map(normalizeEmail))];
  if (!emails.length || emails.length > 10) throw new Error('Укажите от 1 до 10 получателей.');
  if (emails.some(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254)) throw new Error('Проверьте email получателей.');
  if (sender && emails.includes(normalizeEmail(sender))) throw new Error('Получатель должен отличаться от отправителя.');
  return emails;
}
export function validateFile(file: File) {
  if (!/\.(pdf|docx|xml)$/i.test(file.name)) throw new Error('Выберите PDF, DOCX или XML.');
  if (!file.size || file.size > MAX_FILE) throw new Error('Размер файла должен быть от 1 байта до 10 МБ.');
}
export function routeFor(kind: Kind) {
  return kind === 'upd'
    ? { title: 'Коннектор СБИС', subtitle: 'Маршрут через оператора · симуляция', steps: ['Определение типа', 'Модульная фабрика', 'Коннектор СБИС', 'Получатель'], saving: 0 }
    : { title: 'Прямая шина', subtitle: 'Direct B2B · демонстрация маршрута', steps: ['Определение типа', 'Direct B2B', 'Получатель'], saving: 15 };
}
export function aggregateStatus(doc: DocumentRecord): Status {
  if (doc.document_recipients.some(r => r.status === 'quarantine')) return 'quarantine';
  if (doc.document_recipients.some(r => r.status === 'rejected')) return 'rejected';
  if (doc.document_recipients.every(r => r.status === 'signed')) return 'signed';
  return 'delivered';
}
export async function sha256(data: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export function escapeHTML(s: string) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
export const money = (n: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format(n);
export const dateTime = (s: string) => new Date(s).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
export function templateFile(kind: Kind) {
  const name = kind === 'contract' ? 'Договор поставки № 44-П' : kind === 'act' ? 'Акт выполненных работ № 12' : 'УПД с НДС № 108';
  // Demo template is honest XML, never a renamed text file masquerading as PDF/DOCX.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<DemoDocument simulated="true"><Title>${escapeHTML(name)}</Title><Amount currency="RUB">125000.00</Amount><Notice>Учебный документ. Не для юридического использования.</Notice></DemoDocument>`;
  return new File([xml], `demo-${kind}.xml`, { type: 'application/xml' });
}
