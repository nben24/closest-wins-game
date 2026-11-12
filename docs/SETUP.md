# Setup guide: Vercel + Supabase (+ optional Anthropic)

Do the steps in order. Keep a private note (password manager or a text file **outside** this project) for anything you copy, and never commit secrets to GitHub.

## What's automatic and what's manual

| Thing | How it gets done |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Automatic** — added by the Supabase integration |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **Automatic** — added by the Supabase integration |
| Database connection | **Automatic** — the app uses the integration's `POSTGRES_URL` (`DATABASE_URL` is only needed if you don't use the integration) |
| Database tables | **Automatic** — created on every production deploy (`vercel.json` → `npm run vercel-build`) |
| Nightly job schedule | **Automatic** — from `vercel.json` |
| Guest (anonymous) sign-ins | **Manual** — one switch in Supabase (Step 3) |
| `CRON_SECRET` | **Manual** — you make one up (Step 4) |
| Your admin account | **Manual** — create a user + paste one SQL line (Step 5) |
| `ANTHROPIC_API_KEY` | **Manual, optional** — only for AI-generated questions (Step 7) |

Don't add `LOCAL_ADMIN_PASSWORD`, `LOCAL_SESSION_SECRET`, `LOCAL_DB_DIR` or `ALLOW_DEMO_CONTENT` on Vercel — they're for running on your own computer only.

---

## Step 1 — Import the GitHub repo into Vercel
1. Go to https://vercel.com and sign in with **Continue with GitHub**.
2. Top right: **Add New…** → **Project**.
3. Under **Import Git Repository**, find `closest-wins-game` → **Import**.
   - Not listed? Click **Adjust GitHub App Permissions**, give Vercel access to `nben24/closest-wins-game`, and come back.
4. Leave everything as is (Framework Preset: **Next.js**). Click **Deploy**.

The site will build but show "Supabase is not configured" until Step 2 — that's expected.

## Step 2 — Create and connect Supabase from Vercel
1. Open your project in Vercel → **Storage** tab (top menu).
2. Click **Create Database** (or **Connect Database**) → choose **Supabase** → **Continue**.
3. Pick the **Free** plan, a name (e.g. `closest-wins`) and a region near you (e.g. US East) → **Create**.
4. When asked which environments to connect, tick **Production**, **Preview** and **Development** → **Connect**.
5. Check: Vercel project → **Settings** tab → **Environment Variables**. You should now see `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `POSTGRES_URL` and several more `POSTGRES_…` / `SUPABASE_…` entries.
   - Click the eye icon on `POSTGRES_URL`: it should contain `pooler.supabase.com:6543`. If it shows `:5432` instead, see Troubleshooting.

## Step 3 — Turn on guest sign-ins (in Supabase)
1. Vercel project → **Storage** tab → click your Supabase database → **Open in Supabase** (this opens the Supabase dashboard for that project).
2. Supabase left sidebar → **Authentication** → under **Configuration** click **Sign In / Providers**.
3. Switch **Allow anonymous sign-ins** **on** → **Save** (if shown).
4. Make sure **Email** is enabled on the same page (default) — your admin login uses it.

## Step 4 — `CRON_SECRET`
1. Make a random secret: open the **Terminal** app on your Mac and run `openssl rand -hex 32`, then copy the 64-character output.
2. Vercel project → **Settings** → **Environment Variables** → add Key `CRON_SECRET`, Value = that string, type **Secret**, environments **Production** and **Preview** → **Save**.

## Step 5 — Redeploy (creates the database tables)
1. Vercel project → **Deployments** tab → on the newest deployment click **⋯** → **Redeploy**.
2. Optional check: open that deployment → **Build Logs**. You should see `[migrate] Applying 20261111000000_init…` and `[migrate] Applied 2 migration(s).`
3. In Supabase → left sidebar → **Table Editor**: tables like `players`, `questions`, `daily_challenges` now exist.

## Step 6 — Make yourself admin
1. Supabase → left sidebar → **Authentication** → **Users** → **Add user** → **Create new user**.
2. Enter your email and a strong password, tick **Auto Confirm User** → **Create user**.
3. Supabase → left sidebar → **SQL Editor** → **New query**, paste this (with your email) and click **Run**:
   ```sql
   insert into admins (auth_user_id, email, granted_by)
   select id, email, 'sql-editor' from auth.users
   where lower(email) = lower('you@example.com') and not coalesce(is_anonymous, false)
   on conflict (auth_user_id) do nothing;
   ```
   It should report `1 row` affected. (Terminal alternative: `DATABASE_URL='…' npm run admin:grant -- you@example.com`.)
4. Open `https://<your-site>/admin/login` and sign in. Your site's address is on the Vercel project's **Overview** tab under **Domains** (e.g. `closest-wins-game.vercel.app`).

