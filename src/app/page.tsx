import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { makeToken } from '@/lib/auth';

export default async function Page() {
  const adminSecret = process.env.ADMIN_SECRET;
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_auth')?.value;

  if (adminSecret && token === makeToken(adminSecret)) {
    redirect('/admin');
  }
  redirect('/login');
}
