# Hand-test (dev database only)

Use this against the local app and the dev database: Neon branch `dev`, database `avanza_hrms_dev`. Do not run it against production (branch `main`, database `avanza_hrms`) or the test database (`avanza_hrms_test`).

Do not paste passwords, database URLs, `STORAGE_SIGNING_SECRET`, or signed download tokens into notes or chat.

App URL: [http://localhost:3000](http://localhost:3000). Sign in at `/login` with the **Password** form: **Work email**, **Development password** (the value of `AUTH_DEV_PASSWORD` in `.env`), then **Sign in with dev password**. Switch users from the top-bar account menu → **Sign out**. Admin sessions (Super Admin or HR Admin) idle out after 15 minutes.

Seeded users, after `npm run db:seed` and `npm run seed:handtest`. Addresses use `AUTH_ALLOWED_EMAIL_DOMAIN` (`avanza.example` in `.env.example`):

| Who | Sign-in | Roles before this test |
| --- | --- | --- |
| Bootstrap admin | `AUTH_BOOTSTRAP_ADMIN_EMAIL` (`admin@avanza.example` in `.env.example`) | Super Admin. No employee record. |
| Handtest Manager | `handtest.manager@…` (`HT-MGR`) | Manager. Nobody reports to the bootstrap admin. |
| Handtest Employee A | `handtest.employee.a@…` (`HT-A`) | Employee. Reports to `HT-MGR`. |
| Handtest Employee B | `handtest.employee.b@…` (`HT-B`) | Employee. No manager. |

Before the first document step, run `node scripts/assert-handtest-database.mjs`. It exits with no output when `.env` points at `avanza_hrms_dev`. If it refuses, stop. Do not copy a refusal that contains a host name.

## Documents

Categories on screen: Identity, Address, Education, Certificates, Employment, Payslips, Policies, Other HR.

### 1. Super Admin without HR Admin (do this first)

**Signed in as:** the bootstrap admin.

1. Open [http://localhost:3000/documents](http://localhost:3000/documents).
2. The address becomes `/forbidden`. The page title is **You don't have access**. The description is **Your role does not include this page. Ask a Super Admin if you need it.**
3. The sidebar HR section has People, Leave, and Attendance. It has no **Documents** item. `documents.manage` is HR Admin only.
4. Open **Settings** → **Users and roles** ([http://localhost:3000/settings/users](http://localhost:3000/settings/users)). On your own card the text is **Another Super Admin must change your roles or status.** There is no **Save roles** button on that card.

Leave this account as Super Admin only until section 2 finishes. Repeat the `/documents` check later as `handtest.super@…` (section 7), which stays a Super Admin without HR Admin.

### 2. Give the bootstrap admin the HR Admin role

A Super Admin cannot change their own roles. The audited path is a second Super Admin, through **Users and roles**. Do not update roles in SQL.

**Step A. Signed in as:** the bootstrap admin.

1. Stay on [http://localhost:3000/settings/users](http://localhost:3000/settings/users).
2. Under **Add user**, enter:
   - **Name:** `Handtest Super`
   - **Work email:** `handtest.super@` plus `AUTH_ALLOWED_EMAIL_DOMAIN`
   - **Roles:** check **Super Admin** only. Leave **HR Admin** and **Manager** unchecked. **Employee (every user)** stays checked and disabled.
   - **Reason:** `Hand-test second Super Admin so HR Admin can be granted`
3. Click **Create user**. The form shows **Saved.**

**Step B. Signed in as:** `handtest.super@…`.

1. **Sign out**, then sign in as that new user with the same development password.
2. Open [http://localhost:3000/settings/users](http://localhost:3000/settings/users). Your own card says another Super Admin must change your roles. The bootstrap admin's card has role checkboxes.
3. On the bootstrap admin's card, leave **Super Admin** checked, check **HR Admin**, leave **Manager** unchecked.
4. **Reason for role change:** `Hand-test documents: grant HR Admin on dev`
5. Click **Save roles**. The form shows **Saved.** The role line on that card becomes **Super Admin · HR Admin**.

**Step C. Signed in as:** the bootstrap admin.

1. **Sign out**, then sign in as the bootstrap admin.
2. The top bar reads **Super Admin · HR Admin**.
3. The sidebar HR section now includes **Documents**.

### 3. Employee A uploads an Identity document

Allowed files are PDF, PNG, and JPEG (`.jpg` or `.jpeg`), up to 4 MB. The server reads the file's first bytes. The extension and the browser's type have to match those bytes. The form hint is **PDF, PNG, or JPEG, up to 4 MB.**

**Signed in as:** Handtest Employee A.

1. Open **My Space → Documents** ([http://localhost:3000/my-space/documents](http://localhost:3000/my-space/documents)). Shelves: **Mine** and **From HR**.
2. Under **Upload**, set **Category** to **Identity** (the list is Identity, Address, Education, Certificates). **Title:** `Aadhaar card`. Leave **Description** empty.
3. **File:** a real PDF, PNG, or JPEG under 4 MB. Click **Upload**.
4. The form shows **Uploaded.** Under **Your files**, the card shows the title, `Identity · Version 1`, the file name and size, and **Uploaded by you**. There is a **Download** button. There is no **Who can see it** control on this form (that check is in section 7).

**Wrong type. Still signed in as Employee A.**

1. Copy any small `.exe`, rename the copy to `id-wrong.pdf`. The file picker filters by type; in the dialog choose **All files** so the renamed file is selectable.
2. **Title:** `Wrong type`. **Category:** Identity. Choose that file. Click **Upload**.
3. The form shows **Upload a PDF, PNG, or JPEG file.** Nothing new appears under **Your files**.

**Too big. Still signed in as Employee A.**

Use a PDF just over 4 MB and under 4.5 MB. A larger body can fail at the 4.5 MB request limit before this message. In PowerShell:

```powershell
$bytes = [byte[]]::new((4MB) + 1)
[Text.Encoding]::ASCII.GetBytes("%PDF-1.4").CopyTo($bytes, 0)
[IO.File]::WriteAllBytes("$env:TEMP\oversize.pdf", $bytes)
```

1. **Title:** `Too big`. **Category:** Identity. Choose `%TEMP%\oversize.pdf`. Click **Upload**.
2. The form shows **Files must be 4 MB or smaller.** Nothing new appears under **Your files**.

### 4. HR uploads an Identity document on Employee A's behalf

**Signed in as:** the bootstrap admin (now HR Admin).

1. Open **People**, open **Handtest Employee A**, and click **Documents**. That opens `/documents?employee=` plus A's id. Or open [http://localhost:3000/documents/new](http://localhost:3000/documents/new) directly.
2. Click **Upload** if you are on the list. On **Upload document**:
   - **Category:** under **On behalf of an employee**, choose **Identity**. The hint is **An employee category. You are uploading on the employee's behalf.**
   - **Title:** `PAN card`
   - **Employee:** `Handtest Employee A (HT-A)`
   - **Uploaded on behalf of:** `Paper copy collected at the Pune depot on 7 Oct.`
   - Leave **Who can see it** on **Category default (Employee and HR)**. Leave **Expiry date** empty. There is no **Requires acknowledgement** checkbox for an employee category.
   - **File:** a small PDF, PNG, or JPEG.
3. Click **Upload**. The browser goes to `/documents/{id}`. Copy that id for section 7. Do not copy any later download token.
4. The page header includes **Visible to employee and hr (category default)**. Under **Versions**, the uploaded line is the bootstrap admin's name plus **(HR, on behalf)**, and the note is under it.

**Signed in as:** Handtest Employee A.

1. Open [http://localhost:3000/my-space/documents](http://localhost:3000/my-space/documents) (**Mine**, not **From HR**).
2. The PAN card is on **Your files**, with **Uploaded by** the bootstrap admin's name **(HR)** and **Note from HR:** followed by the sentence you typed.
3. **Download** is present. **Remove** is absent (an employee can remove only a file they uploaded themselves). **Upload new version** is present.

### 5. Policy that requires acknowledgement

**Signed in as:** the bootstrap admin.

1. Open [http://localhost:3000/documents/new](http://localhost:3000/documents/new).
2. **Category:** **Policies** (under **HR documents**). **Title:** `Code of conduct`.
3. Under **Employees**, click **Select all active**. The count reads `{N} selected`. That is every Active employee on this dev database, including `HT-MGR`, `HT-A`, and `HT-B`. The bootstrap admin is not in the list (no employee record). Pre-joining and on-notice people are listed but not checked.
4. Check **Requires acknowledgement**. Leave **Who can see it** on the category default. **File:** a small PDF.
5. Click **Upload**. The browser opens `/documents/{id}`.
6. The heading is **Employees · {N} pending acknowledgement of version 1**. Each row's badge is **Pending**. The **Assign to {count} active employees missing this document** button is disabled and reads **Every active employee has this**.
7. Back on [http://localhost:3000/documents](http://localhost:3000/documents), the Acknowledgement cell is **{N} pending · 0 done**. Check **Pending acknowledgement only** and click **Apply**. The policy stays in the list.

**Signed in as:** Handtest Employee A.

1. Open [http://localhost:3000/my-space/documents?shelf=hr](http://localhost:3000/my-space/documents?shelf=hr).
2. The **From HR** tab shows a warning badge with the pending count. The card badge is **Pending acknowledgement**. The button is **I have read version 1**.
3. Click it. The form shows **Acknowledged.** The badge becomes **Acknowledged** plus the date and time. The pending badge on **From HR** drops by one.

**Signed in as:** the bootstrap admin.

1. Open the policy. Employee A's row is **Acknowledged** plus the time. Employee B and the manager still show **Pending**. The heading count is one lower. The list cell is **{N − 1} pending · 1 done**.
2. On the same page, under **Versions**, choose another small PDF and click **Upload new version**. The form shows **Version 2 uploaded.**
3. The heading is **Employees · {N} pending acknowledgement of version 2**. Employee A's row is **Pending** again. The Versions table shows version 2 as **current** with Acknowledged `0`, and version 1 with Acknowledged `1`.

**Signed in as:** Handtest Employee A.

1. Open **From HR** again. The badge is **Pending acknowledgement**. The button is **I have read version 2**. The card says **Version 2**.

### 6. Inbox

Open [http://localhost:3000/inbox](http://localhost:3000/inbox). Items are under **Notifications**. Each has **Open**. Opening Inbox marks them read, so the unread dot disappears on that visit; the title and body stay.

| Event | Who sees it | Title | Body | Open goes to |
| --- | --- | --- | --- | --- |
| Employee A uploads Identity (section 3) | Every HR Admin except the uploader. Here, the bootstrap admin. Not Employee A, and not `handtest.super`. | `New document from Handtest Employee A` | `Identity: Aadhaar card` | `/documents/{id}` |
| Employee A uploads a new version of their own file | Same HR Admins | `New version from Handtest Employee A` | `Identity: Aadhaar card (version 2)` | `/documents/{id}` |
| HR uploads on behalf (section 4) | Employee A | `HR uploaded a document for you` | `Identity: PAN card` | `/my-space/documents` |
| Policy upload with **Requires acknowledgement** (section 5) | Each selected employee. Not the bootstrap admin. | `Document to acknowledge` | `Policies: Code of conduct` | `/my-space/documents?shelf=hr` |
| Employee acknowledges | Nobody | No new notification | | |
| HR uploads version 2 of that policy | Each assignee | `Updated document to acknowledge` | `Policies: Code of conduct (version 2)` | `/my-space/documents?shelf=hr` |

There is no email for these events.

### 7. Must be blocked

Use the Identity document id from the HR address bar (`/documents/{id}`). A forbidden file URL and a missing id return the same JSON body.

**Employee B opens Employee A's document. Signed in as:** Handtest Employee B.

1. Open `http://localhost:3000/documents/{id}`. The page is `/forbidden`, title **You don't have access**.
2. Open `http://localhost:3000/api/documents/{id}/file`. The body is `{"error":"Not found"}`. Open `http://localhost:3000/api/documents/does-not-exist/file` and the body is the same.
3. **My Space → Documents**, both **Mine** and **From HR**, does not list A's Aadhaar card or PAN card.

**Manager opens a direct report's document. Signed in as:** Handtest Manager.

1. Repeat the two URLs above for A's document id. Same **You don't have access** page, and the same `{"error":"Not found"}` body.
2. **My Team** has no Documents link. **My Space → Documents** does not list A's files. The manager's own **From HR** shelf does list the Code of conduct policy, because that one was assigned to all active employees.

**Super Admin without HR Admin. Signed in as:** `handtest.super@…`.

1. Open [http://localhost:3000/documents](http://localhost:3000/documents). Result: `/forbidden`, **You don't have access**.
2. Open `http://localhost:3000/api/documents/{id}/file` for A's document. Body: `{"error":"Not found"}`.
3. The sidebar has no HR **Documents** item. On **People → Handtest Employee A** there is no **Documents** link.

**Employee sets an Identity document to employee-only. Signed in as:** Handtest Employee A.

1. On **Mine**, the upload form has **Category**, **Title**, **Description**, and **File**. It has no **Who can see it** field. Adding a `visibility` field in the browser does nothing: the employee upload action never reads it.
2. **Signed in as** the bootstrap admin, open A's Aadhaar card. The header still says **Visible to employee and hr (category default)**, and **Download** works. HR can still see the file. Only the HR **Details** form can change **Who can see it**; do not set **Employee only** during this check (that would hide the file from HR and write `DOCUMENT_UPDATED`).

**Signed link after 60 seconds. Signed in as:** Handtest Employee A.

1. On the Aadhaar card, click **Download**. In the network panel, the first response is a redirect to `/api/storage/local?token=…`. Copy that full URL. Do not paste the token into notes or chat.
2. Stay signed in. Wait 70 seconds. Open the copied URL.
3. The page text is **This link has expired. Open the document again.** The status is 410.
4. Click **Download** on the card again. A new link downloads the file. The expired URL still fails.

### 8. Audit log

**Signed in as:** the bootstrap admin (HR Admin can open the log; so can the Super Admin). Open [http://localhost:3000/settings/audit-log](http://localhost:3000/settings/audit-log). Set **Action**, leave **Entity type** as `Document` or `User` when you want to narrow it, and click **Apply**. **Actor** is the user id, not the name or email. Open **View** on a row for **Before** and **After**. The storage key does not appear. **After** for an upload includes `fileName`, `contentType`, `sizeBytes`, and `sha256`.

| What you did | Action | Where the detail is |
| --- | --- | --- |
| Created `handtest.super` | `USER_CREATED` | Entity type `User`. Reason is the text from **Add user**. |
| Granted HR Admin | `USER_ROLE_CHANGED` | Entity type `User`. **Reason** is the role-change text. **Before** roles are `SUPER_ADMIN` and `EMPLOYEE`. **After** roles are `SUPER_ADMIN`, `HR_ADMIN`, and `EMPLOYEE`. The actor id is `handtest.super`, not the bootstrap admin. |
| Employee A uploaded Aadhaar | `DOCUMENT_UPLOADED` | `categoryCode` `IDENTITY`, `visibility` `EMPLOYEE_AND_HR`. |
| Anyone downloaded Aadhaar (or PAN, or any category except Policies) | `DOCUMENT_VIEWED` | One row per **Download**, including HR. **After** has `categoryCode`, `versionNumber`, and `as` of `EMPLOYEE` or `HR`. Reusing the signed link does not add a row. |
| HR uploaded PAN on behalf | `DOCUMENT_UPLOADED` | **Reason** is `Paper copy collected at the Pune depot on 7 Oct.` **After** has `onBehalf` true. |
| Policy created with everyone selected | `DOCUMENT_UPLOADED` | `categoryCode` `POLICIES`, `requiresAcknowledgement` true, and `assigneeIds`. There is no `DOCUMENT_ASSIGNED` row for that first save. `DOCUMENT_ASSIGNED` is written only by **Assign selected** or **Assign to N active employees missing this document**. |
| Employee A clicked **I have read version 1**, then version 2 | `DOCUMENT_ACKNOWLEDGED` | Two rows. **After** `versionNumber` is 1, then 2. |
| HR uploaded policy version 2 | `DOCUMENT_VERSION_ADDED` | **Before** `versionNumber` 1. **After** `versionNumber` 2. |
| Anyone downloaded the policy | No `DOCUMENT_VIEWED` | Filter **Action** to `DOCUMENT_VIEWED` and **Entity id** to the policy id. No row. Acknowledgements are still `DOCUMENT_ACKNOWLEDGED`. |

`DOCUMENT_VIEWED` is written for every category marked sensitive: Identity, Address, Education, Certificates, Employment, Payslips, and Other HR. Policies is the one that is not.

### 9. Known limits

- Files stay on this machine. With `STORAGE_DRIVER` unset or `local`, they go to `.data/storage`, or to `STORAGE_LOCAL_DIR` if that is set. This pass does not use S3. `STORAGE_DRIVER=s3` needs the `S3_*` variables and is for deployment; the bucket provider is not chosen. Production refuses the local driver, and `/api/storage/local` answers 404 when `NODE_ENV` is production.
- Uploads are not scanned for malware.
- An **Expiry date** is stored and shown. Nothing sends an expiry reminder.
- Document events create Inbox rows only. They do not send email.
- A download is always an attachment. The signed link lasts 60 seconds. The storage key is not shown on the page, in the API response, or in the audit row.
- Versions and acknowledgements are append-only.
- The HR document list returns at most 500 rows.
- The bootstrap admin has no employee record, so they are not assigned the policy and are not asked to acknowledge it. HR rights also do not apply to an HR Admin's own employee record, except Policies. That needs a second HR Admin, and it does not come up for the bootstrap account.