## Step 7 — (Optional) AI question generation
1. https://console.anthropic.com → sign in.
2. **Settings** → **Billing** → add a small prepaid credit (e.g. $5).
3. **Settings** → **Limits** → set a low monthly spend limit (e.g. $5). This is a hard cap outside the app (the app also stops at its own $3/month estimate).
4. **Settings** → **API Keys** → **Create Key** → name it `closest-wins` → copy it (starts with `sk-ant-`; shown only once).
5. Vercel → **Settings** → **Environment Variables** → add `ANTHROPIC_API_KEY` (type **Secret**, Production) → then **Deployments** → **⋯** → **Redeploy**.
6. Check: `/admin/generate` no longer says "AI generation is unavailable". Leave `ANTHROPIC_MODEL` unset to use the cheapest model (`claude-haiku-5-5`).

## Step 8 — Check it works
1. Open the site on your phone → "Pick your player" appears → pick one.
2. Home says **"Today's challenge isn't ready yet"** — expected; production never uses the unverified demo questions.
3. In `/admin`: add questions (**Questions → Add manually**, or **Generate**), approve them, then **Schedule → Fill empty days**.

Every push to `main` on GitHub redeploys automatically from now on.

---

## Without the integration (manual alternative)
If you created the Supabase project directly at supabase.com instead, add these three variables yourself in Vercel → **Settings** → **Environment Variables**, then redeploy:
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Supabase project → **Connect** button (top of the page) → **App Frameworks** → **Next.js** → copy the two values (URL looks like `https://abcd….supabase.co`, key starts with `sb_publishable_`; store the key under `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` even if labelled anon).
- `DATABASE_URL`: **Connect** → connection string tab → **Transaction pooler** → copy, replace `[YOUR-PASSWORD]` with the database password you chose when creating the project (reset it at **Project Settings → Database → Reset database password**). Must contain `:6543`.

Never copy the **secret** key (`sb_secret_…`) or `service_role` key — this app doesn't use them.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Site says "Supabase is not configured" | The integration isn't connected to **Production**, or you didn't redeploy after connecting (Step 2.4, Step 5). |
| "Couldn't start a guest session" | Anonymous sign-ins are off (Step 3). |
| Build log: `[migrate]` error / `password authentication failed` | Reconnect the integration, or set `DATABASE_URL` manually (see above) and redeploy. |
| `POSTGRES_URL` uses port 5432 | Works, but for many simultaneous players add `DATABASE_URL` with the **Transaction pooler** string (port 6543) from Supabase → **Connect**. `DATABASE_URL` takes priority. |
| SQL in Step 6 affects 0 rows | The email doesn't match a user in Authentication → Users, or the user was created as anonymous. |
| Admin login fails | User not confirmed (tick Auto Confirm) or Step 6.3 not run. |
| Changed a variable but nothing changed | Variables apply to new deployments only — **Redeploy**. |
| Supabase project paused | Free projects pause after about a week without traffic — open the Supabase dashboard and click **Restore project**. |
| Cron job shows errors | `CRON_SECRET` missing (Step 4). The game still works without it — today's challenge is published when the first player arrives — but automation won't run. |
