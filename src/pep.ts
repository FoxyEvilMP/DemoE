export const PEP_OFFER_VERSION = 'v1.1-PEP';
export type AuthChannel = 'email_otp' | 'sms_otp';
export interface PepProfile {
  pepActive: true; pepIdentifier: string; offerVersion: string; offerAcceptedAt: string; authChannel: AuthChannel;
}
export interface DemoProfile { id: string; email: string; local: true; displayName: string; pep: PepProfile }
export interface PepProof extends PepProfile {
  method: 'pep'; simulated: true; signerName: string; documentSha256: string; challengeId: string; signedAt: string;
}
export function normalizeContact(raw: string) {
  const value = raw.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254) return value.toLowerCase();
  const phone = value.replace(/[\s()-]/g, '');
  if (/^\+[1-9]\d{9,14}$/.test(phone)) return phone;
  throw new Error('Укажите email или телефон в международном формате, например +79991234567.');
}
export function channelFor(contact: string): AuthChannel { return contact.includes('@') ? 'email_otp' : 'sms_otp'; }
export function generateOtp() {
  const bytes = new Uint16Array(1);
  do { crypto.getRandomValues(bytes); } while (bytes[0] >= 60000);
  return String(bytes[0] % 10000).padStart(4, '0');
}
export class OtpChallenge {
  readonly id = crypto.randomUUID();
  readonly code = generateOtp();
  readonly expiresAt: number;
  private used = false;
  private attempts = 0;
  constructor(readonly purpose: 'enroll' | 'sign', readonly identifier: string, readonly binding = '', now = Date.now()) { this.expiresAt = now + 5 * 60_000; }
  get unavailable() { return this.used || this.attempts >= 5 || Date.now() >= this.expiresAt; }
  cancel() { this.used = true; }
  verify(code: string) {
    if (this.used) throw new Error('Код уже использован или отменён. Запросите новый.');
    if (Date.now() >= this.expiresAt) throw new Error('Срок действия кода истёк. Запросите новый.');
    if (this.attempts >= 5) throw new Error('Лимит попыток исчерпан. Запросите новый код.');
    this.attempts++;
    if (!/^\d{4}$/.test(code) || code !== this.code) throw new Error(this.attempts >= 5 ? 'Лимит попыток исчерпан. Запросите новый код.' : 'Неверный код. Проверьте 4 цифры в демо-уведомлении.');
    this.used = true;
  }
}
export function confirmEnrollment(challenge: OtpChallenge, code: string, acceptedAt: string): PepProfile {
  if (challenge.purpose !== 'enroll' || !Number.isFinite(Date.parse(acceptedAt))) throw new Error('Начните выпуск ПЭП заново.');
  challenge.verify(code);
  return { pepActive: true, pepIdentifier: challenge.identifier, offerVersion: PEP_OFFER_VERSION, offerAcceptedAt: acceptedAt, authChannel: channelFor(challenge.identifier) };
}
const authorizations = new WeakSet<PepProof>();
export function authorizePep(challenge: OtpChallenge, code: string, profile: PepProfile, signerName: string, hash: string): PepProof {
  if (!profile.pepActive || profile.offerVersion !== PEP_OFFER_VERSION || challenge.purpose !== 'sign' || challenge.identifier !== profile.pepIdentifier || challenge.binding !== hash || !/^[0-9a-f]{64}$/.test(hash)) throw new Error('Код не связан с этим профилем и документом.');
  challenge.verify(code);
  const proof: PepProof = Object.freeze({ ...profile, method: 'pep', simulated: true, signerName, documentSha256: hash, challengeId: challenge.id, signedAt: new Date().toISOString() });
  authorizations.add(proof); return proof;
}
export function consumePep(proof: PepProof, profile: PepProfile | undefined, hash: string, kind: string) {
  if (kind === 'upd') throw new Error('Для УПД с НДС в прототипе доступна только имитация КЭП.');
  if (!profile?.pepActive || profile.offerVersion !== PEP_OFFER_VERSION || !authorizations.has(proof) || proof.pepIdentifier !== profile.pepIdentifier || proof.documentSha256 !== hash || proof.offerAcceptedAt !== profile.offerAcceptedAt || Date.now() - Date.parse(proof.signedAt) > 5 * 60_000) throw new Error('Подтвердите подписание новым кодом ПЭП для этого документа.');
  authorizations.delete(proof); return { ...proof, sha256: hash };
}
const PROFILES_KEY = 'e-shlyuz-pep-profiles-v1';
const SESSION_KEY = 'e-shlyuz-pep-session-v1';
function isProfile(value: unknown): value is DemoProfile {
  if (!value || typeof value !== 'object') return false;
  const p = value as DemoProfile;
  try { return p.local === true && typeof p.id === 'string' && p.id.length > 0 && typeof p.displayName === 'string' && p.displayName.trim().length >= 2 && normalizeContact(p.email) === p.email && p.pep?.pepActive === true && p.pep.pepIdentifier === p.email && p.pep.offerVersion === PEP_OFFER_VERSION && Number.isFinite(Date.parse(p.pep.offerAcceptedAt)) && p.pep.authChannel === channelFor(p.email); } catch { return false; }
}
export function readProfiles(): DemoProfile[] {
  try { const data: unknown = JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]'); return Array.isArray(data) ? data.filter(isProfile) : []; } catch { return []; }
}
export function saveProfile(profile: DemoProfile) {
  if (!isProfile(profile)) throw new Error('Профиль ПЭП заполнен некорректно.');
  localStorage.setItem(PROFILES_KEY, JSON.stringify([profile, ...readProfiles().filter(p => p.email !== profile.email)]));
  sessionStorage.setItem(SESSION_KEY, profile.email);
}
export function restoreDemoSession(): DemoProfile | null {
  try { const id = sessionStorage.getItem(SESSION_KEY); return readProfiles().find(p => p.email === id) || null; } catch { return null; }
}
export function clearDemoSession() { sessionStorage.removeItem(SESSION_KEY); }
