# Smoke test (about 30 minutes)

Use [http://localhost:3000](http://localhost:3000) and the dev database `avanza_hrms_dev` only. Do not use production (`avanza_hrms`) or the test database.

Sign in at `/login` under **Password**: **Work email**, then the development password from `AUTH_DEV_PASSWORD` in `.env`. Do not write that password down. Switch users from the account menu → **Sign out**. A Super Admin or HR Admin session signs you out after 15 minutes idle.

Run `npm run db:seed`, then `npm run seed:handtest`. Then run `node scripts/assert-handtest-database.mjs`. It should print nothing. If it prints anything, stop, and do not copy a host name.

Addresses use `AUTH_ALLOWED_EMAIL_DOMAIN` (`avanza.example` in `.env.example`). Handtest Employee A is `handtest.employee.a@…` (`HT-A`), Handtest Employee B is `handtest.employee.b@…` (`HT-B`), and Handtest Manager is `handtest.manager@…` (`HT-MGR`). The bootstrap admin is `AUTH_BOOTSTRAP_ADMIN_EMAIL`.

## 1. Sign in and roles

A Super Admin cannot change their own roles. Do not change roles in the database.

- [ ] Sign in as Handtest Employee A. The top bar says **Employee**. The menu has **Home**, **Inbox**, **My Space** (Profile, Attendance, Leave, Documents, Holidays), and **Directory**, and it has no **My Team**, no **HR** section, no **Reports**, and no **Settings**.
- [ ] Sign out, then sign in as Handtest Manager. The top bar says **Manager**. The menu also has **My Team** and **Reports**, and it still has no **HR** section and no **Settings**.
- [ ] Sign out, sign in as the bootstrap admin, open **Settings**, and click **Open users**. Under **Add user**, set Name `Handtest Super`, Work email `handtest.super@` plus your email domain, check **Super Admin** only, Reason `Smoke test second Super Admin`, and click **Create user**. You see **Saved.**
- [ ] Sign out, sign in as `handtest.super@…`, open **Settings** → **Open users**, and on the bootstrap admin’s card check **HR Admin** (leave **Super Admin** checked). Reason `Smoke test: grant HR Admin on dev`, then **Save roles**. You see **Saved.** and the role line **Super Admin · HR Admin**.
- [ ] Sign out and sign in as the bootstrap admin. The top bar says **Super Admin · HR Admin**. **HR** now has **People**, **Leave**, **Attendance**, and **Documents**, and **Reports** and **Settings** are still there.

## 2. Leave

Casual and Earned are blocked during probation (these people joined about 30 days ago). Use **Unpaid (LOP)** on a Monday to Friday. Saturday and Sunday do not count.

- [ ] As Employee A, open **My Space → Leave**, note the **Unpaid (LOP)** number, and under **Apply** set Leave type **Unpaid (LOP)**, From and To the same future weekday, Day portion **Full day**, type a Reason, and click **Submit request**. You see **Request submitted.**, History shows **Pending**, Working days is 1, and Unpaid (LOP) is 1 lower.
- [ ] Sign in as the Manager, open **Inbox**, and under **Pending approvals** find Handtest Employee A’s leave. Click **Approve**. That card leaves the list.
- [ ] Sign in as Employee A and open **My Space → Leave**. History shows **Approved**, and Unpaid (LOP) stays at the lower number.
- [ ] Still as Employee A, submit a second Unpaid (LOP) request for a different future weekday. History shows another **Pending**, and Unpaid (LOP) drops by 1 again.
- [ ] Sign in as the Manager, open **Inbox**, type a Comment on that second request, and click **Reject**. The card leaves the list. A blank comment shows **A rejection needs a comment.**
- [ ] Sign in as Employee A. History shows **Rejected** and **Comment:** with your text, and Unpaid (LOP) is back up by 1.

## 3. Attendance

Check-in uses the server clock. A correction is **Regularize**, and it only shows on a past weekday marked **Absent**, within the last 7 days. If no day says **Absent**, run this only after the database check above printed nothing:

```powershell
5..1 | ForEach-Object { node scripts/assert-handtest-database.mjs npm run jobs:attendance-daily -- --date (Get-Date).AddDays(-$_).ToString("yyyy-MM-dd") }
```

- [ ] As Employee A, on **Home**, set **Working from** to **Office** and click **Check in**. The badge says **Checked in**, and you see **In**, a time, and **Office**.
- [ ] On the same card, click **Check out**. You see **Out** and a time, and the badge says **Not checked in**.
- [ ] Open **My Space → Attendance** and click a recent weekday marked **Absent** (not today). Under **Regularize**, set Check-in `09:30`, Check-out `18:30`, type a Reason, and click **Submit regularization**. You see **Sent for approval. The day updates once it is approved.**
- [ ] Sign in as the Manager, open **Inbox**, find **Attendance regularization** for that date, and click **Approve**. The card leaves **Pending approvals**.
- [ ] Sign in as Employee A and open that same day. It shows **Regularized**.

## 4. Documents

On the HR document page, keep the `/documents/…` address of the Aadhaar card. Do not copy a download link.

- [ ] As Employee A, open **My Space → Documents** (**Mine**). Under **Upload**, set Category **Identity**, Title `Aadhaar card`, choose a small PDF, PNG, or JPEG, and click **Upload**. You see **Uploaded.** and, under **Your files**, **Identity · Version 1**.
- [ ] Sign in as the bootstrap admin. Open **Documents** under **HR**, click **Upload**, set Category **Policies**, Title `Code of conduct`, search `HT-A`, tick only **Handtest Employee A**, check **Requires acknowledgement**, choose a small PDF, and click **Upload**. The heading includes **pending acknowledgement of version 1**.
- [ ] Sign in as Employee A, open **My Space → Documents**, and open **From HR**. The card says **Pending acknowledgement**. Click **I have read version 1**. You see **Acknowledged.**
- [ ] Sign in as the bootstrap admin and open that policy. Employee A’s row says **Acknowledged**.

## 5. Dashboards and reports

- [ ] As Employee A, open **Home**. You see the punch card, **Leave balances**, **Your requests**, **Upcoming holidays**, and **Documents to acknowledge**. You do not see **Your team** or **People and attendance**.
- [ ] As the Manager, open **Home**. You also see **Your team** (**Pending approvals**, **Who is out**, **Team attendance today**, **Missing punches**), and the only teammate named is Handtest Employee A. You do not see **People and attendance**.
- [ ] As the bootstrap admin, open **Home**. You see **People and attendance** (**Headcount**, **Joiners and exits this month**, **Today's attendance**, **Pending HR actions**). The punch card says **Check-in needs an active employee record with a current job.** You do not see **Your team**.
- [ ] As the Manager, open **Reports** and click **View** for **Headcount**, **Daily attendance**, **Monthly attendance**, and **Leave balances**. **Daily attendance** and **Leave balances** list Handtest Employee A (`HT-A`) and do not list Handtest Employee B. **Headcount** for Hand-test Operations shows Active **1**.
- [ ] As the bootstrap admin, open **Reports** and **View** the same four. **Daily attendance** and **Leave balances** list both Handtest Employee A and Handtest Employee B, and Hand-test Operations shows Active **3** (or more, if other people were added to that department).

## 6. Audit log

**Actor** is a user id, not a name. Open **View** on a row for **Before** and **After**.

- [ ] As the bootstrap admin, open **Settings** and click **Open audit log**. Set **Action** to `LEAVE_REQUESTED` and click **Apply**: two rows. Then `LEAVE_APPROVED` and `LEAVE_REJECTED`: one row each. **View** on the rejection shows your comment as **Reason**.
- [ ] Filter `ATTENDANCE_CHECKED_IN`, then `ATTENDANCE_CHECKED_OUT`, then `ATTENDANCE_REGULARIZATION_REQUESTED`, then `ATTENDANCE_REGULARIZATION_APPROVED`. Each one has a row for what you just did.
- [ ] Filter `DOCUMENT_UPLOADED`: one row for the Identity file and one for the policy. Filter `DOCUMENT_ACKNOWLEDGED`: one row, and **After** includes version 1.
- [ ] Filter `USER_ROLE_CHANGED`. **Reason** is the HR Admin text you typed, and **After** includes `HR_ADMIN`.

## Must be blocked

Copy Employee B’s `/people/…` address while you are the bootstrap admin on **People**. The id at the end is the one you paste after `/my-team/`.

- [ ] As Employee B, open the Aadhaar `/documents/…` address. The page is **You don't have access**.
- [ ] As Employee A, open Employee B’s `/people/…` address. The page is **You don't have access**.
- [ ] As Employee A, open `/settings`. The page is **You don't have access**.
- [ ] As the Manager, open `/my-team/` plus Employee B’s id. The page is **You don't have access**. **My Team** still opens Handtest Employee A.
- [ ] As the Manager, open `/attendance`. The page is **You don't have access**.

## On a phone

Use Safari on an iPhone or Chrome on Android.

- [ ] Open `/login`. You see **Sign in**, **Password**, **Work email**, **Development password**, and **Sign in with dev password**, and the page does not scroll sideways.
- [ ] Sign in as Employee A. On **Home**, tap **Check in** (or **Check out** if you are already checked in). The badge changes.
- [ ] Tap **Open navigation**, then **Leave**. **Apply** shows **Leave type**, **From**, **To**, and **Submit request**, and you can type in the fields.
- [ ] Tap **Open navigation**, then **Attendance**, then a day (scroll the grid sideways if you need to). A panel opens with that date as the title. **Open navigation** lists **Home**.

## Report a bug

Do not include passwords, database addresses, or download links.

```
Step:
User:
What you saw:
```
