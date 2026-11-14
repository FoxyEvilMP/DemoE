create or replace function public.pep_complete_challenge(p_id uuid,p_hash text,p_actor uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.pep_challenges%rowtype; p public.pep_profiles%rowtype; v_id uuid; v_claims text; v_email text; v_details jsonb; v_result jsonb; d jsonb;
begin
 select * into c from public.pep_challenges where id=p_id for update;
 if not found then return jsonb_build_object('ok',false,'error','Код недействителен. Запросите новый.'); end if;
 if c.purpose<>'enroll' and(p_actor is null or c.actor_id is distinct from p_actor) then return jsonb_build_object('ok',false,'error','Действие недоступно.'); end if;
 if c.used_at is not null then
  if c.purpose<>'enroll' and c.code_hash=p_hash and c.result is not null then return c.result; end if;
  return jsonb_build_object('ok',false,'error','Код уже использован или отменён.');
 end if;
 if c.delivery_state<>'accepted' or c.expires_at<=now() or c.attempts>=5 then return jsonb_build_object('ok',false,'error','Код истёк или исчерпан лимит попыток. Запросите новый.'); end if;
 update public.pep_challenges set attempts=attempts+1 where id=c.id;
 if c.code_hash<>p_hash then return jsonb_build_object('ok',false,'error','Неверный код. Допускается не более 5 попыток.'); end if;
 if c.purpose='enroll' then
  update public.pep_challenges set used_at=now() where id=c.id;
  return jsonb_build_object('ok',true,'identifier',c.identifier,'payload',c.payload,'acceptedAt',c.created_at);
 end if;
 select * into p from public.pep_profiles where user_id=p_actor and identifier=c.identifier and offer_version='v1.2-PEP';
 if not found then raise exception 'Сначала выпустите ПЭП и примите соглашение'; end if;
 -- Only the backend can call this function; it validates the live Auth user and email before invoking it.
 v_email:=p.identifier;
 v_claims:=current_setting('request.jwt.claims',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'email',v_email,'role','authenticated')::text,true);
 d:=c.payload;
 if c.purpose='send' then
  if d->>'kind' not in ('contract','act') then raise exception 'Для этого документа ПЭП недоступна'; end if;
  v_id:=public.create_document((d->>'id')::uuid,d->>'title',d->>'kind',d->>'number',(d->>'date')::date,(d->>'amount')::numeric,d->>'filename',(d->>'file_size')::integer,d->>'file_path',d->>'sha256',array(select jsonb_array_elements_text(d->'emails')),nullif(d->>'quarantine_reason',''));
 else
  v_id:=(d->>'id')::uuid;
  if not exists(select 1 from public.documents where id=v_id and kind in('contract','act') and sha256=d->>'sha256') then raise exception 'Документ изменён или ПЭП недоступна'; end if;
  perform public.respond_document(v_id,'signed',null);
 end if;
 perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
 v_details:=jsonb_build_object('method','pep','simulated',false,'signature_format','pep-email-otp','pepActive',true,
 'pepIdentifier',v_email,'signerName',p.display_name,'offerVersion',p.offer_version,'offerAcceptedAt',p.offer_accepted_at,
 'authChannel','email_otp','documentSha256',d->>'sha256','sha256',d->>'sha256','challengeId',c.id,'signedAt',now(),
 'delivery','smtp_email','providerId',c.provider_id);
 update public.receipts set details=(details-'signature_format')||v_details
 where document_id=v_id and actor_email=v_email and kind=case c.purpose when 'send' then 'sender_signed' else 'recipient_signed' end;
 v_result:=jsonb_build_object('ok',true,'id',v_id,'purpose',c.purpose);
 update public.pep_challenges set used_at=now(),result=v_result where id=c.id;
 return v_result;
end; $$;
