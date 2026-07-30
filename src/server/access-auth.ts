import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { AccessAuthService } from './types.js';

const scrypt = promisify(scryptCallback);
const PASSWORD_HASH_KEY = 'access_password_hash';
const SESSION_SECRET_KEY = 'access_session_secret';
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const SCRYPT_KEY_LENGTH = 64;

export const ACCESS_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function createAccessAuthService({
  settings,
  now = () => Date.now()
}: {
  settings: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
  };
  now?: () => number;
}): AccessAuthService {
  async function getSessionSecret(): Promise<string> {
    const existing = await settings.get(SESSION_SECRET_KEY);
    if (existing) return existing;
    const secret = randomBytes(32).toString('base64url');
    await settings.set(SESSION_SECRET_KEY, secret);
    return secret;
  }

  async function createSessionToken(): Promise<string> {
    const expiresAt = Math.floor(now() / 1000) + ACCESS_SESSION_MAX_AGE_SECONDS;
    const payload = `${expiresAt}.${randomBytes(18).toString('base64url')}`;
    return `${payload}.${sign(payload, await getSessionSecret())}`;
  }

  async function isValidSession(token: string | null): Promise<boolean> {
    if (!token) return false;
    const parts = token.split('.');
    if (parts.length !== 3 || !/^\d+$/.test(parts[0])) return false;
    const expiresAt = Number(parts[0]);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now() / 1000)) return false;
    const payload = `${parts[0]}.${parts[1]}`;
    return safeEqual(parts[2], sign(payload, await getSessionSecret()));
  }

  return {
    async getStatus(sessionToken) {
      const configured = Boolean(await settings.get(PASSWORD_HASH_KEY));
      return {
        configured,
        authenticated: configured && await isValidSession(sessionToken)
      };
    },

    async setup(password) {
      validatePassword(password);
      if (await settings.get(PASSWORD_HASH_KEY)) {
        throw accessError('访问密码已经设置', 409);
      }
      await settings.set(PASSWORD_HASH_KEY, await hashPassword(password));
      await getSessionSecret();
      return createSessionToken();
    },

    async login(password) {
      validatePassword(password);
      const storedHash = await settings.get(PASSWORD_HASH_KEY);
      if (!storedHash || !await verifyPassword(password, storedHash)) {
        throw accessError('密码错误', 401);
      }
      return createSessionToken();
    }
  };
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT_KEY_LENGTH) as Buffer;
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltValue, hashValue] = stored.split('$');
  if (algorithm !== 'scrypt' || !saltValue || !hashValue) return false;
  try {
    const expected = Buffer.from(hashValue, 'base64url');
    const actual = await scrypt(password, Buffer.from(saltValue, 'base64url'), expected.length) as Buffer;
    return expected.length > 0 && expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function validatePassword(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw accessError(`密码长度需要在 ${PASSWORD_MIN_LENGTH} 到 ${PASSWORD_MAX_LENGTH} 个字符之间`, 400);
  }
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', Buffer.from(secret, 'base64url')).update(payload).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function accessError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode, expose: true });
}
