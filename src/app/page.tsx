import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { makeToken } from '@/lib/auth';
import { getConfig } from '@/lib/config';

export default async function Page() {
  const { admin } = getConfig();
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_auth')?.value;

  if (token === makeToken(admin.secret)) {
    redirect('/admin');
  }
  redirect('/login');
}
