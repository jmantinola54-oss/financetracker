/**
 * app.js — UI state and rendering. Reads/writes go through Store (db.js).
 */
const DEFAULT_CATEGORIES = [
  { name: 'Allowance', type: 'income' },
  { name: 'Salary', type: 'income' },
  { name: 'Freelance', type: 'income' },
  { name: 'Food', type: 'expense' },
  { name: 'Transport', type: 'expense' },
  { name: 'Bills', type: 'expense' },
  { name: 'Rent', type: 'expense' },
  { name: 'School supplies', type: 'expense' },
  { name: 'Shopping', type: 'expense' },
  { name: 'Other', type: 'expense' },
];

const BREAKDOWN_LIMIT = 5; // top N categories shown before folding the rest into "Other"

let state = {
  view: 'dashboard', // 'dashboard' | 'history' | 'settings'
  cursorMonth: new Date(), // month currently browsed in History
  transactions: [],
  categories: [],
  editingId: null,
  activeType: 'expense',
  budget: 0,
};

const peso = (n) =>
  '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (d) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

async function init() {
  await openDB();
  bindEvents();
  registerServiceWorker();
  Sync.onStatusChange(updateSyncDot);

  const guestMode = localStorage.getItem('guest_mode') === '1';

  if (Auth.isSignedIn() || guestMode) {
    await enterApp();
  } else {
    showAuthGate();
  }
}

async function enterApp() {
  document.getElementById('authGate').hidden = true;
  document.getElementById('app').hidden = false;

  await seedCategoriesIfEmpty();
  await loadAll();
  state.budget = Number((await Store.getMeta('monthly_budget')) || 0);

  // Always land on the Dashboard right after signing in.
  switchView('dashboard');

  if (navigator.onLine && Auth.isSignedIn()) Sync.run();
}

function showAuthGate() {
  document.getElementById('app').hidden = true;
  document.getElementById('authGate').hidden = false;
  document.getElementById('authName').value = '';
  document.getElementById('authPin').value = '';
  document.getElementById('authStatus').textContent = '';
}

async function seedCategoriesIfEmpty() {
  const existing = await Store.getAll('categories');
  if (existing.length) return;
  const records = DEFAULT_CATEGORIES.map((c) => ({
    id: uuid(),
    name: c.name,
    type: c.type,
    created_at: nowISO(),
    updated_at: nowISO(),
    synced: 0,
    deleted: 0,
  }));
  await Store.bulkPut('categories', records);
}

async function loadAll() {
  const [txns, cats] = await Promise.all([Store.getAll('transactions'), Store.getAll('categories')]);
  state.transactions = txns.filter((t) => !t.deleted);
  state.categories = dedupeCategories(cats.filter((c) => !c.deleted));
}

// Safety net: if the same category name+type ever ends up duplicated
// locally (e.g. a stray sync from before this was fixed server-side),
// only show the earliest one so the list always looks clean.
function dedupeCategories(cats) {
  const seen = new Map();
  for (const c of cats) {
    const key = `${c.type}:${c.name.trim().toLowerCase()}`;
    const existing = seen.get(key);
    if (!existing || c.created_at < existing.created_at) {
      seen.set(key, c);
    }
  }
  return [...seen.values()];
}

// ===== View routing =====
const VIEW_TITLES = { dashboard: 'Dashboard', history: 'History', settings: 'Settings' };

function switchView(view) {
  state.view = view;
  ['dashboard', 'history', 'settings'].forEach((v) => {
    document.getElementById(`view-${v}`).hidden = v !== view;
  });
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  document.getElementById('topbarTitle').textContent = VIEW_TITLES[view];
  document.getElementById('addBtn').hidden = view === 'settings';

  if (view === 'dashboard') renderDashboard();
  else if (view === 'history') renderHistory();
  else if (view === 'settings') renderSettingsView();
}

// ===== Dashboard =====
function monthTxnsFor(date) {
  const key = monthKey(date);
  return state.transactions
    .filter((t) => t.txn_date.startsWith(key))
    .sort((a, b) => b.txn_date.localeCompare(a.txn_date) || b.created_at.localeCompare(a.created_at));
}

function renderDashboard() {
  const now = new Date();
  const monthTxns = monthTxnsFor(now);
  const income = monthTxns.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const expense = monthTxns.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);

  document.getElementById('heroGreeting').textContent = Auth.isSignedIn()
    ? `Hi, ${Auth.userName}`
    : 'Hi there';
  document.getElementById('dashMonthLabel').textContent = `${monthLabel(now)} balance`;
  document.getElementById('balanceFigure').textContent = peso(income - expense);
  document.getElementById('incomeTotal').textContent = peso(income);
  document.getElementById('expenseTotal').textContent = peso(expense);

  renderBudgetCard(expense);
  renderCategoryBreakdown(monthTxns);
  renderRecentActivity();

  // Keep the entry sheet's category dropdown fresh too.
  renderCategorySelect();
}

