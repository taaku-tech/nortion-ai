'use server';
import { redirect } from 'next/navigation';
import { setAuthCookie } from '@/lib/auth';

export async function loginAction(formData: FormData) {
  const password    = formData.get('password');
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || typeof password !== 'string' || password !== adminSecret) {
    redirect('/login?error=1');
  }
  await setAuthCookie(adminSecret);
  redirect('/admin');
}
