# Chapter 16: Sign in with GitHub using Supabase Auth

In Chapter 15 you added login with NextAuth.js and a Credentials provider. In this chapter you replace NextAuth with **Supabase Auth** and add a **"Continue with GitHub"** button. Email and password login keeps working.

## What you'll learn

- How an OAuth login flow works (your app → Supabase → GitHub → back to your app)
- How Supabase keeps the session in cookies with `@supabase/ssr`
- How to protect routes in `proxy.ts` with `getClaims()`
- How the setup differs between **local development** and **production** (Vercel + hosted Supabase)

## Before you start

You need:

- The dashboard app finished up to Chapter 15
- A hosted Supabase project (the one your production database runs on)
- A GitHub account
- Optional, for local development: the Supabase CLI and Docker, with a local stack running (`npx supabase start`)

> **Using a different local setup?** If you don't run Supabase locally, you can point your local app at your hosted project instead. Then you only need the **Production** steps in step 10, plus one extra redirect URL for `http://localhost:3000/**`.

## How the GitHub login works

```
Browser                Your Next.js app              Supabase Auth             GitHub
   |  click "Continue      |                             |                        |
   |  with GitHub" ------> | signInWithOAuth()           |                        |
   |                       | ------ gets login URL ----> |                        |
   | <---- redirect ------ |                             |                        |
   | ------------------------------------------------->  | ---- redirect ------>  |
   |                       |                             |      user approves     |
   |                       |                             | <--- code ------------ |
   | <------------------ redirect to /auth/callback?code=... ---------------------|
   | ------------------->  | exchangeCodeForSession()    |                        |
   |                       | ------------------------->  |                        |
   | <-- session cookie +  |                             |                        |
   |     redirect to /dashboard                          |                        |
```

Your app never talks to GitHub directly. **Supabase** holds the GitHub client ID and secret. GitHub sends the user back to Supabase, and Supabase sends the user back to your app's `/auth/callback` route with a one-time `code`. Your app swaps that code for a session and stores it in cookies.

## Local vs. production at a glance

| | Local development | Production |
|---|---|---|
| Supabase | Local stack in Docker (`npx supabase start`) | Hosted project on supabase.com |
| Supabase URL | `http://127.0.0.1:54321` (check `npx supabase status`) | `https://<project-ref>.supabase.co` |
| App URL | `http://localhost:3000` | `https://<your-app>.vercel.app` |
| GitHub OAuth app | **App #1** with callback `http://127.0.0.1:54321/auth/v1/callback` | **App #2** with callback `https://<project-ref>.supabase.co/auth/v1/callback` |
| Where GitHub credentials go | `supabase/.env`, read by `supabase/config.toml` | Supabase dashboard → Authentication → Providers → GitHub |
| Allowed redirect URLs | `additional_redirect_urls` in `supabase/config.toml` | Supabase dashboard → Authentication → URL Configuration |
| App env vars | `.env.local` | Vercel → Project → Settings → Environment Variables |
| Restart needed after changes | `npx supabase stop && npx supabase start` | No restart; redeploy on Vercel after env var changes |

> **Why two GitHub OAuth apps?** A GitHub OAuth app accepts only **one** callback URL. Local and production Supabase have different URLs, so each needs its own app.

---

## Step 1: Install the Supabase packages

```bash
pnpm add @supabase/supabase-js @supabase/ssr --save-exact
```

- `@supabase/supabase-js` is the Supabase client.
- `@supabase/ssr` stores the session in cookies, so both the server and the browser can read it.

`--save-exact` pins the versions. That is a good habit for security-related packages.

## Step 2: Add environment variables

Your app needs two values: the Supabase URL and the **publishable key**.

**Local** (`.env.local`): get the values from:

```bash
npx supabase status
```

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

**Production:** find them in the Supabase dashboard under **Project Settings → API Keys**. You'll add them to Vercel in step 10.

You can delete `AUTH_SECRET` and `AUTH_URL` from `.env.local`. They were for NextAuth.

> **Why does the key start with `NEXT_PUBLIC_`?** Next.js sends every `NEXT_PUBLIC_` variable to the browser. That is fine for the **publishable** key, which is designed to be public. **Never** put the **secret** key or the `service_role` key in a `NEXT_PUBLIC_` variable. Those keys bypass all security rules.

