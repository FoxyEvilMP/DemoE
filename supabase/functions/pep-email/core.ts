export const ONLINE_OFFER_VERSION = 'v1.2-PEP';
export function emailIdentifier(raw: unknown) {
 if(typeof raw!=='string') throw new Error('Укажите email.');
 const email=raw.trim().toLowerCase();
 if(email.length>254 || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,63}$/i.test(email) || /[\r\n]/.test(email)) throw new Error('Проверьте email. SMS пока не подключены.');
 return email;
}
export function sixDigitCode() {
 const a=new Uint32Array(1); do{crypto.getRandomValues(a);}while(a[0]>=4294000000);
 return String(a[0]%1000000).padStart(6,'0');
}
export async function codeDigest(secret:string,id:string,code:string) {
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('e-shlyuz-pep-v1:'+id+':'+code)))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function fileDigest(bytes:ArrayBuffer) {
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export function checkedDraft(raw:any,userId:string,sender:string) {
 if(!raw || !/^[0-9a-f-]{36}$/i.test(raw.id||'') || !['contract','act'].includes(raw.kind)) throw new Error('Для ПЭП выберите договор или акт.');
 if(typeof raw.file_path!=='string' || !raw.file_path.startsWith(userId+'/'+raw.id+'/')) throw new Error('Файл принадлежит другому участнику.');
 if(typeof raw.filename!=='string' || raw.filename.length>255 || !/\.(xml|pdf|docx)$/i.test(raw.filename)) throw new Error('Выберите PDF, DOCX или XML.');
 if(!Number.isInteger(raw.file_size) || raw.file_size<1 || raw.file_size>10485760 || !/^[0-9a-f]{64}$/.test(raw.sha256||'')) throw new Error('Проверьте файл.');
 if(typeof raw.title!=='string' || !raw.title.trim() || raw.title.length>200 || typeof raw.number!=='string' || !raw.number.trim() || raw.number.length>100 || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date||'') || !Number.isFinite(raw.amount) || raw.amount<0 || raw.amount>999999999999.99) throw new Error('Проверьте реквизиты документа.');
 if(!Array.isArray(raw.emails) || raw.emails.length<1 || raw.emails.length>10) throw new Error('Укажите от 1 до 10 получателей.');
 const emails=[...new Set<string>(raw.emails.map(emailIdentifier))];
 if(emails.length!==raw.emails.length || emails.includes(sender)) throw new Error('Проверьте получателей.');
 if(raw.quarantine_reason && (typeof raw.quarantine_reason!=='string' || raw.quarantine_reason.length>500)) throw new Error('Проверьте причину карантина.');
 return {id:raw.id,kind:raw.kind,title:raw.title.trim(),number:raw.number.trim(),date:raw.date,amount:raw.amount,filename:raw.filename,file_size:raw.file_size,file_path:raw.file_path,sha256:raw.sha256,emails,quarantine_reason:raw.quarantine_reason||null};
}
