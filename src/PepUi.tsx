import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, CheckCheck, KeyRound, Mail, RefreshCw, ShieldCheck } from 'lucide-react';
import type { Identity } from './api';
import { LOCAL_RECIPIENT, LOCAL_SENDER } from './domain';
import { authorizePep, confirmEnrollment, normalizeContact, OtpChallenge, readProfiles, type DemoProfile, type PepProof } from './pep';

function useOtp() {
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(cooldown - 1), 1000); return () => clearTimeout(timer); }, [cooldown]);
  useEffect(() => () => challenge?.cancel(), [challenge]);
  function issue(purpose: 'enroll' | 'sign', identifier: string, binding = '') {
    challenge?.cancel(); const next = new OtpChallenge(purpose, identifier, binding);
    setChallenge(next); setCode(''); setCooldown(30); return next;
  }
  return { challenge, code, setCode, cooldown, issue };
}
function CodeInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label>Код из 4 цифр<input className="otp-input" autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{4}" minLength={4} maxLength={4} required placeholder="0000" value={value} onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))} /></label>;
}
function OtpNotice({ challenge }: { challenge: OtpChallenge }) {
  return <div className="otp-notice" role="status"><KeyRound size={22} /><div><span>Демо-шлюз OTP: ваш код</span><strong>{challenge.code}</strong><small>{challenge.identifier.includes('@') ? 'Email' : 'SMS'} · действует 5 минут · до 5 попыток. Реальное сообщение не отправляется.</small></div></div>;
}
export function PepOnboarding({ onComplete, onOffer, onOnline }: { onComplete: (profile: DemoProfile) => Promise<void>; onOffer: () => void; onOnline: () => void }) {
  const [contact, setContact] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [accepted, setAccepted] = useState(true);
  const [acceptedAt, setAcceptedAt] = useState('');
  const [step, setStep] = useState<'contact' | 'verify'>('contact');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [profiles] = useState(readProfiles);
  const otp = useOtp();
  function start(e?: FormEvent) {
    e?.preventDefault(); setError('');
    if (!accepted) { setError('Для выпуска ПЭП примите условия регламента и соглашения.'); return; }
    if (displayName.trim().length < 2) { setError('Укажите ФИО или название организации.'); return; }
    try { const identifier = normalizeContact(contact); setContact(identifier); setAcceptedAt(new Date().toISOString()); otp.issue('enroll', identifier); setStep('verify'); } catch (e) { setError((e as Error).message); }
  }
  async function confirm(e: FormEvent) {
    e.preventDefault(); if (!otp.challenge || busy || !accepted) return;
    setBusy(true); setError('');
    try {
      const pep = confirmEnrollment(otp.challenge, otp.code, acceptedAt);
      const previous = profiles.find(p => p.email === pep.pepIdentifier);
      await onComplete({ id: previous?.id || (pep.pepIdentifier === LOCAL_SENDER ? 'local-sender' : pep.pepIdentifier === LOCAL_RECIPIENT ? 'local-recipient' : crypto.randomUUID()), email: pep.pepIdentifier, local: true, displayName: displayName.trim(), pep });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function choose(email: string, name: string) { setContact(email); setDisplayName(name); setError(''); }
  return <div className="login-card pep-onboarding"><span className="overline">ПРОСТАЯ ЭЛЕКТРОННАЯ ПОДПИСЬ</span><h2>{step === 'contact' ? 'Начнём обмен' : 'Подтвердите выпуск ПЭП'}</h2><div className="onboarding-steps" aria-label="Этапы выпуска ПЭП"><span className={step === 'contact' ? 'active' : ''}>1 · Контакт и оферта</span><span className={step === 'verify' ? 'active' : ''}>2 · Проверка OTP</span></div>{step === 'contact' ? <><p>Выпустите демо-ПЭП для подписания договоров и актов по одноразовому коду.</p><div className="quick-profiles"><span>Быстрый выбор профиля</span><button type="button" className="secondary" onClick={() => choose(LOCAL_SENDER, 'Тестовый отправитель')}>Отправитель</button><button type="button" className="secondary" onClick={() => choose(LOCAL_RECIPIENT, 'Тестовый получатель')}>Получатель</button>{profiles.filter(p => ![LOCAL_SENDER, LOCAL_RECIPIENT].includes(p.email)).map(p => <button type="button" className="secondary" key={p.id} onClick={() => choose(p.email, p.displayName)}>{p.displayName}</button>)}</div><form onSubmit={start}><label>ФИО или название организации<input autoComplete="name" required minLength={2} maxLength={120} value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Иван Иванов или ООО «Компания»" /></label><label>Email или телефон<input autoComplete="username" required maxLength={254} value={contact} onChange={e => setContact(e.target.value)} placeholder="user@company.ru или +79991234567" /></label><label className="offer-consent"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} /><span>Принимаю условия Регламента ЭДО „Е-Шлюз“ и соглашение об использовании ПЭП (ч. 2 ст. 6 63-ФЗ)</span></label><button type="button" className="text-button" onClick={onOffer}>Читать оферту</button><button className="primary full" disabled={!accepted || busy}>Получить код и войти <ArrowRight size={18} /></button></form><small>Учебный режим: Email/SMS-коды показываются на экране. Обмен и профили сохраняются в этом браузере.</small><button type="button" className="text-button online-entry" onClick={onOnline}><Mail size={16} />Онлайн-обмен по подтверждённой почте</button></> : <><p>Ключ ПЭП будет связан с контактом <strong>{contact}</strong>.</p>{otp.challenge && <OtpNotice challenge={otp.challenge} />}<form onSubmit={confirm}><CodeInput value={otp.code} onChange={otp.setCode} /><button className="primary full" disabled={busy || otp.code.length !== 4}><CheckCheck size={18} />{busy ? 'Входим…' : 'Подтвердить код и выпустить ПЭП'}</button></form><div className="otp-actions"><button className="text-button" type="button" disabled={busy || otp.cooldown > 0} onClick={() => start()}><RefreshCw size={15} />{otp.cooldown ? `Новый код через ${otp.cooldown} с` : 'Получить новый код'}</button><button className="text-button" type="button" disabled={busy} onClick={() => { otp.challenge?.cancel(); otp.setCode(''); setStep('contact'); setError(''); }}>Изменить данные</button></div></>}{error && <p className="form-error" role="alert">{error}</p>}</div>;
}
export function PepSigning({ user, hash, onConfirm }: { user: Identity; hash: string; onConfirm: (proof: PepProof) => Promise<void> }) {
  const otp = useOtp(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  function issue() { if (!user.pep) return; setError(''); otp.issue('sign', user.pep.pepIdentifier, hash); }
  async function sign(e: FormEvent) {
    e.preventDefault(); if (!otp.challenge || !user.pep || busy) return;
    setBusy(true); setError('');
    try { const proof = authorizePep(otp.challenge, otp.code, user.pep, user.displayName || user.email, hash); await onConfirm(proof); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="pep-signing"><div className="notice success"><ShieldCheck size={21} /><span>ПЭП активна · {user.pep?.pepIdentifier}</span></div><p>Подтверждение подпишет только этот файл. Изменение документа потребует нового кода.</p><div className="hash"><span>SHA-256 документа</span><code>{hash}</code></div><p className="muted">Соглашение {user.pep?.offerVersion} · принято {user.pep && new Date(user.pep.offerAcceptedAt).toLocaleString('ru-RU')}</p>{otp.challenge && <OtpNotice challenge={otp.challenge} />}<form onSubmit={sign}>{otp.challenge && <CodeInput value={otp.code} onChange={otp.setCode} />}{otp.challenge && <button className="primary full" disabled={busy || otp.code.length !== 4}><KeyRound size={17} />{busy ? 'Подписываем…' : 'Подписать документ ПЭП'}</button>}</form><button type="button" className={otp.challenge ? 'text-button' : 'primary full'} disabled={busy || !hash || otp.cooldown > 0} onClick={issue}>{otp.cooldown ? `Новый код через ${otp.cooldown} с` : otp.challenge ? 'Получить новый код' : 'Получить код для подписания'}</button>{error && <p className="form-error" role="alert">{error}</p>}</div>;
}
