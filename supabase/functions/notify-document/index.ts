import { createClient } from 'npm:@supabase/supabase-js@2.95.3';

// Never accept sender/recipient addresses or an arbitrary redirect from a caller.
// Resolve them from authenticated, immutable records instead.
Deno.serve(async (req: Request) => {
  const appUrl = Deno.env.get('APP_URL');
  let allowedOrigin = '';
  try { if (appUrl) allowedOrigin = new URL(appUrl).origin; } catch { /* Invalid configuration is reported below. */ }
  const cors = { 'Access-Control-Allow-Origin': allowedOrigin, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const mode = Deno.env.get('MAIL_PROVIDER') || 'smtp';
  if (!allowedOrigin || !Deno.env.get('MAIL_FROM') || !['smtp','resend'].includes(mode)
    || (mode === 'smtp' && (!Deno.env.get('SMTP_USERNAME') || !Deno.env.get('SMTP_PASSWORD')))
    || (mode === 'resend' && !Deno.env.get('RESEND_API_KEY'))) return json({ error: 'Почтовый сервис ещё не настроен. Документ доступен в приложении.' }, 503);
  if (req.headers.get('origin') && req.headers.get('origin') !== allowedOrigin) return json({ error: 'Origin not allowed' }, 403);
  try {
    const auth = req.headers.get('authorization') || '';
    if (!auth.startsWith('Bearer ')) return json({ error: 'Требуется вход' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user?.email_confirmed_at) return json({ error: 'Требуется подтверждённый email' }, 401);
    const body = await req.json();
    if (typeof body.documentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.documentId)) return json({ error: 'Некорректный документ' }, 400);
    const { data: doc, error } = await client.from('documents').select('id,sender_id,sender_email,title,created_at,document_recipients(email,mail_status)').eq('id', body.documentId).single();
    if (error || !doc || doc.sender_id !== user.id) return json({ error: 'Документ недоступен' }, 403);
    // Resend's idempotency window is bounded. Do not retry old notices with an expired key.
    if (Date.now() - Date.parse(doc.created_at) > 23 * 60 * 60 * 1000) return json({ error: 'Повтор письма доступен в течение 23 часов после отправки документа.' }, 409);
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const transport = mode === 'smtp' ? (await import('npm:nodemailer@^9')).default.createTransport({
      host: Deno.env.get('SMTP_HOSTNAME') || 'smtp.mail.ru', port: Number(Deno.env.get('SMTP_PORT') || '465'), secure: true,
      auth: { user: Deno.env.get('SMTP_USERNAME')!, pass: Deno.env.get('SMTP_PASSWORD')! },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true }
    }) : null;
    const results: { email: string; accepted: boolean; status?: string; error?: string }[] = [];
    for (const recipient of doc.document_recipients) {
      if (recipient.mail_status === 'accepted') { results.push({ email: recipient.email, accepted: true }); continue; }
      if (recipient.mail_status === 'uncertain' || (mode === 'smtp' && recipient.mail_status === 'sending')) {
        results.push({ email: recipient.email, accepted: false, status: 'uncertain', error: 'Результат SMTP неизвестен. Проверьте почту перед повтором.' }); continue;
      }
      const { data: claimed, error: claimError } = await admin.rpc('claim_notification', { p_document_id: doc.id, p_email: recipient.email, p_reclaim_stale: mode === 'resend' });
      if (claimError || !claimed) { results.push({ email: recipient.email, accepted: false, error: 'Повторите через две минуты' }); continue; }
      const link = new URL(appUrl!); link.searchParams.set('document', doc.id);
      const text = `Вам отправлен документ в демо-приложении «Е-Шлюз».\n\nОтправитель: ${doc.sender_email}\nДокумент: ${doc.title}\n\nОткрыть: ${link.href}\nВойдите с адресом ${recipient.email}, чтобы получить доступ.\n\nКЭП, ГОСТ, TSP и внешние операторы имитируются. Это демонстрация, не юридически значимый обмен.`;
      let acceptedByProvider = false;
      try {
        let providerId: string;
        if (transport) {
          const info = await transport.sendMail({ from: Deno.env.get('MAIL_FROM'), to: recipient.email,
            replyTo: doc.sender_email, subject: 'Е-Шлюз: вам доступен документ', text });
          if (!info.accepted?.length) throw new Error('Recipient not accepted');
          acceptedByProvider = true; providerId = info.messageId;
        } else {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { 'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json', 'Idempotency-Key': `document-${doc.id}-${recipient.email}` },
          body: JSON.stringify({ from: Deno.env.get('MAIL_FROM'), to: [recipient.email], reply_to: doc.sender_email, subject: 'Е-Шлюз: вам доступен документ', text }),
          signal: AbortSignal.timeout(15000)
        });
        const provider = await response.json();
        if (!response.ok || !provider.id) throw new Error('Email provider rejected request');
        acceptedByProvider = true; providerId = provider.id;
        }
        const { error: updateError } = await admin.from('document_recipients').update({ mail_status: 'accepted', mail_provider_id: providerId }).eq('document_id', doc.id).eq('email', recipient.email);
        if (updateError) throw updateError;
        results.push({ email: recipient.email, accepted: true });
      } catch {
        const state = transport || acceptedByProvider ? 'uncertain' : 'failed';
        await admin.from('document_recipients').update({ mail_status: state }).eq('document_id', doc.id).eq('email', recipient.email);
        results.push({ email: recipient.email, accepted: false, status: state, error: state === 'uncertain' ? 'Результат отправки неизвестен. Проверьте почту.' : 'Письмо не принято сервисом' });
      }
    }
    return json({ results });
  } catch { return json({ error: 'Не удалось отправить уведомления. Документ сохранён.' }, 500); }
});
