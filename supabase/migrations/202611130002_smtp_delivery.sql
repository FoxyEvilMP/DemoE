-- SMTP has no provider-level idempotency. Do not automatically retry ambiguous
-- outcomes; an administrator can inspect the sender mailbox first.
alter table public.document_recipients drop constraint document_recipients_mail_status_check;
alter table public.document_recipients add constraint document_recipients_mail_status_check
  check (mail_status in ('pending','sending','accepted','failed','uncertain'));
drop function public.claim_notification(uuid,text);
create function public.claim_notification(p_document_id uuid, p_email text, p_reclaim_stale boolean default true)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.document_recipients set mail_status='sending', mail_attempt_at=now()
  where document_id=p_document_id and email=p_email
    and (mail_status in ('pending','failed') or (p_reclaim_stale and mail_status='sending'))
    and (mail_attempt_at is null or mail_attempt_at < now()-interval '2 minutes');
  return found;
end;
$$;
revoke all on function public.claim_notification(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_notification(uuid,text,boolean) to service_role;
