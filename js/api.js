/**
 * api.js — Talks to the PHP API on Hostinger.
 * Nothing in here is called unless the app is online; sync.js decides that.
 */
const API = {
  // Set this after you deploy the api/ folder to Hostinger, e.g.
  // 'https://yourdomain.com/finance-api'
  baseUrl: (localStorage.getItem('api_base_url') || '').replace(/\/$/, ''),
  apiKey: localStorage.getItem('api_key') || '',

  isConfigured() {
    return !!(API.baseUrl && API.apiKey);
  },

  setConfig(baseUrl, apiKey) {
    API.baseUrl = baseUrl.replace(/\/$/, '');
    API.apiKey = apiKey;
    localStorage.setItem('api_base_url', API.baseUrl);
    localStorage.setItem('api_key', apiKey);
  },

  async request(path, options = {}) {
    if (!API.isConfigured()) throw new Error('API not configured');
    const res = await fetch(`${API.baseUrl}/${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API.apiKey,
        ...(options.headers || {}),
      },
    });
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

  ping() {
    return API.request('ping.php');
  },
};
