import { supabase, type Identity } from './api';
import { parseRecipients, sha256, validateFile, type Draft } from './domain';
import type { PepProfile } from './pep';
export const ONLINE_OFFER_VERSION = 'v1.2-PEP';
export async function pepRequest(body: Record<string, unknown>) {
 if(!supabase)throw new Error('Онлайн-обмен не настроен.');
 const {data,error}=await supabase.functions.invoke('pep-email',{body});
 if(error){let message='Не удалось выполнить запрос. Повторите позже.';try{message=(await error.context.json()).error||message;}catch{}throw new Error(message);}
 if(data?.error)throw new Error(data.error);
 return data;
}
export async function finishOnlineEnrollment(challengeId:string,code:string):Promise<Identity> {
 const data=await pepRequest({action:'verify',challengeId,code});
 const {error}=await supabase!.auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token});
 if(error)throw error;
 return {id:data.userId,email:data.email,displayName:data.displayName,local:false,pep:data.pep as PepProfile};
}
export async function loadOnlineProfile(user:Identity):Promise<Identity> {
 const {data,error}=await supabase!.from('pep_profiles').select('identifier,display_name,offer_version,offer_accepted_at,auth_channel').eq('user_id',user.id).maybeSingle();
 if(error)throw error;
 if(!data||data.identifier!==user.email||data.offer_version!==ONLINE_OFFER_VERSION)return user;
 return {...user,displayName:data.display_name,pep:{pepActive:true,pepIdentifier:data.identifier,offerVersion:data.offer_version,offerAcceptedAt:data.offer_accepted_at,authChannel:'email_otp'}};
}
export interface PreparedSend {id:string;filePath:string;payload:Record<string,unknown>}
export async function prepareOnlineSend(user:Identity,draft:Draft):Promise<PreparedSend> {
 validateFile(draft.file);const emails=parseRecipients(draft.recipients,user.email);
 if(!['contract','act'].includes(draft.kind))throw new Error('Для УПД доступна только имитация КЭП.');
 const id=crypto.randomUUID(),filePath=`${user.id}/${id}/${draft.file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
 const hash=await sha256(await draft.file.arrayBuffer());
 const {error}=await supabase!.storage.from('documents').upload(filePath,draft.file,{upsert:false,contentType:draft.file.type||'application/octet-stream'});
 if(error)throw error;
 return {id,filePath,payload:{id,title:draft.title,kind:draft.kind,number:draft.number,date:draft.date,amount:draft.amount,filename:draft.file.name,file_size:draft.file.size,file_path:filePath,sha256:hash,emails,quarantine_reason:draft.quarantineReason||null}};
}
export async function releasePrepared(prepared:PreparedSend) {
 // The existing storage policy permits deletion only while no document is attached.
 await supabase?.storage.from('documents').remove([prepared.filePath]);
}
