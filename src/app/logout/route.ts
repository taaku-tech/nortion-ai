import { redirect } from 'next/navigation';
import { clearAuthCookie } from '@/lib/auth';

export async function GET(): Promise<never> {
  await clearAuthCookie();
  redirect('/login');
}
