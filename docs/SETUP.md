# Setup guide: Supabase + Vercel + (optional) Anthropic

Follow these steps in order. Each value says exactly where to click and what it looks like, so you can check you copied the right thing.

Keep a private note open (a password manager or a text file outside this project) and paste each value into it as you go. **Never commit these values to GitHub.**

At the end you will have these values:

| Variable | Where it comes from | Required? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase (Step 1.4) | Yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase (Step 1.4) | Yes |
| `DATABASE_URL` | Supabase (Step 1.5) | Yes |
| `CRON_SECRET` | You generate it (Step 2) | Yes |
| `NEXT_PUBLIC_APP_URL` | Vercel, after the first deploy (Step 4.6) | Yes (for share links) |
| `ANTHROPIC_API_KEY` | Anthropic Console (Step 6) | Only for AI question generation |
| `ANTHROPIC_MODEL` | Leave unset (defaults to `claude-haiku-5-5`) | No |
| `NEXT_PUBLIC_GAME_TITLE` | Leave unset (defaults to "Closest Wins") | No |
| `NEXT_PUBLIC_GAME_LAUNCH_DATE` | Leave unset, or set the date of challenge #1, e.g. `2026-11-15` | No |

Do **not** add `LOCAL_ADMIN_PASSWORD`, `LOCAL_SESSION_SECRET`, `LOCAL_DB_DIR` or `ALLOW_DEMO_CONTENT` on Vercel. Those are for running on your own computer only.

---

## Step 1 — Supabase

### 1.1 Create the project
1. Go to https://supabase.com/dashboard and sign in (you can choose **Continue with GitHub**).
2. Click **New project**.
3. Choose your organization, then fill in:
   - **Project name:** e.g. `closest-wins`
   - **Database password:** click **Generate a password**, then **copy it into your private note now**. It's needed for `DATABASE_URL` in Step 1.5, and Supabase won't show it again. (You can reset it later: left sidebar → **Project Settings** (gear icon) → **Database** → **Reset database password**.)
   - **Region:** pick one close to you, e.g. East US.
4. Click **Create new project** and wait a minute or two until the dashboard finishes setting up.

### 1.2 Turn on anonymous sign-ins (how players get a guest account)
1. Left sidebar → **Authentication**.
2. Under **Configuration**, click **Sign In / Providers**. (Direct link: `https://supabase.com/dashboard/project/<your-project-ref>/auth/providers`.)
3. Find **Allow anonymous sign-ins** and switch it **on**. Click **Save** if a save button appears.
4. On the same page make sure **Email** is enabled (it is by default). Your admin login uses it.

### 1.3 Find your project reference
Your project reference is the random ID in the dashboard's address bar:
`https://supabase.com/dashboard/project/`**`abcdefghijklmnop`**`/...`
You'll see it inside the URLs below.

