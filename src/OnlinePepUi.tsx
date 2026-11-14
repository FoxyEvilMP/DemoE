import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowRight,KeyRound,Mail,ShieldCheck} from 'lucide-react';
import type {Identity} from './api';
import type {DocumentRecord,Draft} from './domain';
import {ONLINE_OFFER_VERSION,finishOnlineEnrollment,pepRequest,prepareOnlineSend,releasePrepared,type PreparedSend} from './onlinePep';
function useCooldown(){
 const [seconds,setSeconds]=useState(0);
 useEffect(()=>{if(!seconds)return;const t=setTimeout(()=>setSeconds(seconds-1),1000);return()=>clearTimeout(t);},[seconds]);
 return {seconds,start:()=>setSeconds(60)};
}
function EmailCode({value,onChange}:{value:string;onChange:(s:string)=>void}){
 return <label>Код из письма · 6 цифр<input className="otp-input" autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required placeholder="000000" value={value} onChange={e=>onChange(e.target.value.replace(/\D/g,'').slice(0,6))}/></label>;
}
export function EmailOnboarding({onComplete,onOffer,initialEmail=''}:{onComplete:(user:Identity)=>void;onOffer:()=>void;initialEmail?:string}){
 const [email,setEmail]=useState(initialEmail),[name,setName]=useState(''),[accepted,setAccepted]=useState(false);
 const [challenge,setChallenge]=useState(''),[code,setCode]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const cooldown=useCooldown();
 async function request(e?:FormEvent){
  e?.preventDefault();if(busy||!accepted)return;setBusy(true);setError('');
  try{const d=await pepRequest({action:'request',purpose:'enroll',email,displayName:name.trim(),accepted,offerVersion:ONLINE_OFFER_VERSION});setEmail(email.trim().toLowerCase());setChallenge(d.challengeId);setCode('');cooldown.start();}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function confirm(e:FormEvent){
  e.preventDefault();if(busy)return;setBusy(true);setError('');
  try{onComplete(await finishOnlineEnrollment(challenge,code));}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <div className="login-card pep-onboarding"><span className="overline">EMAIL-КОД · ОНЛАЙН</span><h2>{challenge?'Проверьте вашу почту':'Войти и выпустить ПЭП'}</h2><div className="onboarding-steps"><span className={!challenge?'active':''}>1 · Email и соглашение</span><span className={challenge?'active':''}>2 · Код из письма</span></div>{!challenge?<><p>Код придёт на вашу почту. ПЭП и акцепт соглашения сохранятся на сервере.</p><form onSubmit={request}><label>ФИО или название организации<input autoComplete="name" required minLength={2} maxLength={120} placeholder="Иван Иванов или ООО «Компания»" value={name} onChange={e=>setName(e.target.value)}/></label><label>Ваша электронная почта<input type="email" autoComplete="email" required maxLength={254} placeholder="user@company.ru" value={email} onChange={e=>setEmail(e.target.value)}/></label><label className="offer-consent"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/><span>Принимаю условия Регламента ЭДО „Е-Шлюз“ и соглашение об использовании ПЭП (ч. 2 ст. 6 63-ФЗ)</span></label><button type="button" className="text-button" onClick={onOffer}>Читать оферту · {ONLINE_OFFER_VERSION}</button><button className="primary full" disabled={busy||!accepted}>{busy?'Отправляем письмо…':<>Получить код и войти <ArrowRight size={18}/></>}</button></form><small>Реальная доставка Email. SMS пока не подключены. Не используйте демо-профили для доступа к онлайн-документам.</small></>:<><div className="notice success" role="status"><Mail size={22}/><span>Письмо с кодом принято почтовым сервером: <strong>{email}</strong>. Проверьте также «Спам».</span></div><p>Код действует 5 минут. Допускается до 5 попыток. Код не отображается в приложении.</p><form onSubmit={confirm}><EmailCode value={code} onChange={setCode}/><button className="primary full" disabled={busy||code.length!==6}>{busy?'Подтверждаем…':'Подтвердить код и войти'}</button></form><div className="otp-actions"><button type="button" className="text-button" disabled={busy||cooldown.seconds>0} onClick={()=>request()}>{cooldown.seconds?`Отправить снова через ${cooldown.seconds} с`:'Отправить новый код'}</button><button className="text-button" disabled={busy} onClick={()=>{setChallenge('');setCode('');setError('');}}>Изменить данные</button></div></>}{error&&<p className="form-error" role="alert">{error}</p>}</div>;
}
export function OnlinePepSigning({user,draft,doc,hash,onSigned,onBusy}:{user:Identity;draft:Draft|null;doc?:DocumentRecord;hash:string;onSigned:(id:string,sending:boolean)=>Promise<void>;onBusy:(busy:boolean)=>void}){
 const prepared=useRef<PreparedSend|null>(null),completed=useRef(false),alive=useRef(true);
 const [challenge,setChallenge]=useState(''),[code,setCode]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const cooldown=useCooldown();
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(prepared.current&&!completed.current)void releasePrepared(prepared.current);};},[]);
 function processing(value:boolean){setBusy(value);onBusy(value);}
 async function request(){
  if(busy)return;processing(true);setError('');
  try{
   if(draft&&!prepared.current){prepared.current=await prepareOnlineSend(user,draft);if(!alive.current){await releasePrepared(prepared.current);return;}}
   const data=await pepRequest(draft?{action:'request',purpose:'send',draft:prepared.current!.payload}:{action:'request',purpose:'respond',documentId:doc?.id});
   if(alive.current){setChallenge(data.challengeId);setCode('');cooldown.start();}
  }catch(e){if(alive.current)setError((e as Error).message);}finally{processing(false);}
 }
 async function confirm(e:FormEvent){
  e.preventDefault();if(busy)return;processing(true);setError('');
  try{const result=await pepRequest({action:'verify',challengeId:challenge,code});completed.current=true;await onSigned(result.id,!!draft);}
  catch(e){setError((e as Error).message);}finally{processing(false);}
 }
 return <div className="pep-signing"><div className="notice success"><ShieldCheck size={21}/><span>ПЭП · реальная доставка на {user.email}</span></div><p>Письмо будет содержать название документа и SHA-256. Подтвердите код, только если намерены подписать этот файл.</p><div className="hash"><span>SHA-256 документа</span><code>{hash}</code></div>{challenge&&<div className="notice success" role="status"><Mail size={20}/>Письмо с кодом принято сервером. Код действует 5 минут.</div>}<form onSubmit={confirm}>{challenge&&<><EmailCode value={code} onChange={setCode}/><button className="primary full" disabled={busy||code.length!==6}><KeyRound size={18}/>{busy?'Подписываем…':'Подписать документ ПЭП'}</button></>}</form><button type="button" className={challenge?'text-button':'primary full'} disabled={busy||cooldown.seconds>0} onClick={request}>{busy?'Отправляем…':cooldown.seconds?`Новый код через ${cooldown.seconds} с`:challenge?'Отправить новый код':'Получить Email-код для подписания'}</button>{error&&<p className="form-error" role="alert">{error}</p>}<small>Сервер проверяет код, права участника и неизменность файла. Код и подпись сохраняются одной операцией.</small></div>;
}
