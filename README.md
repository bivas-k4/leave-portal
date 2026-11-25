# Leave Portal

Employees sign in with their own password, apply for leave and track status. Managers get a dashboard, approvals, all-requests (with CSV export) and employee management.

**Stack:** static front end on GitHub Pages + Supabase (logins, database, security rules). No server to run.

## How the rules work
- Managers create accounts with a temporary password; the employee must set their own at first sign-in and can change it any time under *Account*.
- Employees see only their own requests. Managers see everyone's. This is enforced in the database (`supabase/schema.sql`), not just the UI.
- Working days are Mon–Fri. Overlapping requests are blocked. Employees can cancel only their own pending requests.
- Leave types and yearly allowances: edit `config.js`.

## Setup (about 20 minutes)

### 1. Create the Supabase project
1. Sign up at supabase.com, create a free project.
2. **SQL Editor** → paste all of `supabase/schema.sql` → Run.
3. **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users to sign up" (so only managers can create accounts).
4. **Authentication → Users → Add user** → create yourself (tick *Auto Confirm User*). Then in SQL Editor run:
   ```sql
   update public.profiles set role = 'manager' where email = 'you@company.com';
   ```

### 2. Deploy the admin function
Needed for "Add employee", "Reset password", "Deactivate".
```bash
npm i -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy create-employee
```
(Project ref is in Project Settings → General.)

### 3. Configure the front end
Edit `config.js`: set `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Project Settings → API). Use the **anon** key only, never `service_role`.

### 4. Publish on GitHub
1. Create a GitHub repo (private is fine on paid plans; Pages on free plans needs a public repo, which is OK because no secrets are in the code).
2. Push these files to the repo root.
3. Repo **Settings → Pages** → Source: *Deploy from a branch* → `main` / `(root)`.
4. Your portal appears at `https://<username>.github.io/<repo>/`.

Sign in as the manager, open **Employees**, add your team, and share each person's temporary password privately.

## Notes
- Forgot password: a manager resets it from *Employees*.
- Free Supabase projects pause after a week of inactivity; opening the dashboard resumes them.
- Public holidays and half-days are not modelled yet.
