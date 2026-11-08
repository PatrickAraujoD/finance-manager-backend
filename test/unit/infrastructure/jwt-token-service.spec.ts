import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { JwtTokenService } from '../../../src/infrastructure/tokens/jwt-token-service';
import { UnauthorizedError } from '../../../src/domain/errors';
import { FixedClock } from '../../support/fakes/fixed-clock';

const SECRET = 'test-secret-with-at-least-32-characters!!';

function setup() {
  const clock = new FixedClock();
  return { clock, service: new JwtTokenService({ secret: SECRET, clock }) };
}

describe('JwtTokenService access tokens', () => {
  it('signs HS256 tokens with sub, role and a 15 minute expiry', async () => {
    const { service, clock } = setup();
    const token = await service.signAccess({ sub: 'u1', role: 'A' });
    const decoded = jwt.decode(token, { complete: true }) as jwt.Jwt;
    expect(decoded.header.alg).toBe('HS256');
    const payload = decoded.payload as jwt.JwtPayload;
    expect(payload.sub).toBe('u1');
    expect(payload.role).toBe('A');
    expect(payload.exp).toBe(Math.floor(clock.now().getTime() / 1000) + 15 * 60);
    expect(await service.verifyAccess(token)).toEqual({ sub: 'u1', role: 'A' });
  });

  it('rejects an expired token', async () => {
    const { service, clock } = setup();
    const token = await service.signAccess({ sub: 'u1', role: 'N' });
    clock.advanceMinutes(14);
    await expect(service.verifyAccess(token)).resolves.toBeDefined();
    clock.advanceMinutes(2);
    await expect(service.verifyAccess(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a correctly signed token that has no exp claim', async () => {
    const { service, clock } = setup();
    const iat = Math.floor(clock.now().getTime() / 1000);
    const token = jwt.sign({ role: 'N', iat }, SECRET, { algorithm: 'HS256', subject: 'u1' });
    await expect(service.verifyAccess(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a token older than the access TTL even if its exp is far in the future', async () => {
    const { service, clock } = setup();
    const iat = Math.floor(clock.now().getTime() / 1000);
    const token = jwt.sign({ role: 'N', iat, exp: iat + 365 * 24 * 3600 }, SECRET, {
      algorithm: 'HS256',
      subject: 'u1',
    });
    await expect(service.verifyAccess(token)).resolves.toBeDefined();
    clock.advanceMinutes(16);
    await expect(service.verifyAccess(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a tampered signature and a tampered payload', async () => {
    const { service } = setup();
    const token = await service.signAccess({ sub: 'u1', role: 'N' });
    const [h, p, s] = token.split('.');
    const flipped = s.startsWith('A') ? 'B' + s.slice(1) : 'A' + s.slice(1);
    await expect(service.verifyAccess(`${h}.${p}.${flipped}`)).rejects.toBeInstanceOf(UnauthorizedError);

    const forged = Buffer.from(JSON.stringify({ sub: 'u1', role: 'A', exp: 9999999999 })).toString('base64url');
    await expect(service.verifyAccess(`${h}.${forged}.${s}`)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects tokens signed with another secret', async () => {
    const { service } = setup();
    const other = new JwtTokenService({ secret: 'another-secret-with-32-characters-xx!', clock: new FixedClock() });
    const token = await other.signAccess({ sub: 'u1', role: 'N' });
    await expect(service.verifyAccess(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects alg none tokens, with or without signature', async () => {
    const { service, clock } = setup();
    const exp = Math.floor(clock.now().getTime() / 1000) + 600;
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 'u1', role: 'A', exp })).toString('base64url');
    await expect(service.verifyAccess(`${header}.${body}.`)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(service.verifyAccess(`${header}.${body}.abc`)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects other HMAC algorithms even with the right secret', async () => {
    const { service, clock } = setup();
    const iat = Math.floor(clock.now().getTime() / 1000);
    const token = jwt.sign({ role: 'N', iat }, SECRET, { algorithm: 'HS512', subject: 'u1', expiresIn: 600 });
    await expect(service.verifyAccess(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects garbage and tokens with a bad role or missing sub', async () => {
    const { service, clock } = setup();
    await expect(service.verifyAccess('garbage')).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(service.verifyAccess('')).rejects.toBeInstanceOf(UnauthorizedError);
    const iat = Math.floor(clock.now().getTime() / 1000);
    const badRole = jwt.sign({ role: 'X', iat }, SECRET, { algorithm: 'HS256', subject: 'u1', expiresIn: 600 });
    await expect(service.verifyAccess(badRole)).rejects.toBeInstanceOf(UnauthorizedError);
    const noSub = jwt.sign({ role: 'N', iat }, SECRET, { algorithm: 'HS256', expiresIn: 600 });
    await expect(service.verifyAccess(noSub)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('refuses a short secret', () => {
    expect(() => new JwtTokenService({ secret: 'short', clock: new FixedClock() })).toThrow();
  });
});

describe('JwtTokenService refresh tokens', () => {
  it('generates 48 random bytes as base64url and a SHA-256 hex hash that matches', () => {
    const { service } = setup();
    const { token, hash } = service.generateRefresh();
    expect(token).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(48);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(service.hashRefresh(token)).toBe(hash);
  });

  it('never repeats', () => {
    const { service } = setup();
    const seen = new Set(Array.from({ length: 200 }, () => service.generateRefresh().token));
    expect(seen.size).toBe(200);
  });
});
