# Ledger — Offline-First Personal Finance Tracker

An installable web app (PWA) that works fully offline and syncs across
devices through a small PHP API on your Hostinger account, backed by MySQL.
Supports multiple people — each person gets their own account and only
ever sees their own entries.

## How it works

- **Frontend** (`index.html`, `css/`, `js/`, `manifest.json`, `service-worker.js`)
  — a static site. Deployed on **GitHub Pages**. Stores everything in the
  browser's IndexedDB, so it works with zero network connection. Installable
  via "Add to Home Screen". The API address is baked into `js/api.js`, so
  nobody using the app ever has to type a URL or key — they just make an
  account.
- **Backend** (`api/`) — a few PHP files. Deployed to your **Hostinger**
  hosting. Talks to a MySQL database you create in hPanel.
- **Accounts** — each person taps "Create account" once (a name + a PIN,
  no email needed) inside the app's Settings. That issues their device a
  private token, so their entries are tagged to them and nobody else can
  read or overwrite them, even though everyone shares the same database.
- **Sync** — whenever the device is online and someone is signed in, the
  app quietly pushes anything entered offline and pulls anything entered
  on that person's other devices. Nothing ever blocks the UI waiting on
  the network. Without an account, the app still works fully offline on
  that one device — it just won't sync anywhere.

## Part 1 — Create the database on Hostinger

1. Log into **hPanel** → **Databases** → **MySQL Databases**.
2. Create a new database and a new database user, and attach the user to
   the database with **All Privileges**. Note down the database name,
   username, and password — Hostinger prefixes them like `u123456789_ledger`.
3. Open **phpMyAdmin** (Databases → phpMyAdmin), select your new database,
   go to the **SQL** tab, and run the contents of `sql/schema.sql` (this
   creates the `users`, `device_tokens`, `categories`, and `transactions`
   tables). If you already had data from an earlier single-user version of
   this app, run `sql/migrate-to-multiuser.sql` instead — it upgrades your
   existing tables in place without deleting anything.

## Part 2 — Deploy the API to Hostinger

1. In hPanel, open **File Manager**, and go into `public_html`.
2. Create a folder, e.g. `finance-api`.
3. Upload everything inside this project's `api/` folder into it (using File
   Manager's upload button, or FTP with FileZilla).
4. Edit `api/config.php` (you can edit files directly in File Manager) and
   fill in:
   - `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS` — from Part 1.
   - `ALLOWED_ORIGIN` — your GitHub Pages URL, e.g.
     `https://yourusername.github.io`. You can leave it as `*` while
     testing, then lock it down once everything works.
5. Confirm your Hostinger domain has SSL/HTTPS enabled (hPanel → SSL) —
   it's on by default and required, since GitHub Pages is HTTPS and
   browsers block a HTTPS page from calling a plain HTTP API.
6. Test it by visiting `https://yourdomain.com/finance-api/ping.php` in a
   browser. You should see `{"ok":true,...}` — that means the server is
   running correctly.
7. Open `js/api.js` in this project and set `baseUrl` to your Hostinger API
   address (e.g. `https://yourdomain.com/finance-api`) before you deploy
   the frontend in Part 3 — this is what lets everyone skip typing it in.

## Part 3 — Deploy the frontend to GitHub Pages

1. Create a new GitHub repository, e.g. `ledger`.
2. Upload everything **except** the `api/` and `sql/` folders (those live
   on Hostinger, not GitHub) — so: `index.html`, `manifest.json`,
   `service-worker.js`, `css/`, `js/`, `icons/`.
3. Go to the repo's **Settings → Pages**.
4. Under **Source**, choose **Deploy from a branch**, pick `main` and
   `/ (root)`, then **Save**.
5. Wait a minute, then open the URL GitHub gives you, something like
   `https://yourusername.github.io/ledger/`.

## Part 4 — Create an account and sync

1. Open your GitHub Pages URL.
2. Tap the ⚙ icon (top-left) to open **Settings**.
3. Under **Account**, enter a name and a PIN (4+ digits), then tap
   **Create account**.
4. It should sync immediately and say so under the form.

That's it — no URL or key to type, because it's already baked into the app.
Anyone else you share the link with does the exact same thing with their
own name and PIN, and their entries stay completely separate from yours.

To use it on a second device (or let someone log back in after signing
out), open the same link and tap **Log in** with the same name and PIN
instead of **Create account**.

## Part 5 — Install it like a native app

- **Android (Chrome)**: open the site, tap the **⋮** menu →
  **Add to Home screen** (or Chrome will offer an install banner
  automatically).
- **iPhone (Safari)**: open the site, tap the **Share** icon →
  **Add to Home Screen**.
- **Desktop (Chrome/Edge)**: click the install icon (⊕) in the address bar.

Once installed, it opens full-screen with no browser bar, has its own icon,
and works with the phone in airplane mode — entries save locally and sync
the moment connectivity returns.

## Updating the app later

Any time you edit the frontend files and push to GitHub, GitHub Pages
redeploys automatically. Because of the service worker's cache, existing
installs may take one extra reload to pick up changes — that's expected
behavior for offline-capable apps, not a bug.

## Notes on the sync model

- Each entry gets a random ID on the device that created it, so two people
  adding entries offline at the same time never collide.
- If the same entry is edited on two of *your own* devices before either
  syncs, the one with the later `updated_at` timestamp wins. Different
  people's entries never merge with each other — the server only ever
  returns a user their own rows.
- Deletions are "soft" (a `deleted` flag) so a delete on one device
  correctly removes the entry everywhere once synced, rather than it
  reappearing.
- If several people ever use the *same physical device/browser*, signing
  in or out clears that device's local cache first, so the next signed-in
  person's data is pulled fresh rather than mixing with the previous
  person's. Each person should really install their own copy on their own
  phone though, for genuine privacy.
- PINs are stored as bcrypt hashes, never in plain text. There's no
  "forgot PIN" flow yet — if someone forgets theirs, you'd need to delete
  and recreate their row in the `users` table via phpMyAdmin.
