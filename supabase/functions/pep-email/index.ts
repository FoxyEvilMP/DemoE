import {createClient} from 'npm:@supabase/supabase-js@2.95.3';
import {ONLINE_OFFER_VERSION,emailIdentifier,sixDigitCode,codeDigest,fileDigest,checkedDraft} from './core.ts';
Deno.serve(async(req:Request)=>{
 const appUrl=Deno.env.get('APP_URL')||'https://foxyevilmp.github.io/DemoE/';
 const origin=new URL(appUrl).origin;
 const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
 const json=(body:unknown,status=200)=>Response.json(body,{status,headers});
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 if(req.headers.get('origin') && req.headers.get('origin')!==origin)return json({error:'Origin not allowed'},403);
 if(Number(req.headers.get('content-length')||0)>16384)return json({error:'Запрос слишком большой'},413);
 const url=Deno.env.get('SUPABASE_URL')!,secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const client=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:req.headers.get('authorization')||''}},auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const raw=await req.text();if(raw.length>16384)return json({error:'Запрос слишком большой'},413);
  const body=JSON.parse(raw);if(!['request','verify'].includes(body.action))return json({error:'Некорректное действие'},400);
  let user:any=null;
  async function requireUser(){
   const {data,error}=await client.auth.getUser();
   if(error||!data.user?.email_confirmed_at||!data.user?.email)throw new Error('Войдите по подтверждённому email.');
   user=data.user;
  }
  async function verifyFile(p:any){
   const {data,error}=await admin.storage.from('documents').download(p.file_path);
   if(error||!data||data.size!==p.file_size||await fileDigest(await data.arrayBuffer())!==p.sha256)throw new Error('Файл недоступен или изменился. Подготовьте документ заново.');
  }
  if(body.action==='request'){
   const purpose=body.purpose;if(!['enroll','send','respond'].includes(purpose))return json({error:'Некорректное назначение кода'},400);
   let identifier:string,payload:any;
   if(purpose==='enroll'){
    identifier=emailIdentifier(body.email);
    if(body.accepted!==true||body.offerVersion!==ONLINE_OFFER_VERSION||typeof body.displayName!=='string'||body.displayName.trim().length<2||body.displayName.length>120)return json({error:'Укажите имя и примите действующее соглашение ПЭП.'},400);
    payload={displayName:body.displayName.trim(),offerVersion:ONLINE_OFFER_VERSION};
   }else{
    await requireUser();identifier=emailIdentifier(user.email);
    const {data:profile,error}=await admin.from('pep_profiles').select('user_id').eq('user_id',user.id).eq('identifier',identifier).eq('offer_version',ONLINE_OFFER_VERSION).maybeSingle();
    if(error||!profile)return json({error:'Сначала выпустите ПЭП через вход по Email-коду.'},403);
    if(purpose==='send')payload=checkedDraft(body.draft,user.id,identifier);
    else{
     if(!/^[0-9a-f-]{36}$/i.test(body.documentId||''))return json({error:'Документ не выбран'},400);
     const {data:doc,error}=await client.from('documents').select('id,kind,title,filename,file_path,file_size,sha256,document_recipients(email,status)').eq('id',body.documentId).single();
     if(error||!doc||!['contract','act'].includes(doc.kind)||!doc.document_recipients.some((r:any)=>r.email===identifier&&r.status==='delivered'))return json({error:'Документ недоступен для подписания ПЭП.'},403);
     payload={id:doc.id,kind:doc.kind,title:doc.title,filename:doc.filename,file_path:doc.file_path,file_size:doc.file_size,sha256:doc.sha256};
    }
    await verifyFile(payload);
   }
   if(!Deno.env.get('MAIL_FROM')||!Deno.env.get('SMTP_USERNAME')||!Deno.env.get('SMTP_PASSWORD'))return json({error:'Отправка кодов ещё не настроена на сервере.'},503);
   const id=crypto.randomUUID(),code=sixDigitCode(),hash=await codeDigest(secret,id,code);
   const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-real-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
   const {data:budget,error}=await admin.rpc('pep_begin_challenge',{p_id:id,p_identifier:identifier,p_actor:user?.id||null,p_purpose:purpose,p_hash:hash,p_ip_hash:await codeDigest(secret,'ip',ip),p_payload:payload});
   if(error)return json({error:'Не удалось подготовить код. Повторите позже.'},500);
   if(!budget?.ok)return json({error:budget?.error||'Подождите перед повторной отправкой.'},429);
   const transport=(await import('npm:nodemailer@10.5.0')).default.createTransport({
    host:Deno.env.get('SMTP_HOSTNAME')||'smtp.mail.ru',port:Number(Deno.env.get('SMTP_PORT')||'465'),secure:true,
    auth:{user:Deno.env.get('SMTP_USERNAME')!,pass:Deno.env.get('SMTP_PASSWORD')!},
    connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},
    disableFileAccess:true,disableUrlAccess:true
   });
   try{
    const text=purpose==='enroll'
     ?`Е-Шлюз: код для входа и выпуска ПЭП: ${code}\n\nСоглашение: ${ONLINE_OFFER_VERSION}.\nКод действует 5 минут, допускается 5 попыток. Никому его не сообщайте.\nЕсли вы не запрашивали код, проигнорируйте письмо.`
     :`Е-Шлюз: код подписания: ${code}\n\nДокумент: ${payload.title}\nФайл: ${payload.filename}\nSHA-256: ${payload.sha256}\n\nВведите код только если намерены подписать этот документ. Код действует 5 минут и используется однократно. Никому его не сообщайте.`;
    const info=await transport.sendMail({from:Deno.env.get('MAIL_FROM'),to:identifier,subject:purpose==='enroll'?'Е-Шлюз: вход и выпуск ПЭП':'Е-Шлюз: подписание документа ПЭП',text});
    if(!info.accepted?.length)throw new Error('SMTP rejected');
    const {error:saved}=await admin.from('pep_challenges').update({delivery_state:'accepted',provider_id:info.messageId}).eq('id',id).is('used_at',null);
    if(saved)throw saved;
   }catch{
    await admin.from('pep_challenges').update({delivery_state:'failed'}).eq('id',id);
    return json({error:'Не удалось подтвердить отправку письма. Проверьте почту; новый код можно запросить через минуту.'},502);
   }finally{transport.close();}
   return json({challengeId:id,expiresIn:300,codeLength:6,channel:'email_otp',message:'Почтовый сервер принял письмо с кодом.'});
  }
  if(!/^[0-9a-f-]{36}$/i.test(body.challengeId||'')||!/^\d{6}$/.test(body.code||''))return json({error:'Введите код из 6 цифр.'},400);
  const {data:c,error:readError}=await admin.from('pep_challenges').select('purpose,actor_id,payload,identifier').eq('id',body.challengeId).maybeSingle();
  if(readError||!c)return json({error:'Код недействителен. Запросите новый.'},400);
  if(c.purpose!=='enroll'){await requireUser();if(user.id!==c.actor_id||emailIdentifier(user.email)!==c.identifier)return json({error:'Действие недоступно.'},403);await verifyFile(c.payload);}
  const {data:result,error:completeError}=await admin.rpc('pep_complete_challenge',{p_id:body.challengeId,p_hash:await codeDigest(secret,body.challengeId,body.code),p_actor:user?.id||null});
  if(completeError)return json({error:'Не удалось завершить действие. Проверьте документ и повторите.'},409);
  if(!result?.ok)return json({error:result?.error||'Код не подтверждён.'},400);
  if(c.purpose!=='enroll')return json({id:result.id,purpose:result.purpose});
  const email=result.identifier;
  const {data:link,error:linkError}=await admin.auth.admin.generateLink({type:'magiclink',email,options:{redirectTo:appUrl}});
  if(linkError||!link.properties?.hashed_token||!link.user?.id)return json({error:'Код подтверждён, но вход не завершён. Запросите новый код.'},500);
  const authClient=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:sessionData,error:sessionError}=await authClient.auth.verifyOtp({token_hash:link.properties.hashed_token,type:'email'});
  if(sessionError||!sessionData.session)return json({error:'Не удалось создать сессию. Запросите новый код.'},500);
  const profile={user_id:link.user.id,identifier:email,display_name:result.payload.displayName,offer_version:ONLINE_OFFER_VERSION,offer_accepted_at:result.acceptedAt,auth_channel:'email_otp'};
  const {error:profileError}=await admin.from('pep_profiles').upsert(profile,{onConflict:'user_id'});
  if(profileError)return json({error:'Не удалось сохранить выпуск ПЭП. Повторите вход.'},500);
  await admin.auth.admin.updateUserById(link.user.id,{user_metadata:{display_name:profile.display_name}});
  return json({access_token:sessionData.session.access_token,refresh_token:sessionData.session.refresh_token,userId:link.user.id,email,displayName:profile.display_name,
   pep:{pepActive:true,pepIdentifier:email,offerVersion:ONLINE_OFFER_VERSION,offerAcceptedAt:profile.offer_accepted_at,authChannel:'email_otp'}});
 }catch(e){
  return json({error:e instanceof Error&&/^[А-ЯЁ]/.test(e.message)?e.message:'Не удалось выполнить действие. Повторите позже.'},400);
 }
});
