# Deploy to Vercel — quickstart

OCC Recovery is a stock Next.js 16 app. Vercel auto-detects everything; you only need to set 2 environment variables.

## 1. Import repo

1. Sign in at https://vercel.com (use your GitHub account so the integration sees private repos).
2. Click **Add New… → Project**.
3. Pick `Haunguyen1988/occ-disruption-recovery-web`.
4. Framework: **Next.js** (auto-detected). Root directory: `./`. Leave build/install commands as defaults.

## 2. Environment variables

Add these for **Production**, **Preview**, and **Development**:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<your-project>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the **anon** (publishable) key from Supabase → Project Settings → API |

> **Do NOT** add `SUPABASE_SERVICE_ROLE_KEY`. The app does not need it; RLS policies + signed-in users + anon key are sufficient.

## 3. Deploy

Click **Deploy**. First build takes ~90 s.

When it's green, your app is live at e.g. `https://occ-disruption-recovery-web.vercel.app`.

## 4. (Optional) Custom domain

Project → **Settings → Domains** → add e.g. `occ.vietjet.internal` (you'll need DNS access).

## 5. Production checklist before sharing the URL with users

- [ ] Run `supabase/migrations/0001_init.sql`, `0002_curfew_and_multi_event.sql`, and `0003_approval_safety.sql` against the Supabase project in order.
- [ ] Create the user accounts in Supabase Dashboard → **Authentication → Users**.
- [ ] Set roles: in the SQL editor —
  ```sql
  update public.profiles set role = 'controller' where email in ('a@b.com', 'c@d.com');
  update public.profiles set role = 'admin'      where email = 'admin@your-org.com';
  ```
- [ ] Open `https://<your-vercel-url>/login`, sign in, smoke-test the full flow.

## 6. PR previews

Every pull request gets a unique preview URL automatically. The CI workflow at `.github/workflows/ci.yml` runs lint + test + build before merge so previews are guaranteed to compile.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Build fails: "Module not found" | Vercel Node version mismatch | Settings → Node.js Version → 22 |
| Preview shows "Stub mode" sidebar | Env vars not set for **Preview** environment | Re-add them with all 3 environments ticked |
| Sign-in error "Invalid API key" | Wrong key (service-role vs anon) | Use the **anon** key |
| Login succeeds but Save buttons hidden | Default role is `viewer` | Run the role-update SQL above |
| 5xx on `/dashboard` | Supabase URL typo | Double-check `https://<id>.supabase.co` |
