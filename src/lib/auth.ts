import { createHash } from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getConfig } from './config';

const COOKIE_NAME = 'admin_auth';
const SALT        = 'nortion-ai-admin';

export function makeToken(secret: string): string {
  return createHash('sha256').update(SALT).update(secret).digest('hex');
}

export async function requireAuth(): Promise<void> {
  const { admin } = getConfig();
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token !== makeToken(admin.secret)) {
    redirect('/login');
  }
}

export async function setAuthCookie(): Promise<void> {
  const { admin } = getConfig();
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, makeToken(admin.secret), {
    httpOnly: true,
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   60 * 60 * 12,
    path:     '/',
  });
}

export async function clearAuthCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
