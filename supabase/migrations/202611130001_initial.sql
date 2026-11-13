-- Independent schema for this application. Do not run the old, permissive demo SQL.
create table public.documents (
  id uuid primary key,
  sender_id uuid not null references auth.users(id),
  sender_email text not null,
  title text not null check (length(title) between 1 and 200),
  kind text not null check (kind in ('contract', 'act', 'upd')),
  number text not null check (length(number) between 1 and 100),
  date date not null,
  amount numeric(14,2) not null check (amount between 0 and 999999999999.99),
  filename text not null check (length(filename) between 1 and 255),
  file_size integer not null check (file_size between 1 and 10485760),
  file_path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  quarantine_reason text check (length(quarantine_reason) <= 500),
  created_at timestamptz not null default now()
);
create table public.document_recipients (
  document_id uuid not null references public.documents(id) on delete cascade,
  email text not null,
  status text not null check (status in ('delivered','signed','rejected','quarantine')),
  reason text,
  updated_at timestamptz not null default now(),
  mail_status text not null default 'pending' check (mail_status in ('pending','sending','accepted','failed')),
  mail_attempt_at timestamptz,
  mail_provider_id text,
  primary key (document_id, email)
);
create index recipients_email_idx on public.document_recipients(email);
create index documents_sender_idx on public.documents(sender_id, created_at);
create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  actor_email text not null,
  kind text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index receipts_document_idx on public.receipts(document_id, created_at);

create function public.current_email() returns text language sql stable set search_path = '' as $$
  select lower(coalesce(auth.jwt()->>'email', ''));
$$;
create function public.can_read_document(p_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.documents d where d.id = p_id and (
      d.sender_id = auth.uid() or exists (select 1 from public.document_recipients r where r.document_id = d.id and r.email = public.current_email())
    )
  );
$$;
revoke all on function public.can_read_document(uuid) from public, anon;
grant execute on function public.can_read_document(uuid) to authenticated;
alter table public.documents enable row level security;
alter table public.document_recipients enable row level security;
alter table public.receipts enable row level security;
create policy documents_participants on public.documents for select to authenticated using (public.can_read_document(id));
create policy recipients_participants on public.document_recipients for select to authenticated using (public.can_read_document(document_id));
create policy receipts_participants on public.receipts for select to authenticated using (public.can_read_document(document_id));
revoke all on public.documents, public.document_recipients, public.receipts from anon, authenticated;
grant select on public.documents, public.document_recipients, public.receipts to authenticated;
grant all on public.documents, public.document_recipients, public.receipts to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 10485760);
create policy upload_own_documents on storage.objects for insert to authenticated
with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy read_participant_files on storage.objects for select to authenticated
using (bucket_id = 'documents' and (
  (storage.foldername(name))[1] = auth.uid()::text or
  exists (select 1 from public.documents d where d.file_path = name and public.can_read_document(d.id))
));
-- Cleanup allowed only before a file is attached to an immutable exchange.
create policy remove_unattached_files on storage.objects for delete to authenticated
using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text
  and not exists (select 1 from public.documents d where d.file_path = name));

