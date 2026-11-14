import JSZip from 'jszip';
import { type DocumentRecord, escapeHTML, routeFor } from './domain';
export const SIMULATION_NOTICE = 'Онлайн-подписи ПЭП фиксируют подтверждение Email-кодом на сервере. Локальные подписи ПЭП и макеты КЭП являются демонстрационными. Личность и полномочия представителя отдельно не удостоверяются. КЭП, ГОСТ, СБИС, PKI, OCSP и TSP имитируются. Файлы .sig — JSON-макеты, не CMS/CAdES. Оценка юридической силы зависит от соглашения участников и вида документа. Архив не является пакетом для подачи в ФНС.';
function pepFor(doc: DocumentRecord, email: string) {
  return doc.receipts.find(r => r.actor_email === email && ['sender_signed', 'recipient_signed'].includes(r.kind) && r.details.method === 'pep')?.details;
}
export function manifestFor(doc: DocumentRecord) {
  return { version: '1.2-PEP', demo: !doc.receipts.some(r=>r.details.method==='pep' && r.details.simulated===false), notice: SIMULATION_NOTICE, id: doc.id, document: { title: doc.title, filename: doc.filename, bytes: doc.file_size, sha256: doc.sha256, number: doc.number, date: doc.date, amount: doc.amount }, signatures: doc.receipts.filter(r => ['sender_signed', 'recipient_signed'].includes(r.kind)).map(r => ({ signer: r.actor_email, createdAt: r.created_at, ...r.details, method: r.details.method || 'kep_demo' })), sender: doc.sender_email, recipients: doc.document_recipients, route: routeFor(doc.kind), createdAt: doc.created_at, validations: { sha256: 'recomputed_on_download', extensionAndSize: 'checked', pki: 'simulated', structuralDeepScan: 'simulated', semantics: 'simulated', idempotency: 'server_unique_document_id' } };
}
export function protocolFor(doc: DocumentRecord) {
  const m = manifestFor(doc);
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Протокол обмена</title><style>body{font:15px system-ui;max-width:900px;margin:50px auto;color:#183a30}aside{background:#fff1dd;padding:20px}td,th{padding:12px;border-bottom:1px solid #ddd;text-align:left;overflow-wrap:anywhere}table{width:100%}code{overflow-wrap:anywhere}.stamp{border:2px solid #37679f;padding:18px;color:#37679f;margin:20px 0}@media print{button{display:none}}</style><h1>Е-Шлюз · Протокол обмена</h1><aside>${escapeHTML(SIMULATION_NOTICE)}</aside><h2>${escapeHTML(doc.title)}</h2><p>Отправитель: ${escapeHTML(doc.sender_email)}</p><p>SHA-256: <code>${doc.sha256}</code></p><p>Дата документа: ${escapeHTML(doc.date)} · Сумма: ${doc.amount.toFixed(2)} ₽</p><table><thead><tr><th>Получатель</th><th>Статус</th><th>Причина</th></tr></thead><tbody>${doc.document_recipients.map(r => `<tr><td>${escapeHTML(r.email)}</td><td>${escapeHTML(r.status)}</td><td>${escapeHTML(r.reason || '—')}</td></tr>`).join('')}</tbody></table>${[doc.sender_email, ...doc.document_recipients.filter(r => r.status === 'signed').map(r => r.email)].map(email => { const pep = pepFor(doc, email); return pep ? `<div class="stamp">ПОДПИСАНО ПЭП · ${pep.simulated === false ? 'EMAIL OTP' : 'ДЕМО OTP'}<br>${escapeHTML(String(pep.signerName))}<br>${escapeHTML(String(pep.pepIdentifier))} · ${escapeHTML(String(pep.authChannel))}<br>Подписано: ${escapeHTML(String(pep.signedAt))}<br>Соглашение: ${escapeHTML(String(pep.offerVersion))} · акцепт ${escapeHTML(String(pep.offerAcceptedAt))}<br>SHA-256: ${escapeHTML(String(pep.documentSha256))}</div>` : `<div class="stamp">ДЕМО-ПОДПИСЬ · НЕ КЭП<br>${escapeHTML(email)}<br>ГОСТ / TSP: симуляция</div>`; }).join('')}<h2>Журнал событий</h2><table>${[...doc.receipts].sort((a,b) => a.created_at.localeCompare(b.created_at)).map(r => `<tr><td>${escapeHTML(r.created_at)}</td><td>${escapeHTML(r.actor_email)}</td><td>${escapeHTML(r.kind)}</td></tr>`).join('')}</table><h2>Конверт</h2><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHTML(JSON.stringify(m,null,2))}</pre><button onclick="window.print()">Печать / сохранить PDF</button></html>`;
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
  signers.forEach((email, i) => { const pep = pepFor(doc, email); zip.file(pep ? `signatures/pep-${i+1}.json` : `signatures/demo-${i+1}.sig`, JSON.stringify(pep ? { ...pep, signer: email, format: pep.simulated === false ? 'pep-email-otp' : 'demo-pep-otp', notice: SIMULATION_NOTICE } : { simulated: true, format: 'demo-json-not-cms', signer: email, document_sha256: doc.sha256, notice: SIMULATION_NOTICE }, null, 2)); });
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