## Step 3: Create the Supabase server client

Create `app/lib/supabase/server.ts`:

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Create a new client per request; never share one across requests.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Safe to ignore: proxy.ts refreshes the session.
          }
        },
      },
    },
  );
}
```

Server Components, Server Actions and Route Handlers use this client. It reads and writes the session cookies through Next.js's `cookies()`.

## Step 4: Protect routes in `proxy.ts`

The proxy runs before every request. It has two jobs:

1. **Refresh the session.** Supabase access tokens expire after about an hour. `getClaims()` verifies the token and refreshes it if needed.
2. **Redirect.** Logged-out users can't open `/dashboard`, and logged-in users skip `/login`. This replaces the `authorized` callback from `auth.config.ts`.

Create `app/lib/supabase/proxy.ts`:

```ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    },
  );

  // Verifies the JWT and refreshes the session if it has expired.
  // Do not run code between createServerClient and getClaims.
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = !!data?.claims;

  const { pathname } = request.nextUrl;
  const isOnDashboard = pathname.startsWith('/dashboard');
  const isOnLogin = pathname.startsWith('/login');

  if (isOnDashboard && !isLoggedIn) {
    return redirectKeepingCookies(request, response, '/login');
  }
  if (isOnLogin && isLoggedIn) {
    return redirectKeepingCookies(request, response, '/dashboard');
  }

  return response;
}

function redirectKeepingCookies(
  request: NextRequest,
  response: NextResponse,
  pathname: string,
) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = '';
  const redirect = NextResponse.redirect(url);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}
```

Then replace the contents of `proxy.ts` in the project root:

```ts
import { type NextRequest } from 'next/server';
import { updateSession } from '@/app/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // https://nextjs.org/docs/app/api-reference/file-conventions/proxy#matcher
  matcher: ['/((?!api|_next/static|_next/image|.*\\.png$).*)'],
};
```

> **`getClaims()` vs. `getSession()`:** In server code, always use `getClaims()`. It checks the token's signature. `getSession()` only reads the cookie and trusts it, and anyone can edit their own cookies.

## Step 5: Rewrite the Server Actions

Replace `app/lib/actions.ts` with the version below. If your file already has invoice actions (`createInvoice`, `updateInvoice`, …) from earlier chapters, keep them and replace only the auth parts: `authenticate`, plus the new `signInWithGithub` and `signOut`.

```ts
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
```

Some things to notice:

- `signInWithOAuth` doesn't log anyone in. It **returns a URL** on Supabase, and we redirect the browser there.
- `redirectTo` tells Supabase where to send the user afterwards. We use the request's `origin`, so the same code works on `localhost:3000` and on your Vercel domain. **Supabase only accepts this URL if it is on its allow list** (step 10).
- `safeRedirectPath` accepts only paths inside our own site, like `/dashboard`. Without it, an attacker could craft a login link that sends users to another website afterwards. This is called an *open redirect*.

## Step 6: Add the OAuth callback route

After the user approves on GitHub, Supabase redirects them to `/auth/callback?code=...`. Create `app/auth/callback/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/app/lib/supabase/server';

// GitHub redirects here (via Supabase) with a one-time code after login.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  let next = searchParams.get('next') ?? '/dashboard';
  // Only allow relative redirects.
  if (!next.startsWith('/') || next.startsWith('//')) next = '/dashboard';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=oauth`);
}
```

`exchangeCodeForSession` swaps the one-time code for a session and writes the session cookies.

## Step 7: Add the GitHub button to the login form

Replace `app/ui/login-form.tsx`:

