'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/app/lib/supabase/server';

const CredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

function safeRedirectPath(value: FormDataEntryValue | null) {
  const path = typeof value === 'string' ? value : '';
  return path.startsWith('/') && !path.startsWith('//') ? path : '/dashboard';
}

export async function authenticate(
  prevState: string | undefined,
  formData: FormData,
) {
  const parsed = CredentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return 'Invalid credentials.';

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return error.code === 'invalid_credentials'
      ? 'Invalid credentials.'
      : 'Something went wrong.';
  }

  redirect(safeRedirectPath(formData.get('redirectTo')));
}

export async function signInWithGithub(formData: FormData) {
  const origin = (await headers()).get('origin');
  const next = safeRedirectPath(formData.get('redirectTo'));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error || !data.url) redirect('/login?error=oauth');

  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/');
}
