# Ledger — Offline-First Personal Finance Tracker

An installable web app (PWA) that works fully offline and syncs across
devices through a small PHP API on your Hostinger account, backed by MySQL.

## How it works

- **Frontend** (`index.html`, `css/`, `js/`, `manifest.json`, `service-worker.js`)
  — a static site. Deployed on **GitHub Pages**. Stores everything in the
  browser's IndexedDB, so it works with zero network connection. Installable
  via "Add to Home Screen".
- **Backend** (`api/`) — a few PHP files. Deployed to your **Hostinger**
  hosting. Talks to a MySQL database you create in hPanel.
- **Sync** — whenever the device is online, the app quietly pushes anything
  you entered offline and pulls anything entered on other devices. Nothing
  ever blocks the UI waiting on the network.

You can also skip the backend entirely and use the app 100% offline on one
device — just leave the Settings screen blank.

## Part 1 — Create the database on Hostinger

1. Log into **hPanel** → **Databases** → **MySQL Databases**.
2. Create a new database and a new database user, and attach the user to
   the database with **All Privileges**. Note down the database name,
   username, and password — Hostinger prefixes them like `u123456789_ledger`.
3. Open **phpMyAdmin** (Databases → phpMyAdmin), select your new database,
   go to the **SQL** tab, and run the contents of `sql/schema.sql`.

## Part 2 — Deploy the API to Hostinger

1. In hPanel, open **File Manager**, and go into `public_html`.
2. Create a folder, e.g. `finance-api`.
3. Upload everything inside this project's `api/` folder into it (using File
   Manager's upload button, or FTP with FileZilla).
4. Edit `api/config.php` (you can edit files directly in File Manager) and
   fill in:
   - `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS` — from Part 1.
   - `API_KEY` — make up a long random string. This is the password your
     app uses to talk to the API. Keep it secret.
   - `ALLOWED_ORIGIN` — your GitHub Pages URL, e.g.
     `https://yourusername.github.io`. You can leave it as `*` while
     testing, then lock it down once everything works.
5. Confirm your Hostinger domain has SSL/HTTPS enabled (hPanel → SSL) —
   it's on by default and required, since GitHub Pages is HTTPS and
   browsers block a HTTPS page from calling a plain HTTP API.
6. Test it by visiting `https://yourdomain.com/finance-api/ping.php` in a
   browser. You should see an "Invalid or missing API key" JSON error —
   that's correct, it means the server is running (it just needs the key,
   which only the app sends).

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

## Part 4 — Connect the app to your database

1. Open your GitHub Pages URL.
2. Tap the ⚙ icon (top-left) to open **Settings**.
3. Enter:
   - **API base URL**: `https://yourdomain.com/finance-api`
   - **API key**: the same string you put in `config.php`
4. Tap **Save & sync now**. It should say "Synced successfully."

Repeat Part 4 on any other device (phone, laptop) pointing at the same API
to keep them in sync.

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
- If the same entry is edited on two devices before either syncs, the one
  with the later `updated_at` timestamp wins.
- Deletions are "soft" (a `deleted` flag) so a delete on one device
  correctly removes the entry everywhere once synced, rather than it
  reappearing.