```tsx
'use client';

import { lusitana } from '@/app/ui/fonts';
import {
  AtSymbolIcon,
  KeyIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import { ArrowRightIcon } from '@heroicons/react/20/solid';
import { Button } from '@/app/ui/button';
import { useActionState } from 'react';
import { authenticate, signInWithGithub } from '@/app/lib/actions';
import { useSearchParams } from 'next/navigation';

export default function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';
  const oauthError =
    searchParams.get('error') === 'oauth'
      ? 'GitHub sign-in failed.'
      : undefined;
  const [errorMessage, formAction, isPending] = useActionState(
    authenticate,
    oauthError,
  );

  return (
    <>
      <form action={formAction} className="space-y-3">
        <div className="flex-1 rounded-lg bg-gray-50 px-6 pb-4 pt-8">
          <h1 className={`${lusitana.className} mb-3 text-2xl`}>
            Please log in to continue.
          </h1>
          <div className="w-full">
            <div>
              <label
                className="mb-3 mt-5 block text-xs font-medium text-gray-900"
                htmlFor="email"
              >
                Email
              </label>
              <div className="relative">
                <input
                  className="peer block w-full rounded-md border border-gray-200 py-[9px] pl-10 text-sm outline-2 placeholder:text-gray-500"
                  id="email"
                  type="email"
                  name="email"
                  placeholder="Enter your email address"
                  required
                />
                <AtSymbolIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500 peer-focus:text-gray-900" />
              </div>
            </div>
            <div className="mt-4">
              <label
                className="mb-3 mt-5 block text-xs font-medium text-gray-900"
                htmlFor="password"
              >
                Password
              </label>
              <div className="relative">
                <input
                  className="peer block w-full rounded-md border border-gray-200 py-[9px] pl-10 text-sm outline-2 placeholder:text-gray-500"
                  id="password"
                  type="password"
                  name="password"
                  placeholder="Enter password"
                  required
                  minLength={6}
                />
                <KeyIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500 peer-focus:text-gray-900" />
              </div>
            </div>
          </div>
          <input type="hidden" name="redirectTo" value={callbackUrl} />
          <Button className="mt-4 w-full" aria-disabled={isPending}>
            Log in <ArrowRightIcon className="ml-auto h-5 w-5 text-gray-50" />
          </Button>
          <div
            className="flex h-8 items-end space-x-1"
            aria-live="polite"
            aria-atomic="true"
          >
            {errorMessage && (
              <>
                <ExclamationCircleIcon className="h-5 w-5 text-red-500" />
                <p className="text-sm text-red-500">{errorMessage}</p>
              </>
            )}
          </div>
        </div>
      </form>
      <form action={signInWithGithub}>
        <input type="hidden" name="redirectTo" value={callbackUrl} />
        <button className="flex h-10 w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500">
          Continue with GitHub
        </button>
      </form>
    </>
  );
}
```

The GitHub button lives in its **own `<form>`**. HTML doesn't allow nested forms. A separate form also keeps the `required` email and password fields from blocking the GitHub button.

## Step 8: Update the Sign Out button

In `app/ui/dashboard/sidenav.tsx`, import `signOut` from the actions file instead of from `@/auth`:

```tsx
import { signOut } from '@/app/lib/actions';
```

Then replace the sign-out form with:

```tsx
<form action={signOut}>
  <button className="flex h-[48px] grow items-center justify-center gap-2 rounded-md bg-gray-50 p-3 text-sm font-medium hover:bg-sky-100 hover:text-blue-600 md:flex-none md:justify-start md:p-2 md:px-3">
    <PowerIcon className="w-6" />
    <div className="hidden md:block">Sign Out</div>
  </button>
</form>
```

## Step 9: Remove NextAuth

```bash
rm auth.ts auth.config.ts
pnpm remove next-auth
```

Keep `bcrypt`. The `/seed` route still uses it.

Run a type check to make sure nothing still imports `@/auth`:

```bash
npx tsc --noEmit
```

---

## Step 10: Configure GitHub and Supabase

This step is different for local and production. Do **10A** for local development and **10B** for production.

### 10A: Local development

**1. Create GitHub OAuth app #1 (local).**
Go to GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**:

| Field | Value |
|---|---|
| Application name | `dashboard-app (local)` |
| Homepage URL | `http://localhost:3000` |
| Authorization callback URL | `http://127.0.0.1:54321/auth/v1/callback` |

Use the port your local Supabase **API** runs on (`API_URL` in `npx supabase status`). The callback goes to **Supabase**, not to your Next.js app.

Click **Generate a new client secret** and copy it right away. GitHub shows it only once.

**2. Store the credentials in `supabase/.env`.**
Create `supabase/.env`:

```bash
SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID=your-client-id
SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET=your-client-secret
```

Check that git ignores it:

```bash
git check-ignore -v supabase/.env
```

If that prints nothing, add `.env` to your `.gitignore`. **Never commit an OAuth secret.**

**3. Enable GitHub in `supabase/config.toml`.**
Find the `[auth]` section and set the site URL and allowed redirect URLs:

