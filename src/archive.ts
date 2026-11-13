import JSZip from 'jszip';
import { type DocumentRecord, escapeHTML, routeFor } from './domain';
export const SIMULATION_NOTICE = 'ДЕМО. КЭП, ГОСТ, СБИС, PKI, OCSP и TSP имитируются. Файлы .sig — JSON-макеты, не CMS/CAdES. Архив не является юридическим доказательством или пакетом для подачи в ФНС.';
export function manifestFor(doc: DocumentRecord) {
  return { version: '1.0', demo: true, notice: SIMULATION_NOTICE, id: doc.id, document: { title: doc.title, filename: doc.filename, bytes: doc.file_size, sha256: doc.sha256, number: doc.number, date: doc.date, amount: doc.amount }, sender: doc.sender_email, recipients: doc.document_recipients, route: routeFor(doc.kind), createdAt: doc.created_at, validations: { sha256: 'recomputed_on_download', extensionAndSize: 'checked', pki: 'simulated', structuralDeepScan: 'simulated', semantics: 'simulated', idempotency: 'server_unique_document_id' } };
}
export function protocolFor(doc: DocumentRecord) {
  const m = manifestFor(doc);
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Демо-протокол</title><style>body{font:15px system-ui;max-width:900px;margin:50px auto;color:#183a30}aside{background:#fff1dd;padding:20px}td,th{padding:12px;border-bottom:1px solid #ddd;text-align:left;overflow-wrap:anywhere}table{width:100%}code{overflow-wrap:anywhere}.stamp{border:2px solid #37679f;padding:18px;color:#37679f;margin:20px 0}@media print{button{display:none}}</style><h1>Е-Шлюз · Демо-протокол</h1><aside>${escapeHTML(SIMULATION_NOTICE)}</aside><h2>${escapeHTML(doc.title)}</h2><p>Отправитель: ${escapeHTML(doc.sender_email)}</p><p>SHA-256: <code>${doc.sha256}</code></p><p>Дата документа: ${escapeHTML(doc.date)} · Сумма: ${doc.amount.toFixed(2)} ₽</p><table><thead><tr><th>Получатель</th><th>Статус</th><th>Причина</th></tr></thead><tbody>${doc.document_recipients.map(r => `<tr><td>${escapeHTML(r.email)}</td><td>${escapeHTML(r.status)}</td><td>${escapeHTML(r.reason || '—')}</td></tr>`).join('')}</tbody></table>${[doc.sender_email, ...doc.document_recipients.filter(r => r.status === 'signed').map(r => r.email)].map(email => `<div class="stamp">ДЕМО-ПОДПИСЬ · НЕ КЭП<br>${escapeHTML(email)}<br>ГОСТ / TSP: симуляция</div>`).join('')}<h2>Журнал событий</h2><table>${[...doc.receipts].sort((a,b) => a.created_at.localeCompare(b.created_at)).map(r => `<tr><td>${escapeHTML(r.created_at)}</td><td>${escapeHTML(r.actor_email)}</td><td>${escapeHTML(r.kind)}</td></tr>`).join('')}</table><h2>Конверт</h2><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHTML(JSON.stringify(m,null,2))}</pre><button onclick="window.print()">Печать / сохранить PDF</button></html>`;
}
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export async function buildArchive(doc: DocumentRecord, original: Blob) {
  const zip = new JSZip();
  const safeName = doc.filename.replace(/[/\\\x00-\x1f]/g, '_').replace(/^\.+/, '_');
  zip.file(`original/${safeName}`, await original.arrayBuffer());
  zip.file('manifest.json', JSON.stringify(manifestFor(doc), null, 2));
  zip.file('receipts.json', JSON.stringify(doc.receipts, null, 2));
  zip.file('protocol.html', protocolFor(doc));
  zip.file('README.txt', SIMULATION_NOTICE);
  const signers = [doc.sender_email, ...doc.document_recipients.filter(r => r.status === 'signed').map(r => r.email)];
  signers.forEach((email, i) => zip.file(`signatures/demo-${i+1}.sig`, JSON.stringify({ simulated: true, format: 'demo-json-not-cms', signer: email, document_sha256: doc.sha256, notice: SIMULATION_NOTICE }, null, 2)));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