### 1.4 `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
1. On your project's home page, click the **Connect** button at the top of the page.
2. In the dialog, open the **App Frameworks** tab and choose **Next.js**.
3. It shows two lines. Copy the value after the `=` on each:
   - `NEXT_PUBLIC_SUPABASE_URL` → looks like `https://abcdefghijklmnop.supabase.co`
   - The key line (it may be labelled `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `..._ANON_KEY`) → looks like `sb_publishable_…`

   Store the key as **`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`** whatever the dialog calls it.

Alternative: left sidebar → **Project Settings** → **API Keys** shows the **publishable** key. Copy the key that starts with `sb_publishable_`.

⚠️ Do **not** copy the **secret** key (starts with `sb_secret_`) or the legacy `service_role` key. This app doesn't need either, and they must never be in the browser.

### 1.5 `DATABASE_URL` (the database connection string)
1. Click the **Connect** button at the top of the project page again.
2. Open the connection-string tab (named **Connection String** or **Direct**) and choose **Transaction pooler**. This is the one for Vercel; it uses port **6543**.
3. Copy the string. It looks like:
   ```
   postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```
4. Replace `[YOUR-PASSWORD]` (including the brackets) with the database password from Step 1.1.
   - If the password contains any of `@ : / ? # & %` or a space, it has to be URL-encoded first. The simplest fix is to reset the password (Project Settings → Database → Reset database password) to one with only letters and numbers.
5. Check it: it should start with `postgresql://postgres.` and contain `:6543/postgres`.

### 1.6 Create the database tables
Choose **one** of these options.

**Option A: from your Mac (recommended)**
1. Open the **Terminal** app.
2. Run (paste your real `DATABASE_URL` between the single quotes):
   ```bash
   cd ~/Documents/Projects/closest-wins-game
   DATABASE_URL='postgresql://postgres.abc...:yourpassword@aws-0-....pooler.supabase.com:6543/postgres' npm run db:migrate
   ```
3. Expected output: `Applying 20261111000000_init…`, `Applying 20261112000000_lower_cost_defaults…`, `Applied 2 migration(s).`

**Option B: in the browser**
1. Left sidebar → **SQL Editor** → **New query**.
2. Open `supabase/migrations/20261111000000_init.sql` from this project, copy the entire file, paste it into the editor, then click **Run**.
3. Click **New query** again and do the same with `supabase/migrations/20261112000000_lower_cost_defaults.sql`.

Check: left sidebar → **Table Editor** should list tables such as `players`, `questions` and `daily_challenges`.

---

## Step 2 — `CRON_SECRET`
This is a password you make up. Vercel uses it to call the nightly job.

In the **Terminal** app run:
```bash
openssl rand -hex 32
```
Copy the 64-character output into your note as `CRON_SECRET`.

---

## Step 3 — Create your admin user
1. Supabase left sidebar → **Authentication** → **Users**.
2. Click **Add user** → **Create new user**.
3. Enter your email and a strong password, tick **Auto Confirm User**, then click **Create user**.
4. In **Terminal**:
   ```bash
   cd ~/Documents/Projects/closest-wins-game
   DATABASE_URL='<same DATABASE_URL as above>' npm run admin:grant -- you@example.com
   ```
   Expected output: `you@example.com is now an administrator.`

---

## Step 4 — Vercel

### 4.1 Import the repository
1. Go to https://vercel.com and sign in with **Continue with GitHub**.
2. Click **Add New…** (top right) → **Project**.
3. Under **Import Git Repository**, find `closest-wins-game` and click **Import**.
   - If it isn't listed, click **Adjust GitHub App Permissions** (or **Configure GitHub App**), grant Vercel access to `nben24/closest-wins-game`, and come back.
4. Leave **Framework Preset** as **Next.js** and leave the build settings at their defaults.

### 4.2 Add the variables before the first deploy
On the same import screen, expand **Environment Variables** and add these one at a time (Key on the left, Value on the right):

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | from Step 1.4 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | from Step 1.4 |
| `DATABASE_URL` | from Step 1.5 (with your password filled in) |
| `CRON_SECRET` | from Step 2 |

Tip: you can paste several `KEY=value` lines at once into the **Key** field and Vercel splits them into separate variables.

### 4.3 Deploy
Click **Deploy** and wait about 2 minutes for **Congratulations!**

### 4.4 If you skipped 4.2, or need to change a variable later
1. Open the project in Vercel → **Settings** tab (top) → **Environment Variables** (left).
2. Add or edit the variable. Tick **Production** and **Preview**.
3. Variables only apply to **new** deployments. Go to the **Deployments** tab, click the **⋯** menu on the newest deployment → **Redeploy**.

### 4.5 Mark the secrets as Secret
When adding `DATABASE_URL`, `CRON_SECRET` and `ANTHROPIC_API_KEY`, choose type **Secret** (write-only). The `NEXT_PUBLIC_…` values can stay **Config**; they're visible in the browser by design.

### 4.6 `NEXT_PUBLIC_APP_URL`
1. In the Vercel project, open the **Overview** tab. Under **Domains** you'll see something like `closest-wins-game.vercel.app` (or your own domain if you add one under **Settings** → **Domains**).
2. Add the variable `NEXT_PUBLIC_APP_URL` = `https://closest-wins-game.vercel.app` (your real domain, with `https://`, no trailing slash).
3. Redeploy (see 4.4).

### 4.7 Check the nightly job
Vercel project → **Settings** → **Cron Jobs**. You should see `/api/cron/daily` scheduled for `15 5 * * *` (00:15 New York time in winter, 01:15 in summer). It comes from `vercel.json` automatically.

---

## Step 5 — Check it works
1. Open your site on your phone. You should see the "Pick your player" screen.
2. Pick a player. The home screen will say **"Today's challenge isn't ready yet"**. That's expected: production never uses the unverified demo questions.
3. Go to `https://<your-domain>/admin/login` and sign in with the email and password from Step 3.
4. Add questions (Admin → **Questions** → **Add manually**, or **Generate** once Step 6 is done), approve them, then Admin → **Schedule** → **Fill empty days**.

---

## Step 6 — Anthropic API key (optional; only needed for AI-generated questions)
1. Go to https://console.anthropic.com and sign in.
2. **Billing:** go to **Settings** → **Billing** and buy a small amount of prepaid credit (e.g. $5).
3. **Hard spend cap (recommended):** go to **Settings** → **Limits** and set a low monthly spend limit (e.g. $5). This is a cap outside the app, on top of the app's own $3/month cap.
4. **Create the key:** **Settings** → **API Keys** → **Create Key**, name it `closest-wins-vercel`, then copy it straight away (it starts with `sk-ant-`; it's only shown once).
5. In Vercel → **Settings** → **Environment Variables**, add `ANTHROPIC_API_KEY` = that key (type **Secret**), tick Production (and Preview if you like), then redeploy.
6. Check: Admin → **Generate** no longer shows "AI generation is unavailable".

Leave `ANTHROPIC_MODEL` unset to use `claude-haiku-5-5`, the cheapest option (about $2–4/month for a full month of questions).

---

## Running locally against your real Supabase (optional)
Create `.env.local` in the project folder (it's git-ignored) containing the same `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `DATABASE_URL`, then run `npm run dev`. Delete those three lines to go back to the offline demo mode.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Deployment page says "Supabase is not configured" | One of the three Supabase variables is missing or misspelled. Fix it in Vercel → Settings → Environment Variables, then redeploy. |
| "Couldn't start a guest session" on the phone | Anonymous sign-ins are off (Step 1.2). |
| `password authentication failed` | The `DATABASE_URL` password is wrong or contains special characters (Step 1.5, item 4). |
| `Tenant or user not found` | You used the plain `postgres` user. The pooler user is `postgres.<project-ref>`; copy the whole string from **Connect**. |
| Admin login says it failed | Check the user exists and is confirmed (Authentication → Users), then rerun Step 3.4. |
| Changed a variable but nothing changed | Redeploy (Step 4.4). |
| Supabase project paused | Free projects pause after about a week with no traffic. Open the Supabase dashboard and click **Restore project**. |