```toml
[auth]
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000/**", "http://127.0.0.1:3000/**"]
```

Then add a GitHub section next to the other `[auth.external.*]` sections:

```toml
[auth.external.github]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET)"
```

`env(...)` tells the Supabase CLI to read the value from `supabase/.env`, so the secret never lands in `config.toml`.

**4. Restart the local stack** so it picks up the new config:

```bash
npx supabase stop && npx supabase start
```

**5. Create a test user for email login.**
Open local Studio (`STUDIO_URL` from `npx supabase status`), go to **Authentication → Users → Add user**, and create `user@nextmail.com` with password `123456`. Tick **Auto Confirm User**.

> Your old `users` table from the seed script is **not** used anymore. Supabase keeps its users in its own `auth.users` table.

### 10B: Production (Vercel + hosted Supabase)

**1. Create GitHub OAuth app #2 (production).**

| Field | Value |
|---|---|
| Application name | `dashboard-app` |
| Homepage URL | `https://<your-app>.vercel.app` |
| Authorization callback URL | `https://<project-ref>.supabase.co/auth/v1/callback` |

Your `<project-ref>` is the ID in your Supabase dashboard URL: `supabase.com/dashboard/project/<project-ref>`. You can also copy the exact callback URL from the GitHub provider page in the next step.

**2. Enable GitHub in the Supabase dashboard.**
Go to **Authentication → Sign In / Providers → GitHub**, turn it on, and paste the client ID and secret from app #2. Save.

There's no `config.toml` or `supabase/.env` in production. **The dashboard is where production settings live.**

**3. Tell Supabase your app's URL. (Required: login fails without this.)**

Three services are involved, and each one needs to know a different URL. Mixing them up is the most common mistake in this chapter:

| Where | Setting | Value | Why |
|---|---|---|---|
| **Supabase** dashboard → **Authentication → URL Configuration** | **Site URL** | `https://<your-app>.vercel.app` | Where Supabase sends users when it doesn't accept the requested redirect URL. **The default is `http://localhost:3000`, so you must change it.** |
| **Supabase** dashboard → **Authentication → URL Configuration** | **Redirect URLs** → **Add URL** | `https://<your-app>.vercel.app/**` | The allow list. After login, Supabase sends users back to `/auth/callback` only if that URL matches an entry here. |
| **Supabase** dashboard → **Authentication → URL Configuration** | **Redirect URLs** → **Add URL** (optional) | `https://*-<your-vercel-team>.vercel.app/**` | Lets Vercel preview deployments log in too. |
| **GitHub** → Settings → Developer settings → OAuth Apps → app #2 | **Authorization callback URL** | `https://<project-ref>.supabase.co/auth/v1/callback` | You set this in step 1. It points to **Supabase**, never to your Vercel URL. GitHub only talks to Supabase. |
| **Vercel** | *(nothing)* | — | The app builds the callback URL from the address the request came in on, so no URL setting is needed. Vercel only needs the env vars from step 4. |

Click **Save** in Supabase. The change takes effect immediately, with no redeploy.

> **Symptom if you skip this:** you click **Continue with GitHub**, approve on GitHub, and your production site sends you to **`http://localhost:3000`**. Supabase didn't find your Vercel URL on the allow list, so it used the Site URL, which is still the default.

**4. Add environment variables in Vercel.**
Go to **Vercel → your project → Settings → Environment Variables**:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` from **Project Settings → API Keys** |

Delete `AUTH_SECRET` and `AUTH_URL`.

> `NEXT_PUBLIC_` variables are baked into the JavaScript bundle **at build time**. After adding or changing them, you must **redeploy**. Saving the variable alone doesn't change the running site.

**5. Create the test user.**
In the Supabase dashboard, go to **Authentication → Users → Add user**, create `user@nextmail.com`, and tick **Auto Confirm User**.

**6. Deploy.**
Commit your changes and push. Vercel builds and deploys automatically.

---

## Step 11: Lock down your tables with Row Level Security

This step matters. Your publishable key is now in the browser, and Supabase exposes tables in the `public` schema through its REST API (the "Data API"). Without **Row Level Security (RLS)**, anyone who copies the key from your site could read your invoices, or even your old `users` table with its password hashes.

Our app reads the data on the server as the `postgres` database user, which **bypasses RLS**. So we can turn on RLS **without adding any policies**. That blocks the Data API completely and doesn't break the app.

Run this SQL. For **local**, use Studio → SQL Editor, or create a migration with `npx supabase migration new enable_rls_on_public_tables`. For **production**, use the Supabase dashboard → **SQL Editor**:

```sql
alter table public.users enable row level security;
alter table public.customers enable row level security;
alter table public.invoices enable row level security;
alter table public.revenue enable row level security;
```

Check that it worked. This should return `[]`:

```bash
curl "<SUPABASE_URL>/rest/v1/invoices?select=id&limit=1" \
  -H "apikey: <PUBLISHABLE_KEY>"
