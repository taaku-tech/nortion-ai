'use server';
import { redirect } from 'next/navigation';
import { setAuthCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';

export async function loginAction(formData: FormData) {
  const password = formData.get('password');
  const { admin } = getConfig();
  if (typeof password !== 'string' || password !== admin.password) {
    redirect('/login?error=1');
  }
  await setAuthCookie();
  redirect('/admin');
}