create function public.create_document(
  p_id uuid, p_title text, p_kind text, p_number text, p_date date, p_amount numeric,
  p_filename text, p_file_size integer, p_file_path text, p_sha256 text,
  p_emails text[], p_quarantine_reason text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_email text := public.current_email();
  v_recipient text;
begin
  if auth.uid() is null or v_email = '' then raise exception 'Требуется вход по подтверждённому email'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if (select count(*) from public.documents where sender_id = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Лимит демо: не более 20 отправок в час';
  end if;
  if p_emails is null or cardinality(p_emails) not between 1 and 10 then raise exception 'Укажите от 1 до 10 получателей'; end if;
  if cardinality(p_emails) <> (select count(distinct lower(trim(e))) from unnest(p_emails) e) then raise exception 'Получатели повторяются'; end if;
  if p_filename !~* '\.(pdf|docx|xml)$' or p_file_path not like auth.uid()::text || '/' || p_id::text || '/%' then
    raise exception 'Недопустимый файл или путь';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'documents' and name = p_file_path) then raise exception 'Сначала загрузите файл'; end if;
  insert into public.documents(id,sender_id,sender_email,title,kind,number,date,amount,filename,file_size,file_path,sha256,quarantine_reason)
  values(p_id,auth.uid(),v_email,trim(p_title),p_kind,trim(p_number),p_date,p_amount,p_filename,p_file_size,p_file_path,p_sha256,nullif(trim(p_quarantine_reason),''));
  foreach v_recipient in array p_emails loop
    v_recipient := lower(trim(v_recipient));
    if length(v_recipient) > 254 or v_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or v_recipient = v_email then
      raise exception 'Недопустимый адрес получателя';
    end if;
    insert into public.document_recipients(document_id,email,status,reason)
    values(p_id,v_recipient,case when nullif(trim(p_quarantine_reason),'') is null then 'delivered' else 'quarantine' end,nullif(trim(p_quarantine_reason),''));
  end loop;
  insert into public.receipts(document_id,actor_email,kind,details) values
    (p_id,v_email,'sender_signed',jsonb_build_object('simulated',true,'sha256',p_sha256,'signature_format','demo-json-not-cms')),
    (p_id,v_email,'delivered',jsonb_build_object('meaning','available_in_authenticated_inbox','route_simulated',true));
  return p_id;
end;
$$;
revoke all on function public.create_document(uuid,text,text,text,date,numeric,text,integer,text,text,text[],text) from public, anon;
grant execute on function public.create_document(uuid,text,text,text,date,numeric,text,integer,text,text,text[],text) to authenticated;

create function public.respond_document(p_document_id uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_current text; v_email text := public.current_email(); v_event text;
begin
  if auth.uid() is null or v_email = '' then raise exception 'Требуется вход'; end if;
  select status into v_current from public.document_recipients where document_id = p_document_id and email = v_email for update;
  if not found then raise exception 'Ответить может только получатель'; end if;
  if v_current in ('signed','rejected') then raise exception 'Решение уже принято'; end if;
  if p_status is null or p_status not in ('signed','rejected','delivered') then raise exception 'Недопустимый статус'; end if;
  if v_current = 'quarantine' and p_status <> 'delivered' then raise exception 'Сначала повторите демо-проверки'; end if;
  if p_status = 'delivered' and v_current <> 'quarantine' then raise exception 'Документ уже прошёл проверки'; end if;
  if p_status = 'rejected' and (nullif(trim(p_reason),'') is null or length(p_reason)>1000) then raise exception 'Укажите причину отказа (до 1000 символов)'; end if;
  v_event := case p_status when 'signed' then 'recipient_signed' when 'rejected' then 'rejected' else 'quarantine_released' end;
  update public.document_recipients set status = p_status, reason = case when p_status='rejected' then trim(p_reason) else null end, updated_at = now()
  where document_id = p_document_id and email = v_email;
  insert into public.receipts(document_id,actor_email,kind,details)
  values(p_document_id,v_email,v_event,jsonb_build_object('simulated',true,'reason',case when p_status='rejected' then trim(p_reason) else null end));
end;
$$;
revoke all on function public.respond_document(uuid,text,text) from public, anon;
grant execute on function public.respond_document(uuid,text,text) to authenticated;

-- Lease protects against concurrent clicks / retries. Accepted jobs are immutable.
create function public.claim_notification(p_document_id uuid, p_email text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.document_recipients set mail_status='sending', mail_attempt_at=now()
  where document_id=p_document_id and email=p_email and mail_status <> 'accepted'
    and (mail_attempt_at is null or mail_attempt_at < now()-interval '2 minutes');
  return found;
end;
$$;
revoke all on function public.claim_notification(uuid,text) from public, anon, authenticated;
grant execute on function public.claim_notification(uuid,text) to service_role;

alter table public.documents replica identity full;
alter table public.document_recipients replica identity full;
alter table public.receipts replica identity full;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='documents') then alter publication supabase_realtime add table public.documents; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='document_recipients') then alter publication supabase_realtime add table public.document_recipients; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='receipts') then alter publication supabase_realtime add table public.receipts; end if;
end $$;
