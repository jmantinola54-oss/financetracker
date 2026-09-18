/**
 * auth.js — account creation/login for multi-user sync.
 * A "device token" is stored in localStorage once you're signed in, and
 * every sync request after that uses it to prove who you are.
 */
const Auth = {
  get token() { return localStorage.getItem('auth_token') || ''; },
  get userName() { return localStorage.getItem('auth_name') || ''; },
  get userId() { return localStorage.getItem('auth_user_id') || ''; },

  isSignedIn() { return !!Auth.token; },

  save(token, userId, name) {
    localStorage.setItem('auth_token', token);
    localStorage.setItem('auth_user_id', userId);
    localStorage.setItem('auth_name', name);
  },

  signOut() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user_id');
    localStorage.removeItem('auth_name');
  },

  async request(action, name, pin) {
    const res = await fetch(`${API.baseUrl}/auth.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, name, pin }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  },

  async register(name, pin) {
    const data = await Auth.request('register', name, pin);
    Auth.save(data.token, data.user_id, data.name);
    return data;
  },

  async login(name, pin) {
    const data = await Auth.request('login', name, pin);
    Auth.save(data.token, data.user_id, data.name);
    return data;
  },
};