function renderBudgetCard(expense) {
  const prompt = document.getElementById('budgetSetPrompt');
  const wrap = document.getElementById('budgetProgressWrap');
  const fill = document.getElementById('budgetProgressFill');
  const caption = document.getElementById('budgetCaption');

  if (!state.budget || state.budget <= 0) {
    prompt.hidden = false;
    wrap.hidden = true;
    return;
  }

  prompt.hidden = true;
  wrap.hidden = false;

  const ratio = expense / state.budget;
  const pct = Math.min(ratio, 1) * 100;
  fill.style.width = `${pct}%`;
  fill.classList.toggle('warn', ratio >= 0.75 && ratio < 1);
  fill.classList.toggle('over', ratio >= 1);

  if (ratio >= 1) {
    caption.textContent = `${peso(expense - state.budget)} over your ${peso(state.budget)} budget`;
  } else {
    caption.textContent = `${peso(state.budget - expense)} left of ${peso(state.budget)}`;
  }
}

function renderCategoryBreakdown(monthTxns) {
  const container = document.getElementById('categoryBreakdown');
  const empty = document.getElementById('breakdownEmpty');
  const expenseTxns = monthTxns.filter((t) => t.type === 'expense');

  if (!expenseTxns.length) {
    container.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const sums = new Map();
  expenseTxns.forEach((t) => {
    const cat = state.categories.find((c) => c.id === t.category_id);
    const name = cat ? cat.name : 'Uncategorized';
    sums.set(name, (sums.get(name) || 0) + Number(t.amount));
  });

  let rows = [...sums.entries()].sort((a, b) => b[1] - a[1]);
  if (rows.length > BREAKDOWN_LIMIT) {
    const kept = rows.slice(0, BREAKDOWN_LIMIT);
    const rest = rows.slice(BREAKDOWN_LIMIT).reduce((s, [, amt]) => s + amt, 0);
    rows = [...kept, ['Other', rest]];
  }

  const total = expenseTxns.reduce((s, t) => s + Number(t.amount), 0);
  container.innerHTML = rows
    .map(([name, amt]) => {
      const pct = total ? (amt / total) * 100 : 0;
      return `
        <div class="breakdown-row">
          <div class="breakdown-labels">
            <span class="breakdown-name">${escapeHTML(name)}</span>
            <span class="breakdown-amount">${peso(amt)}</span>
          </div>
          <div class="breakdown-track"><div class="breakdown-fill" style="width:${pct}%"></div></div>
        </div>`;
    })
    .join('');
}

function renderRecentActivity() {
  const list = document.getElementById('recentList');
  const empty = document.getElementById('recentEmpty');
  const recent = [...state.transactions]
    .sort((a, b) => b.txn_date.localeCompare(a.txn_date) || b.created_at.localeCompare(a.created_at))
    .slice(0, 5);

  if (!recent.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = '';
  recent.forEach((t) => list.appendChild(renderEntryRow(t)));
}

// ===== History =====
function renderHistory() {
  document.getElementById('currentMonth').textContent = monthLabel(state.cursorMonth);
  const monthTxns = monthTxnsFor(state.cursorMonth);
  renderLedger(monthTxns);
}

function renderLedger(monthTxns) {
  const ledger = document.getElementById('ledger');
  const empty = document.getElementById('emptyState');
  ledger.innerHTML = '';

  if (!monthTxns.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const groups = {};
  monthTxns.forEach((t) => {
    (groups[t.txn_date] = groups[t.txn_date] || []).push(t);
  });

  Object.keys(groups)
    .sort((a, b) => b.localeCompare(a))
    .forEach((date) => {
      const dayTxns = groups[date];
      const dayTotal = dayTxns.reduce((s, t) => s + (t.type === 'income' ? Number(t.amount) : -Number(t.amount)), 0);

      const group = document.createElement('div');
      group.className = 'date-group';

      const heading = document.createElement('div');
      heading.className = 'date-heading';
      const d = new Date(date + 'T00:00:00');
      heading.innerHTML = `<span>${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span><span>${peso(dayTotal)}</span>`;
      group.appendChild(heading);

      dayTxns.forEach((t) => group.appendChild(renderEntryRow(t)));
      ledger.appendChild(group);
    });
}

function renderEntryRow(t) {
  const cat = state.categories.find((c) => c.id === t.category_id);
  const row = document.createElement('div');
  row.className = 'entry-row';
  row.innerHTML = `
    <span class="entry-dot ${t.type}"></span>
    <div class="entry-main">
      <div class="entry-category">${cat ? cat.name : 'Uncategorized'}</div>
      ${t.note ? `<div class="entry-note">${escapeHTML(t.note)}</div>` : ''}
    </div>
    <span class="entry-amount ${t.type}">${t.type === 'income' ? '+' : '−'}${peso(t.amount)}</span>
  `;
  row.addEventListener('click', () => openEntrySheet(t));
  return row;
}

function renderCategorySelect() {
  const select = document.getElementById('fieldCategory');
  const relevant = state.categories.filter((c) => c.type === state.activeType);
  select.innerHTML = relevant.map((c) => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
}

function renderCategoryList() {
  const list = document.getElementById('categoryList');
  list.innerHTML = state.categories
    .map((c) => `<span class="category-chip ${c.type}">${escapeHTML(c.name)}</span>`)
    .join('');
}

function escapeHTML(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// Re-render whichever view is currently on screen (after a data change).
function refreshCurrentView() {
  if (state.view === 'dashboard') renderDashboard();
  else if (state.view === 'history') renderHistory();
}

// ===== Entry sheet =====
function openEntrySheet(txn) {
  const backdrop = document.getElementById('entryBackdrop');
  const title = document.getElementById('entryTitle');
  const deleteBtn = document.getElementById('deleteEntryBtn');

  state.editingId = txn ? txn.id : null;
  state.activeType = txn ? txn.type : 'expense';

  setTypeToggle(state.activeType);
  renderCategorySelect();

  document.getElementById('fieldAmount').value = txn ? txn.amount : '';
  document.getElementById('fieldCategory').value = txn ? txn.category_id : '';
  document.getElementById('fieldDate').value = txn ? txn.txn_date : new Date().toISOString().slice(0, 10);
  document.getElementById('fieldNote').value = txn ? txn.note || '' : '';
  document.getElementById('fieldId').value = txn ? txn.id : '';

  title.textContent = txn ? 'Edit entry' : 'New entry';
  deleteBtn.hidden = !txn;
  backdrop.hidden = false;
}

function closeEntrySheet() {
  document.getElementById('entryBackdrop').hidden = true;
  state.editingId = null;
}

function setTypeToggle(type) {
  state.activeType = type;
  document.querySelectorAll('.type-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
  renderCategorySelect();
}

async function handleEntrySubmit(e) {
  e.preventDefault();
  const id = document.getElementById('fieldId').value || uuid();
  const isNew = !document.getElementById('fieldId').value;

  const record = {
    id,
    type: state.activeType,
    amount: parseFloat(document.getElementById('fieldAmount').value),
    category_id: document.getElementById('fieldCategory').value,
    txn_date: document.getElementById('fieldDate').value,
    note: document.getElementById('fieldNote').value.trim(),
    created_at: isNew ? nowISO() : (await Store.get('transactions', id)).created_at,
    updated_at: nowISO(),
    synced: 0,
    deleted: 0,
  };

  await Store.put('transactions', record);
  await loadAll();
  refreshCurrentView();
  closeEntrySheet();
  Sync.run();
}

async function handleDeleteEntry() {
  const id = document.getElementById('fieldId').value;
  if (!id) return;
  const record = await Store.get('transactions', id);
  record.deleted = 1;
  record.updated_at = nowISO();
  record.synced = 0;
  await Store.put('transactions', record);
  await loadAll();
  refreshCurrentView();
  closeEntrySheet();
  Sync.run();
}

// ===== Settings view =====
function renderSettingsView() {
  renderAccountSection();
  renderCategoryList();
  document.getElementById('budgetInput').value = state.budget || '';
}

function renderAccountSection() {
  const signedOut = document.getElementById('accountSignedOut');
  const signedIn = document.getElementById('accountSignedIn');
  if (Auth.isSignedIn()) {
    signedOut.hidden = true;
    signedIn.hidden = false;
    document.getElementById('accountName').textContent = Auth.userName;
  } else {
    signedOut.hidden = false;
    signedIn.hidden = true;
  }
}

async function handleBudgetSubmit(e) {
  e.preventDefault();
  const val = parseFloat(document.getElementById('budgetInput').value) || 0;
  state.budget = val;
  await Store.setMeta('monthly_budget', String(val));
  if (state.view === 'dashboard') renderDashboard();
}

function handleEditBudgetClick() {
  switchView('settings');
  document.getElementById('budgetInput').focus();
}

// ===== Auth gate (login / create account) =====
let authMode = 'login';

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('.auth-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  document.getElementById('authSubmitBtn').textContent = mode === 'register' ? 'Create account' : 'Log in';
  document.getElementById('authModeHint').textContent =
    mode === 'register'
      ? 'Pick any name and a PIN (4+ digits) — this is what you\'ll use to log in on other devices.'
      : 'Log in with the name and PIN you used before.';
  document.getElementById('authStatus').textContent = '';
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('authName').value.trim();
  const pin = document.getElementById('authPin').value.trim();
  const status = document.getElementById('authStatus');
  const submitBtn = document.getElementById('authSubmitBtn');

  if (!name || !pin) {
    status.textContent = 'Enter a name and PIN.';
    return;
  }

  submitBtn.disabled = true;
  status.textContent = authMode === 'register' ? 'Creating account…' : 'Signing in…';
  try {
    if (authMode === 'register') {
      await Auth.register(name, pin);
      // Brand new account — start it off with the default category set.
      await clearLocalData();
      await seedCategoriesIfEmpty();
    } else {
      await Auth.login(name, pin);
      // Existing account — wipe any local/guest data on this device so
      // nothing gets mixed in with what's about to be pulled from the
      // server; don't reseed defaults, the account already has its own.
      await clearLocalData();
    }
    localStorage.removeItem('guest_mode');
    await Sync.run();
    await enterApp();
  } catch (err) {
    status.textContent = err.message || 'Something went wrong.';
  } finally {
    submitBtn.disabled = false;
  }
}

function handleContinueOffline() {
  localStorage.setItem('guest_mode', '1');
  enterApp();
}

async function handleOpenSignIn() {
  localStorage.removeItem('guest_mode');
  setAuthMode('login');
  showAuthGate();
}

async function handleSignOut() {
  Auth.signOut();
  localStorage.removeItem('guest_mode');
  await clearLocalData();
  setAuthMode('login');
  showAuthGate();
}

async function handleNewCategory(e) {
  e.preventDefault();
  const name = document.getElementById('newCategoryName').value.trim();
  const type = document.getElementById('newCategoryType').value;
  if (!name) return;

  await Store.put('categories', {
    id: uuid(),
    name,
    type,
    created_at: nowISO(),
    updated_at: nowISO(),
    synced: 0,
    deleted: 0,
  });
  document.getElementById('newCategoryName').value = '';
  await loadAll();
  renderCategoryList();
  Sync.run();
}

// ===== Sync indicator =====
function updateSyncDot(status) {
  const dot = document.getElementById('syncDot');
  dot.className = 'sync-dot ' + (status === 'synced' ? 'synced' : status === 'syncing' ? 'syncing' : status === 'error' ? 'error' : '');
  dot.title = 'Sync: ' + status;
  if (status === 'synced') loadAll().then(refreshCurrentView);
}

// ===== Events =====
function bindEvents() {
  document.getElementById('prevMonth').addEventListener('click', () => {
    state.cursorMonth.setMonth(state.cursorMonth.getMonth() - 1);
    renderHistory();
  });
  document.getElementById('nextMonth').addEventListener('click', () => {
    state.cursorMonth.setMonth(state.cursorMonth.getMonth() + 1);
    renderHistory();
  });

  document.getElementById('addBtn').addEventListener('click', () => openEntrySheet(null));
  document.getElementById('cancelEntryBtn').addEventListener('click', closeEntrySheet);
  document.getElementById('entryBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'entryBackdrop') closeEntrySheet();
  });
  document.getElementById('entryForm').addEventListener('submit', handleEntrySubmit);
  document.getElementById('deleteEntryBtn').addEventListener('click', handleDeleteEntry);

  document.querySelectorAll('.type-btn').forEach((btn) => {
    btn.addEventListener('click', () => setTypeToggle(btn.dataset.type));
  });

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  document.getElementById('viewAllBtn').addEventListener('click', () => switchView('history'));
  document.getElementById('editBudgetBtn').addEventListener('click', handleEditBudgetClick);

  document.getElementById('openSignInBtn').addEventListener('click', handleOpenSignIn);
  document.getElementById('signOutBtn').addEventListener('click', handleSignOut);
  document.getElementById('newCategoryForm').addEventListener('submit', handleNewCategory);
  document.getElementById('budgetForm').addEventListener('submit', handleBudgetSubmit);

  document.querySelectorAll('.auth-tab').forEach((btn) => {
    btn.addEventListener('click', () => setAuthMode(btn.dataset.mode));
  });
  document.getElementById('authForm').addEventListener('submit', handleAuthSubmit);
  document.getElementById('continueOfflineBtn').addEventListener('click', handleContinueOffline);
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch((err) => console.error('SW failed', err));
  }
}

document.addEventListener('DOMContentLoaded', init);
