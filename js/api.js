/**
 * api.js — Talks to the PHP API on Hostinger.
 * The base URL is baked in below, so nobody using the app has to know or
 * type it. Auth is per-user (see auth.js) — nothing here is called unless
 * someone is signed in and online.
 */
const API = {
  // Your Hostinger API address. Everyone who uses this app shares this
  // same backend; their data stays separated by their account.
  baseUrl: 'https://evaluation.pwestora.com/finance-api',

  isConfigured() {
    return !!(API.baseUrl && Auth.isSignedIn());
  },

  async request(path, options = {}) {
    if (!Auth.isSignedIn()) throw new Error('Not signed in');
    const res = await fetch(`${API.baseUrl}/${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Auth.token}`,
        ...(options.headers || {}),
      },
    });
    if (res.status === 401) {
      Auth.signOut();
      throw new Error('Session expired — please sign in again');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`API ${path} failed: ${res.status} ${body}`);
    }
    return res.json();
  },

  // --- Transactions ---
  pullTransactions(sinceISO) {
    const q = sinceISO ? `?since=${encodeURIComponent(sinceISO)}` : '';
    return API.request(`transactions.php${q}`);
  },
  pushTransactions(records) {
    return API.request('transactions.php', {
      method: 'POST',
      body: JSON.stringify({ records }),
    });
  },

  // --- Categories ---
  pullCategories(sinceISO) {
    const q = sinceISO ? `?since=${encodeURIComponent(sinceISO)}` : '';
    return API.request(`categories.php${q}`);
  },
  pushCategories(records) {
    return API.request('categories.php', {
      method: 'POST',
      body: JSON.stringify({ records }),
    });
  },
};