```

Also check **Advisors → Security Advisor** in the dashboard. It should no longer warn about "RLS disabled in public".

---

## Step 12: Test it

Start your app with `pnpm dev` and check each of these:

- [ ] Opening `/dashboard` while logged out sends you to `/login`
- [ ] A wrong password shows **"Invalid credentials."**
- [ ] `user@nextmail.com` / `123456` logs you in and shows the dashboard
- [ ] Opening `/login` while logged in sends you to `/dashboard`
- [ ] **Continue with GitHub** → approve on GitHub → you land on `/dashboard`
- [ ] **Sign Out** logs you out, and `/dashboard` now redirects to `/login`
- [ ] Your GitHub user appears in Supabase under **Authentication → Users**

Open DevTools → **Application → Cookies**. You'll see a cookie named `sb-<something>-auth-token`. That's your Supabase session. It replaced NextAuth's `authjs.session-token`.

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| GitHub says **"The redirect_uri is not associated with this application"** | The callback URL in the GitHub OAuth app doesn't match Supabase's | Local: `http://127.0.0.1:<API port>/auth/v1/callback`. Prod: `https://<project-ref>.supabase.co/auth/v1/callback`. Check the port with `npx supabase status` |
| The GitHub login URL shows `client_id=env%28SUPABASE_AUTH...` | The local stack didn't find your credentials | Put them in `supabase/.env`, then run `npx supabase stop && npx supabase start` |
| Production sends you to **`http://localhost:3000`** after GitHub login | Supabase **Site URL** is still the default and your Vercel URL isn't on the allow list | Supabase dashboard → **Authentication → URL Configuration**: set Site URL and add `https://<your-app>.vercel.app/**` (step 10B.3) |
| Locally, you land on the homepage logged out after GitHub login | Your local app URL isn't in the redirect allow list | Add it to `additional_redirect_urls` in `supabase/config.toml`, then restart the stack |
| **"GitHub sign-in failed."** on the login page | `/auth/callback` couldn't exchange the code | Open the same browser you started the login in; check the Supabase Auth logs |
| **"Unsupported provider: provider is not enabled"** | GitHub isn't enabled | Local: `enabled = true` in `config.toml`, then restart. Prod: turn it on in the dashboard |
| Works locally but not on Vercel | Env vars missing, or no redeploy after adding them | Add both `NEXT_PUBLIC_SUPABASE_*` vars and **redeploy** |
| Email login says **"Invalid credentials."** for the right password | The user exists only in your old `users` table | Create the user under **Authentication → Users** |

## Security notes

- **Anyone with a GitHub account can now sign up** and see your dashboard. For a real private app, turn off **Allow new users to sign up** in Supabase once your own accounts exist, or check the user's email in `/auth/callback` against an allow list.
- **Keep secrets out of git and out of `NEXT_PUBLIC_` variables.** That means the GitHub client secret and the Supabase secret or `service_role` keys.
- If you ever paste a client secret somewhere public (a chat, a screenshot, a commit), **regenerate it** in the GitHub OAuth app settings.

## Summary

You replaced NextAuth with Supabase Auth and added GitHub login:

- `@supabase/ssr` keeps the session in cookies, and `proxy.ts` refreshes it and protects `/dashboard`.
- `signInWithOAuth` + `/auth/callback` + `exchangeCodeForSession` make up the whole OAuth flow in your app.
- **Local** configuration lives in `supabase/config.toml` and `supabase/.env`. **Production** configuration lives in the Supabase dashboard and Vercel.
- You need **two GitHub OAuth apps**, one per Supabase callback URL.
- RLS with no policies closes the Data API, and your server-side queries keep working.
