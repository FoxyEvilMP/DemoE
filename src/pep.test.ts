import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizePep, channelFor, confirmEnrollment, consumePep, generateOtp, normalizeContact, OtpChallenge, readProfiles, restoreDemoSession, saveProfile, clearDemoSession, type DemoProfile } from './pep';
import { parseRecipients } from './domain';

const hash = 'a'.repeat(64);
const acceptedAt = '2026-11-13T13:35:00.000Z';
function enroll(identifier = 'user@company.ru') { const c = new OtpChallenge('enroll', identifier); return confirmEnrollment(c, c.code, acceptedAt); }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('Demo PEP enrollment and OTP lifecycle', () => {
  it('normalizes email/phone and accepts phone recipients only in local demo', () => {
    expect(normalizeContact(' USER@Company.RU ')).toBe('user@company.ru');
    expect(normalizeContact('+7 (999) 123-45-67')).toBe('+79991234567');
    expect(channelFor('+79991234567')).toBe('sms_otp');
    expect(() => normalizeContact('not a contact')).toThrow();
    expect(() => normalizeContact('79991234567')).toThrow();
    expect(parseRecipients('+79991234567', undefined, true)).toEqual(['+79991234567']);
    expect(() => parseRecipients('+79991234567')).toThrow();
    expect(() => parseRecipients('+79991234567', '+79991234567', true)).toThrow();
  });
  it('generates 4-digit codes and records the actual acceptance and channel', () => {
    for (let i = 0; i < 20; i++) expect(generateOtp()).toMatch(/^\d{4}$/);
    expect(enroll()).toEqual({ pepActive: true, pepIdentifier: 'user@company.ru', offerVersion: 'v1.1-PEP', offerAcceptedAt: acceptedAt, authChannel: 'email_otp' });
    expect(enroll('+79991234567').authChannel).toBe('sms_otp');
  });
  it('does not issue PEP after an incorrect code; limits to five attempts', () => {
    const c = new OtpChallenge('enroll', 'user@company.ru');
    const wrong = c.code === '0000' ? '0001' : '0000';
    for (let i = 0; i < 5; i++) expect(() => confirmEnrollment(c, wrong, acceptedAt)).toThrow();
    expect(() => confirmEnrollment(c, c.code, acceptedAt)).toThrow(/Лимит/);
  });
  it('expires after five minutes and rejects reuse or cancellation', () => {
    vi.useFakeTimers();
    const expired = new OtpChallenge('enroll', 'user@company.ru');
    vi.advanceTimersByTime(300000);
    expect(() => confirmEnrollment(expired, expired.code, acceptedAt)).toThrow(/истёк/);
    const c = new OtpChallenge('enroll', 'user@company.ru');
    confirmEnrollment(c, c.code, acceptedAt);
    expect(() => confirmEnrollment(c, c.code, acceptedAt)).toThrow(/использован/);
    const cancelled = new OtpChallenge('enroll', 'user@company.ru'); cancelled.cancel();
    expect(() => confirmEnrollment(cancelled, cancelled.code, acceptedAt)).toThrow(/отменён/);
  });
});
describe('Document-specific PEP authorization', () => {
  it('binds the proof to the signer and exact hash, and permits only one operation', () => {
    const pep = enroll(); const c = new OtpChallenge('sign', pep.pepIdentifier, hash);
    expect(() => authorizePep(c, c.code, pep, 'Иван Иванов', 'b'.repeat(64))).toThrow();
    const proof = authorizePep(c, c.code, pep, 'Иван Иванов', hash);
    expect(() => consumePep(proof, pep, 'b'.repeat(64), 'contract')).toThrow();
    expect(() => consumePep(proof, enroll('other@company.ru'), hash, 'contract')).toThrow();
    expect(() => consumePep({ ...proof }, pep, hash, 'contract')).toThrow();
    const details = consumePep(proof, pep, hash, 'contract');
    expect(details.method).toBe('pep'); expect(details.sha256).toBe(hash); expect(details).not.toHaveProperty('code');
    expect(() => consumePep(proof, pep, hash, 'contract')).toThrow();
  });
  it('blocks formalized UPD and expired authorizations', () => {
    vi.useFakeTimers(); const pep = enroll(); const c = new OtpChallenge('sign', pep.pepIdentifier, hash);
    const proof = authorizePep(c, c.code, pep, 'Иван Иванов', hash);
    expect(() => consumePep(proof, pep, hash, 'upd')).toThrow(/УПД/);
    vi.advanceTimersByTime(300001);
    expect(() => consumePep(proof, pep, hash, 'act')).toThrow();
  });
});
describe('Profile and session persistence', () => {
  it('persists profile metadata without OTP and restores only the selected session', () => {
    const storage = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) }; };
    vi.stubGlobal('localStorage', storage()); vi.stubGlobal('sessionStorage', storage());
    const profile: DemoProfile = { id: 'demo', email: 'user@company.ru', local: true, displayName: 'Иван Иванов', pep: enroll() };
    saveProfile(profile);
    expect(readProfiles()).toEqual([profile]); expect(restoreDemoSession()).toEqual(profile);
    expect(JSON.stringify(readProfiles())).not.toContain('"code"');
    clearDemoSession(); expect(restoreDemoSession()).toBeNull(); expect(readProfiles()).toHaveLength(1);
    localStorage.setItem('e-shlyuz-pep-profiles-v1', 'invalid json');
    expect(readProfiles()).toEqual([]);
  });
});
