/**
 * app.js — UI state and rendering. Reads/writes go through Store (db.js).
 *
 * Views: dashboard | calendar | history | settings
 * Everything is offline-first: the UI never waits on the network.
 */

/**
 * Money doesn't arrive the same way for everyone, and a fixed monthly budget
 * is wrong for most students — baon lands weekly (or daily), while salaries
 * often land twice a month. Each profile seeds sensible categories and picks
 * the budget cycle that matches how the money actually comes in.
 */
const PROFILES = {
  student: {
    name: 'Student on allowance',
    desc: 'Baon or allowance from your parents. Budget resets every week.',
    period: 'week',
    income: ['Allowance', 'Baon', 'Scholarship', 'Gift'],
    expense: ['Food', 'Transport', 'Load & data', 'School supplies', 'Printing', 'Snacks', 'Org fees', 'Other'],
  },
  working_student: {
    name: 'Working student',
    desc: 'Part-time or freelance pay, maybe some allowance too. Resets monthly.',
    period: 'month',
    income: ['Allowance', 'Part-time pay', 'Freelance'],
    expense: ['Food', 'Transport', 'Load & data', 'School supplies', 'Rent or board', 'Bills', 'Other'],
  },
  worker: {
    name: 'Working full-time',
    desc: 'Regular pay. Resets on the 15th and end of month, like most payrolls.',
    period: 'semi',
    income: ['Salary', 'Overtime', 'Bonus', 'Freelance'],
    expense: ['Food', 'Transport', 'Rent', 'Bills', 'Groceries', 'Family support', 'Savings', 'Other'],
  },
  none: {
    name: 'No income yet',
    desc: 'Just tracking what you spend from money you already have.',
    period: 'week',
    income: ['Money received'],
    expense: ['Food', 'Transport', 'Load & data', 'School supplies', 'Printing', 'Other'],
  },
};

const PERIODS = {
  week: { label: 'this week', short: 'week', noun: 'week' },
  semi: { label: 'this cut-off', short: 'cut-off', noun: 'cut-off' },
  month: { label: 'this month', short: 'month', noun: 'month' },
};

const VIEWS = ['dashboard', 'calendar', 'history', 'settings'];
const BREAKDOWN_LIMIT = 5;
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const QUICK_SLOTS = 4;

let state = {
  view: 'dashboard',
  cursorMonth: new Date(),
  selectedDate: null,
  transactions: [],
  categories: [],
  allCategories: [],
  editingId: null,
  activeType: 'expense',
  profile: 'student',
  period: 'week',
  budget: 0,
  newCatType: 'expense',
};

// ===== Formatting =====
function peso(n) {
  const v = Number(n) || 0;
  const body = Math.abs(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '−' : '') + '₱' + body;
}

function pesoRound(n) {
  const v = Math.round(Number(n) || 0);
  return '₱' + Math.abs(v).toLocaleString('en-PH');
}

function pesoCompact(n) {
  const v = Math.abs(Number(n) || 0);
  if (v >= 1000) {
    const k = v / 1000;
    return (k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')) + 'k';
  }
  return String(Math.round(v));
}

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (d) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayKey = () => dateKey(new Date());
const parseKey = (key) => new Date(key + 'T00:00:00');

function escapeHTML(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function haptic(ms = 8) {
  if (navigator.vibrate) {
    try { navigator.vibrate(ms); } catch (_) { /* unsupported, no matter */ }
  }
}

let toastTimer = null;
function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 220);
  }, 1900);
}

/**
 * The budget window that `date` falls inside, for the active cycle.
 * week  — Sunday to Saturday, matching the calendar grid.
 * semi  — 1st–15th, then 16th–end of month (the usual PH payroll cut-off).
 * month — calendar month.
 */
function periodRange(date, period) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = d.getMonth();

  if (period === 'week') {
    const start = new Date(y, m, d.getDate() - d.getDay());
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    return { start, end };
  }
  if (period === 'semi') {
    return d.getDate() <= 15
      ? { start: new Date(y, m, 1), end: new Date(y, m, 15) }
      : { start: new Date(y, m, 16), end: new Date(y, m + 1, 0) };
  }
  return { start: new Date(y, m, 1), end: new Date(y, m + 1, 0) };
}

function currentPeriod() {
  const { start, end } = periodRange(new Date(), state.period);
  const startKey = dateKey(start);
  const endKey = dateKey(end);
  const txns = state.transactions.filter((t) => t.txn_date >= startKey && t.txn_date <= endKey);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const msDay = 86400000;
  const daysLeft = Math.max(1, Math.round((end - today) / msDay) + 1);

  return { start, end, startKey, endKey, txns, daysLeft };
}

// ===== Boot =====
async function init() {
  await openDB();
  bindEvents();
  registerServiceWorker();
  Sync.onStatusChange(updateSyncDot);

  const guestMode = localStorage.getItem('guest_mode') === '1';
  if (Auth.isSignedIn() || guestMode) {
    await afterSignIn();
  } else {
    showAuthGate();
  }
}

async function loadSettings() {
  state.profile = (await Store.getMeta('profile')) || 'student';
  state.period = (await Store.getMeta('budget_period')) || PROFILES[state.profile].period;

  let budget = await Store.getMeta('budget_amount');
  if (budget === null) {
    // Carry over a budget saved before budget cycles existed.
    const legacy = await Store.getMeta('monthly_budget');
    if (legacy !== null) {
      budget = legacy;
      state.period = (await Store.getMeta('budget_period')) || 'month';
      await Store.setMeta('budget_amount', String(legacy));
      await Store.setMeta('budget_period', state.period);
    }
  }
  state.budget = Number(budget || 0);
}

/** Decide between the setup screen and the app itself. */
async function afterSignIn() {
  await loadAll();
  await loadSettings();

  const setupDone = await Store.getMeta('setup_done');
  // Someone with entries already has a working setup — don't interrogate them.
  if (!setupDone && state.transactions.length === 0) {
    showSetupGate();
    return;
  }
  if (!setupDone) await Store.setMeta('setup_done', '1');
  await enterApp();
}

async function enterApp() {
  document.getElementById('authGate').hidden = true;
  document.getElementById('setupGate').hidden = true;
  document.getElementById('app').hidden = false;

  await seedCategoriesIfEmpty(state.profile);
  await loadAll();
  await loadSettings();

  state.cursorMonth = new Date();
  state.selectedDate = todayKey();

  switchView('dashboard');
  if (navigator.onLine && Auth.isSignedIn()) Sync.run();
}

function showAuthGate() {
  document.getElementById('app').hidden = true;
  document.getElementById('setupGate').hidden = true;
  document.getElementById('authGate').hidden = false;
  document.getElementById('authName').value = '';
  document.getElementById('authPin').value = '';
  document.getElementById('authStatus').textContent = '';
}

// ===== Setup gate =====
function showSetupGate() {
  document.getElementById('authGate').hidden = true;
  document.getElementById('app').hidden = true;
  document.getElementById('setupGate').hidden = false;
  state.profile = 'student';
  state.period = PROFILES.student.period;

  const container = document.getElementById('setupProfiles');
  const pick = (key) => {
    state.profile = key;
    state.period = PROFILES[key].period;
    renderProfileList(container, pick);
    updateSetupBudgetLabel();
  };
  renderProfileList(container, pick);
  updateSetupBudgetLabel();
}

function updateSetupBudgetLabel() {
  const noun = PERIODS[state.period].noun;
  document.getElementById('setupBudgetLabel').textContent = `How much do you want to spend per ${noun}?`;
}

function renderProfileList(container, onPick) {
  container.innerHTML = '';
  Object.entries(PROFILES).forEach(([key, p]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'profile-opt' + (key === state.profile ? ' selected' : '');
    btn.innerHTML = `
      <span class="profile-tick"><svg class="ico" aria-hidden="true"><use href="#i-check"/></svg></span>
      <span class="profile-text">
        <span class="profile-name">${escapeHTML(p.name)}</span>
        <span class="profile-desc">${escapeHTML(p.desc)}</span>
      </span>`;
    btn.addEventListener('click', () => onPick(key));
    container.appendChild(btn);
  });
}

async function handleSetupDone() {
  const amount = parseFloat(document.getElementById('setupBudget').value) || 0;
  await Store.setMeta('profile', state.profile);
  await Store.setMeta('budget_period', state.period);
  await Store.setMeta('budget_amount', String(amount));
  await Store.setMeta('setup_done', '1');
  state.budget = amount;
  await seedCategoriesIfEmpty(state.profile);
  await enterApp();
}

// ===== Categories =====
async function seedCategoriesIfEmpty(profileKey) {
  const existing = await Store.getAll('categories');
  if (existing.length) return;
  await addCategories(PROFILES[profileKey] ? profileKey : 'student');
}

/** Adds any of a profile's categories that aren't already there. Never removes. */
async function addCategories(profileKey) {
  const profile = PROFILES[profileKey];
  if (!profile) return 0;

  const existing = await Store.getAll('categories');
  const have = new Set(existing.filter((c) => !c.deleted)
    .map((c) => `${c.type}:${c.name.trim().toLowerCase()}`));

  const records = [];
  const push = (name, type) => {
    if (have.has(`${type}:${name.toLowerCase()}`)) return;
    records.push({
      id: uuid(), name, type,
      created_at: nowISO(), updated_at: nowISO(),
      synced: 0, deleted: 0,
    });
  };
  profile.income.forEach((n) => push(n, 'income'));
  profile.expense.forEach((n) => push(n, 'expense'));

  if (records.length) await Store.bulkPut('categories', records);
  return records.length;
}

async function loadAll() {
  const [txns, cats] = await Promise.all([Store.getAll('transactions'), Store.getAll('categories')]);
  state.transactions = txns.filter((t) => !t.deleted);
  state.allCategories = cats;
  state.categories = dedupeCategories(cats.filter((c) => !c.deleted));
}

function dedupeCategories(cats) {
  const seen = new Map();
  for (const c of cats) {
    const key = `${c.type}:${c.name.trim().toLowerCase()}`;
    const existing = seen.get(key);
    if (!existing || c.created_at < existing.created_at) seen.set(key, c);
  }
  // IndexedDB hands records back in key (uuid) order, which is effectively
  // random — so sort, or the category list reshuffles on every load.
  return [...seen.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'income' ? -1 : 1;
    return a.name.localeCompare(b.name, 'en');
  });
}

function categoryName(id) {
  const c = state.allCategories.find((x) => x.id === id);
  return c ? c.name : 'Uncategorized';
}

// ===== View routing =====
function switchView(view, opts = {}) {
  if (!VIEWS.includes(view)) return;
  const changed = state.view !== view;
  state.view = view;

  VIEWS.forEach((v) => {
    document.getElementById(`view-${v}`).hidden = v !== view;
  });
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  document.getElementById('addBtn').hidden = view === 'settings';

  if (view === 'dashboard') renderDashboard();
  else if (view === 'calendar') renderCalendar();
  else if (view === 'history') renderHistory();
  else if (view === 'settings') renderSettingsView();

  if (changed && !opts.silent) {
    window.scrollTo(0, 0);
    haptic(6);
  }
}

function monthTxnsFor(date) {
  const key = monthKey(date);
  return state.transactions
    .filter((t) => t.txn_date.startsWith(key))
    .sort((a, b) => b.txn_date.localeCompare(a.txn_date) || b.created_at.localeCompare(a.created_at));
}

function totals(txns) {
  const income = txns.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const expense = txns.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  return { income, expense, net: income - expense };
}

// ===== Dashboard =====
function renderDashboard() {
  const period = currentPeriod();
  const { income, expense } = totals(period.txns);
  const periodLabel = PERIODS[state.period].label;

  document.getElementById('heroGreeting').textContent =
    Auth.isSignedIn() ? `Hi, ${Auth.userName}` : 'Hi there';

  // The headline is the number worth checking several times a day.
  const heroLabel = document.getElementById('heroLabel');
  const heroFigure = document.getElementById('heroFigure');
  const heroSub = document.getElementById('heroSub');

  if (state.budget > 0) {
    const remaining = state.budget - expense;
    const perDay = remaining / period.daysLeft;
    heroLabel.textContent = 'Safe to spend today';
    heroFigure.textContent = pesoRound(Math.max(0, perDay));
    heroSub.textContent = remaining >= 0
      ? `${peso(remaining)} left for ${period.daysLeft} more day${period.daysLeft === 1 ? '' : 's'}`
      : `${peso(-remaining)} over your budget for ${periodLabel}`;
    if (remaining < 0) heroFigure.textContent = pesoRound(0);
  } else {
    heroLabel.textContent = `Spent ${periodLabel}`;
    heroFigure.textContent = peso(expense);
    heroSub.textContent = 'Set a budget to see what’s safe to spend each day.';
  }

  document.getElementById('inLabel').textContent = state.profile === 'none' ? 'Received' : 'Money in';
  document.getElementById('incomeTotal').textContent = peso(income);
  document.getElementById('expenseTotal').textContent = peso(expense);
  document.getElementById('leftTotal').textContent =
    peso(state.budget > 0 ? state.budget - expense : income - expense);

  renderQuickAdd();
  renderBudgetCard(expense, period);
  renderSpark();
  renderCategoryBreakdown(period.txns);
  renderRecentActivity();
  renderCategorySelect();
}

/** Two taps to log the things people log every day. */
function renderQuickAdd() {
  const wrap = document.getElementById('quickAdd');
  const row = document.getElementById('quickRow');
  const expenseCats = state.categories.filter((c) => c.type === 'expense');
  if (!expenseCats.length) { wrap.hidden = true; return; }

  // Rank by how often each has actually been used lately.
  const since = new Date();
  since.setDate(since.getDate() - 60);
  const sinceKey = dateKey(since);
  const uses = new Map();
  state.transactions
    .filter((t) => t.type === 'expense' && t.txn_date >= sinceKey)
    .forEach((t) => uses.set(t.category_id, (uses.get(t.category_id) || 0) + 1));

  const ranked = [...expenseCats].sort((a, b) => {
    const diff = (uses.get(b.id) || 0) - (uses.get(a.id) || 0);
    return diff !== 0 ? diff : a.name.localeCompare(b.name, 'en');
  }).slice(0, QUICK_SLOTS);

  wrap.hidden = false;
  row.innerHTML = '';
  ranked.forEach((c) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'quick-chip';
    chip.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#i-plus"/></svg>${escapeHTML(c.name)}`;
    chip.addEventListener('click', () => {
      openEntrySheet(null, todayKey(), c.id);
      haptic(8);
    });
    row.appendChild(chip);
  });
}

function renderBudgetCard(expense, period) {
  const title = document.getElementById('budgetTitle');
  const prompt = document.getElementById('budgetSetPrompt');
  const wrap = document.getElementById('budgetProgressWrap');
  const fill = document.getElementById('budgetProgressFill');
  const caption = document.getElementById('budgetCaption');
  const pace = document.getElementById('budgetPace');

  const noun = PERIODS[state.period].noun;
  title.textContent = `Budget for the ${noun}`;

  if (!state.budget || state.budget <= 0) {
    prompt.hidden = false;
    wrap.hidden = true;
    return;
  }
  prompt.hidden = true;
  wrap.hidden = false;

  const ratio = expense / state.budget;
  fill.style.width = `${Math.min(ratio, 1) * 100}%`;
  fill.classList.toggle('warn', ratio >= 0.75 && ratio < 1);
  fill.classList.toggle('over', ratio >= 1);

  const remaining = state.budget - expense;
  const range = `${period.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${period.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  if (remaining < 0) {
    caption.textContent = `${peso(-remaining)} over your ${peso(state.budget)} budget`;
    pace.textContent = `${range} · ease up or top up the budget.`;
  } else {
    caption.textContent = `${peso(expense)} spent of ${peso(state.budget)}`;
    pace.textContent = `${range} · ${peso(remaining)} left.`;
  }
}

/** Seven bars, one per day — spending shape at a glance. */
function renderSpark() {
  const spark = document.getElementById('spark');
  const totalEl = document.getElementById('weekTotal');
  const days = [];
  const today = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = dateKey(d);
    const spent = state.transactions
      .filter((t) => t.txn_date === key && t.type === 'expense')
      .reduce((s, t) => s + Number(t.amount), 0);
    days.push({ key, d, spent });
  }

  const max = Math.max(...days.map((x) => x.spent), 1);
  const sum = days.reduce((s, x) => s + x.spent, 0);
  totalEl.textContent = sum > 0 ? `${peso(sum)} total` : 'nothing spent';

  spark.innerHTML = '';
  days.forEach((day) => {
    const col = document.createElement('button');
    col.type = 'button';
    col.className = 'spark-col' + (day.key === todayKey() ? ' today' : '');
    col.setAttribute('aria-label',
      `${day.d.toLocaleDateString('en-US', { weekday: 'long' })}: ${peso(day.spent)}`);

    const height = day.spent > 0 ? Math.max(8, (day.spent / max) * 100) : 3;
    col.innerHTML = `
      <span class="spark-bar-wrap">
        <span class="spark-bar${day.spent > 0 ? ' has-spend' : ''}" style="height:${height}%"></span>
      </span>
      <span class="spark-day">${WEEKDAYS[day.d.getDay()]}</span>`;

    col.addEventListener('click', () => {
      state.cursorMonth = new Date(day.d.getFullYear(), day.d.getMonth(), 1);
      state.selectedDate = day.key;
      switchView('calendar');
    });
    spark.appendChild(col);
  });
}

function renderCategoryBreakdown(periodTxns) {
  const container = document.getElementById('categoryBreakdown');
  const empty = document.getElementById('breakdownEmpty');
  document.getElementById('breakdownPeriod').textContent = PERIODS[state.period].label;

  const expenseTxns = periodTxns.filter((t) => t.type === 'expense');
  if (!expenseTxns.length) {
    container.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const sums = new Map();
  expenseTxns.forEach((t) => {
    const name = categoryName(t.category_id);
    sums.set(name, (sums.get(name) || 0) + Number(t.amount));
  });

  let rows = [...sums.entries()].sort((a, b) => b[1] - a[1]);
  if (rows.length > BREAKDOWN_LIMIT) {
    const kept = rows.slice(0, BREAKDOWN_LIMIT);
    const rest = rows.slice(BREAKDOWN_LIMIT).reduce((s, [, amt]) => s + amt, 0);
    rows = [...kept, ['Everything else', rest]];
  }

  const total = expenseTxns.reduce((s, t) => s + Number(t.amount), 0);
  container.innerHTML = rows.map(([name, amt]) => {
    const pct = total ? (amt / total) * 100 : 0;
    return `
      <div class="breakdown-row">
        <div class="breakdown-labels">
          <span class="breakdown-name">${escapeHTML(name)}</span>
          <span class="breakdown-amount">${peso(amt)}</span>
        </div>
        <div class="breakdown-track"><div class="breakdown-fill" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');
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

// ===== Calendar =====
function renderCalendar() {
  document.getElementById('calMonthLabel').textContent = monthLabel(state.cursorMonth);

  const weekdays = document.getElementById('calWeekdays');
  if (!weekdays.childElementCount) {
    weekdays.innerHTML = WEEKDAYS.map((d) => `<span>${d}</span>`).join('');
  }

  const byDay = new Map();
  monthTxnsFor(state.cursorMonth).forEach((t) => {
    const cur = byDay.get(t.txn_date) || { income: 0, expense: 0 };
    cur[t.type] += Number(t.amount);
    byDay.set(t.txn_date, cur);
  });

  const year = state.cursorMonth.getFullYear();
  const month = state.cursorMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayKey();

  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';

  for (let i = 0; i < firstWeekday; i++) {
    const blank = document.createElement('div');
    blank.className = 'cal-cell blank';
    grid.appendChild(blank);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const data = byDay.get(key);

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-cell';
    cell.dataset.date = key;
    if (key === today) cell.classList.add('today');
    if (key === state.selectedDate) cell.classList.add('selected');

    const dayLabel = parseKey(key).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    cell.setAttribute('aria-label', data ? `${dayLabel}, spent ${peso(data.expense)}` : dayLabel);

    const num = document.createElement('span');
    num.className = 'cal-num';
    num.textContent = day;
    cell.appendChild(num);

    if (data && data.expense > 0) {
      const amt = document.createElement('span');
      amt.className = 'cal-amt';
      amt.textContent = pesoCompact(data.expense);
      cell.appendChild(amt);
    }

    const dots = document.createElement('span');
    dots.className = 'cal-dots';
    if (data && data.expense > 0) {
      const d = document.createElement('i');
      d.className = 'cal-dot expense';
      dots.appendChild(d);
    }
    if (data && data.income > 0) {
      const d = document.createElement('i');
      d.className = 'cal-dot income';
      dots.appendChild(d);
    }
    cell.appendChild(dots);

    cell.addEventListener('click', () => selectDay(key));
    grid.appendChild(cell);
  }

  renderDayCard();
}

function selectDay(key) {
  state.selectedDate = key;
  document.querySelectorAll('.cal-cell').forEach((c) => {
    c.classList.toggle('selected', c.dataset.date === key);
  });
  haptic(6);
  renderDayCard();
}

function renderDayCard() {
  const title = document.getElementById('dayCardTitle');
  const totalEl = document.getElementById('dayCardTotal');
  const list = document.getElementById('dayEntries');
  const empty = document.getElementById('dayEmpty');
  const addBtn = document.getElementById('addForDayBtn');

  list.innerHTML = '';

  if (!state.selectedDate) {
    title.textContent = 'Select a day';
    totalEl.textContent = '';
    empty.hidden = false;
    empty.textContent = 'Tap any day above to see what you spent.';
    addBtn.hidden = true;
    return;
  }

  const d = parseKey(state.selectedDate);
  const isToday = state.selectedDate === todayKey();
  title.textContent = isToday
    ? 'Today'
    : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  const dayTxns = state.transactions
    .filter((t) => t.txn_date === state.selectedDate)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const { net } = totals(dayTxns);
  totalEl.textContent = dayTxns.length ? (net >= 0 ? '+' : '−') + peso(Math.abs(net)) : '';

  addBtn.hidden = false;
  addBtn.textContent = isToday
    ? 'Add entry for today'
    : `Add entry for ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  if (!dayTxns.length) {
    empty.hidden = false;
    empty.textContent = 'Nothing recorded on this day.';
    return;
  }
  empty.hidden = true;
  dayTxns.forEach((t) => list.appendChild(renderEntryRow(t)));
}

// ===== History =====
function renderHistory() {
  document.getElementById('currentMonth').textContent = monthLabel(state.cursorMonth);
  const monthTxns = monthTxnsFor(state.cursorMonth);
  const { income, expense } = totals(monthTxns);

  document.getElementById('monthTotals').innerHTML = monthTxns.length
    ? `<span class="in">+${peso(income)}</span><span class="out">−${peso(expense)}</span>`
    : '';

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

  Object.keys(groups).sort((a, b) => b.localeCompare(a)).forEach((date) => {
    const dayTxns = groups[date];
    const dayTotal = dayTxns.reduce(
      (s, t) => s + (t.type === 'income' ? Number(t.amount) : -Number(t.amount)), 0);

    const group = document.createElement('div');
    group.className = 'date-group';

    const heading = document.createElement('div');
    heading.className = 'date-heading';
    const d = parseKey(date);
    heading.innerHTML =
      `<span>${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>` +
      `<span>${peso(dayTotal)}</span>`;
    group.appendChild(heading);

    dayTxns.forEach((t) => group.appendChild(renderEntryRow(t)));
    ledger.appendChild(group);
  });
}

function renderEntryRow(t) {
  const row = document.createElement('div');
  row.className = 'entry-row';
  row.innerHTML = `
    <span class="entry-dot ${t.type}"></span>
    <div class="entry-main">
      <div class="entry-category">${escapeHTML(categoryName(t.category_id))}</div>
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
  const current = select.value;
  select.innerHTML = relevant
    .map((c) => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
  if (relevant.some((c) => c.id === current)) select.value = current;
}

// ===== Settings =====
function renderSettingsView() {
  renderProfileList(document.getElementById('settingsProfiles'), handleProfileChange);
  renderPeriodSeg();
  document.getElementById('budgetInput').value = state.budget || '';
  renderCategoryManager();
  renderAccountSection();
  document.getElementById('entryCount').textContent = state.transactions.length;
}

function renderPeriodSeg() {
  document.querySelectorAll('#periodSeg .seg-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.period === state.period);
  });
}

function renderCategoryManager() {
  const groups = [
    { id: 'expenseCats', countId: 'expenseCount', type: 'expense' },
    { id: 'incomeCats', countId: 'incomeCount', type: 'income' },
  ];

  groups.forEach(({ id, countId, type }) => {
    const list = document.getElementById(id);
    const cats = state.categories.filter((c) => c.type === type);
    document.getElementById(countId).textContent = `${cats.length}`;
    list.innerHTML = '';

    if (!cats.length) {
      const none = document.createElement('p');
      none.className = 'hint hint-tight';
      none.textContent = 'None yet — add one below.';
      list.appendChild(none);
      return;
    }

    cats.forEach((c) => {
      const chip = document.createElement('span');
      chip.className = `category-chip ${c.type}`;
      chip.innerHTML =
        `${escapeHTML(c.name)}<button type="button" class="chip-x" aria-label="Remove ${escapeHTML(c.name)}">` +
        `<svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button>`;
      chip.querySelector('.chip-x').addEventListener('click', () => deleteCategory(c));
      list.appendChild(chip);
    });
  });
}

function renderAccountSection() {
  const signedOut = document.getElementById('accountSignedOut');
  const signedIn = document.getElementById('accountSignedIn');
  if (Auth.isSignedIn()) {
    signedOut.hidden = true;
    signedIn.hidden = false;
    document.getElementById('accountName').textContent = Auth.userName;
    Store.getMeta('last_sync').then((iso) => {
      document.getElementById('syncStatusText').textContent = iso
        ? `Last synced ${new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
        : 'Not synced yet';
    });
  } else {
    signedOut.hidden = false;
    signedIn.hidden = true;
  }
}

async function handleProfileChange(key) {
  if (key === state.profile) return;
  state.profile = key;
  await Store.setMeta('profile', key);

  const suggested = PROFILES[key].period;
  if (suggested !== state.period) {
    state.period = suggested;
    await Store.setMeta('budget_period', suggested);
  }

  const added = await addCategories(key);
  await loadAll();
  renderSettingsView();
  toast(added
    ? `Setup changed · ${added} categor${added === 1 ? 'y' : 'ies'} added`
    : 'Setup changed');
}

async function handlePeriodChange(period) {
  state.period = period;
  await Store.setMeta('budget_period', period);
  renderPeriodSeg();
  toast(`Budget now resets every ${PERIODS[period].noun}`);
}

async function handleBudgetSubmit(e) {
  e.preventDefault();
  const val = parseFloat(document.getElementById('budgetInput').value) || 0;
  state.budget = val;
  await Store.setMeta('budget_amount', String(val));
  const saved = document.getElementById('budgetSaved');
  saved.textContent = val > 0
    ? `Saved — ${peso(val)} per ${PERIODS[state.period].noun}.`
    : 'Budget cleared.';
  setTimeout(() => { saved.textContent = ''; }, 2600);
  document.getElementById('budgetInput').blur();
  haptic(10);
}

function handleEditBudgetClick() {
  switchView('settings');
  const input = document.getElementById('budgetInput');
  input.focus();
  input.select();
}

async function handleNewCategory(e) {
  e.preventDefault();
  const input = document.getElementById('newCategoryName');
  const name = input.value.trim();
  const type = state.newCatType;
  if (!name) return;

  const clash = state.categories.some(
    (c) => c.type === type && c.name.trim().toLowerCase() === name.toLowerCase());
  if (clash) { toast('That category already exists.'); return; }

  await Store.put('categories', {
    id: uuid(), name, type,
    created_at: nowISO(), updated_at: nowISO(),
    synced: 0, deleted: 0,
  });
  input.value = '';
  input.blur();
  await loadAll();
  renderCategoryManager();
  renderCategorySelect();
  toast(`${name} added`);
  Sync.run();
}

async function deleteCategory(cat) {
  const used = state.transactions.filter((t) => t.category_id === cat.id).length;
  const message = used
    ? `Remove "${cat.name}"? ${used} entr${used === 1 ? 'y' : 'ies'} keep the name, but you can't pick it for new ones.`
    : `Remove "${cat.name}"?`;
  if (!window.confirm(message)) return;

  const record = await Store.get('categories', cat.id);
  record.deleted = 1;
  record.updated_at = nowISO();
  record.synced = 0;
  await Store.put('categories', record);
  await loadAll();
  renderCategoryManager();
  renderCategorySelect();
  toast(`${cat.name} removed`);
  Sync.run();
}

function handleExportCsv() {
  if (!state.transactions.length) { toast('No entries to export yet.'); return; }

  const rows = [['Date', 'Type', 'Category', 'Amount', 'Note']];
  [...state.transactions]
    .sort((a, b) => a.txn_date.localeCompare(b.txn_date))
    .forEach((t) => {
      rows.push([t.txn_date, t.type, categoryName(t.category_id), Number(t.amount).toFixed(2), t.note || '']);
    });

  const csv = rows
    .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  // BOM keeps the peso sign intact when the file is opened in Excel.
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ledger-${todayKey()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('CSV downloaded');
}

// ===== Entry sheet =====
function openEntrySheet(txn, defaultDate, defaultCategoryId) {
  const backdrop = document.getElementById('entryBackdrop');

  state.editingId = txn ? txn.id : null;
  state.activeType = txn ? txn.type : 'expense';

  setTypeToggle(state.activeType);
  renderCategorySelect();

  const catSelect = document.getElementById('fieldCategory');
  document.getElementById('fieldAmount').value = txn ? txn.amount : '';
  if (txn) catSelect.value = txn.category_id;
  else if (defaultCategoryId) catSelect.value = defaultCategoryId;
  else if (catSelect.options.length) catSelect.selectedIndex = 0;

  document.getElementById('fieldDate').value = txn ? txn.txn_date : (defaultDate || todayKey());
  document.getElementById('fieldNote').value = txn ? txn.note || '' : '';
  document.getElementById('fieldId').value = txn ? txn.id : '';

  document.getElementById('entryTitle').textContent = txn ? 'Edit entry' : 'New entry';
  document.getElementById('deleteEntryBtn').hidden = !txn;

  openSheet(backdrop);

  // Straight to the keypad for a new entry — that's the only field that
  // always needs typing.
  if (!txn) {
    setTimeout(() => document.getElementById('fieldAmount').focus(), 340);
  }
}

function closeEntrySheet() {
  closeSheet(document.getElementById('entryBackdrop'));
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
  const amount = parseFloat(document.getElementById('fieldAmount').value);
  const categoryId = document.getElementById('fieldCategory').value;

  if (!(amount > 0)) { toast('Enter an amount above zero.'); return; }
  if (!categoryId) { toast('Pick a category first.'); return; }

  const id = document.getElementById('fieldId').value || uuid();
  const isNew = !document.getElementById('fieldId').value;

  const record = {
    id,
    type: state.activeType,
    amount,
    category_id: categoryId,
    txn_date: document.getElementById('fieldDate').value,
    note: document.getElementById('fieldNote').value.trim(),
    created_at: isNew ? nowISO() : (await Store.get('transactions', id)).created_at,
    updated_at: nowISO(),
    synced: 0,
    deleted: 0,
  };

  await Store.put('transactions', record);
  await loadAll();
  if (state.view === 'calendar') state.selectedDate = record.txn_date;
  refreshCurrentView();
  closeEntrySheet();
  haptic(12);
  toast(isNew ? 'Entry saved' : 'Entry updated');
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
  toast('Entry deleted');
  Sync.run();
}

function refreshCurrentView() {
  if (state.view === 'dashboard') renderDashboard();
  else if (state.view === 'calendar') renderCalendar();
  else if (state.view === 'history') renderHistory();
  else if (state.view === 'settings') renderSettingsView();
}

// ===== Sheet plumbing =====
function openSheet(backdrop) {
  backdrop.hidden = false;
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => requestAnimationFrame(() => backdrop.classList.add('is-open')));
}

function closeSheet(backdrop) {
  const sheet = backdrop.querySelector('.sheet');
  backdrop.classList.remove('is-open');
  sheet.style.transform = '';
  backdrop.style.opacity = '';
  document.body.classList.remove('sheet-open');
  setTimeout(() => {
    if (!backdrop.classList.contains('is-open')) backdrop.hidden = true;
  }, 340);
}

/**
 * Drag to dismiss. The grab strip always drags; dragging from the sheet body
 * only starts when it's already scrolled to the top and the finger moves
 * down, so scrolling inside the form is never hijacked.
 */
function makeSheetDraggable(backdrop, grab, onDismiss) {
  const sheet = backdrop.querySelector('.sheet');
  let startY = 0, lastY = 0, lastT = 0, offset = 0, velocity = 0;
  let tracking = false, dragging = false, fromGrab = false;

  const height = () => sheet.getBoundingClientRect().height || 1;

  function onStart(e) {
    if (e.touches && e.touches.length > 1) return;
    const point = e.touches ? e.touches[0] : e;
    fromGrab = !!grab && grab.contains(e.target);

    if (!fromGrab) {
      if (sheet.scrollTop > 0) return;
      if (e.target.closest('input, select, textarea, button, a')) return;
    }
    tracking = true;
    dragging = fromGrab;
    startY = lastY = point.clientY;
    lastT = performance.now();
    offset = 0;
    velocity = 0;
    if (dragging) sheet.classList.add('dragging');
  }

  function onMove(e) {
    if (!tracking) return;
    const point = e.touches ? e.touches[0] : e;
    const dy = point.clientY - startY;

    if (!dragging) {
      if (dy > 8) {
        dragging = true;
        sheet.classList.add('dragging');
      } else if (dy < -4) {
        tracking = false;
        return;
      } else {
        return;
      }
    }

    if (e.cancelable) e.preventDefault();

    offset = dy > 0 ? dy : dy / 4;
    sheet.style.transform = `translateY(${Math.max(offset, -28)}px)`;
    backdrop.style.opacity = String(Math.max(0.15, 1 - Math.max(offset, 0) / (height() * 1.15)));

    const now = performance.now();
    if (now > lastT) velocity = (point.clientY - lastY) / (now - lastT);
    lastY = point.clientY;
    lastT = now;
  }

  function onEnd() {
    if (!tracking) return;
    const wasDragging = dragging;
    tracking = dragging = false;
    sheet.classList.remove('dragging');
    if (!wasDragging) return;

    if (offset > height() * 0.26 || velocity > 0.75) {
      haptic(10);
      requestAnimationFrame(onDismiss);
    } else {
      sheet.style.transform = '';
      backdrop.style.opacity = '';
    }
  }

  sheet.addEventListener('touchstart', onStart, { passive: true });
  sheet.addEventListener('touchmove', onMove, { passive: false });
  sheet.addEventListener('touchend', onEnd);
  sheet.addEventListener('touchcancel', onEnd);

  if (grab) {
    grab.addEventListener('mousedown', (e) => {
      onStart(e);
      const move = (ev) => onMove(ev);
      const up = () => {
        onEnd();
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }
}

/** Horizontal swipe between the four tabs. */
function bindSwipeNavigation(area) {
  let x0 = 0, y0 = 0, tracking = false, decided = false, horizontal = false;

  area.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) return;
    if (document.body.classList.contains('sheet-open')) return;
    if (e.target.closest('.quick-row')) return;   // that strip scrolls sideways itself
    const t = e.touches[0];
    x0 = t.clientX; y0 = t.clientY;
    tracking = true; decided = false; horizontal = false;
  }, { passive: true });

  area.addEventListener('touchmove', (e) => {
    if (!tracking || decided) return;
    const t = e.touches[0];
    const dx = Math.abs(t.clientX - x0);
    const dy = Math.abs(t.clientY - y0);
    if (dx < 12 && dy < 12) return;
    decided = true;
    horizontal = dx > dy * 1.6;
  }, { passive: true });

  area.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    if (!horizontal) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) < 60) return;
    const i = VIEWS.indexOf(state.view);
    const next = dx < 0 ? i + 1 : i - 1;
    if (next >= 0 && next < VIEWS.length) switchView(VIEWS[next]);
  });
}

// ===== Auth =====
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
      await clearLocalData();
    } else {
      // Existing account — wipe local/guest data so nothing gets mixed in
      // with what's about to be pulled from the server.
      await Auth.login(name, pin);
      await clearLocalData();
    }
    localStorage.removeItem('guest_mode');
    await Sync.run();
    await afterSignIn();
  } catch (err) {
    status.textContent = err.message || 'Something went wrong.';
  } finally {
    submitBtn.disabled = false;
  }
}

function handleContinueOffline() {
  localStorage.setItem('guest_mode', '1');
  afterSignIn();
}

function handleOpenSignIn() {
  localStorage.removeItem('guest_mode');
  setAuthMode('login');
  showAuthGate();
}

async function handleSignOut() {
  if (!window.confirm('Sign out? Entries on this device are cleared and pulled again next time you log in.')) return;
  Auth.signOut();
  localStorage.removeItem('guest_mode');
  await clearLocalData();
  setAuthMode('login');
  showAuthGate();
}

// ===== Sync indicator =====
function updateSyncDot(status) {
  const dot = document.getElementById('syncDot');
  const label = document.getElementById('syncLabel');
  dot.className = 'sync-dot ' +
    (status === 'synced' ? 'synced' : status === 'syncing' ? 'syncing' : status === 'error' ? 'error' : '');

  const words = {
    synced: 'Synced',
    syncing: 'Syncing…',
    error: 'Sync failed',
    offline: 'Offline',
    unconfigured: 'On this device',
  };
  if (label) label.textContent = words[status] || 'On this device';
  if (status === 'synced') loadAll().then(refreshCurrentView);
}

// ===== Events =====
function bindEvents() {
  const stepMonth = (delta, rerender) => {
    state.cursorMonth = new Date(
      state.cursorMonth.getFullYear(), state.cursorMonth.getMonth() + delta, 1);
    state.selectedDate = monthKey(state.cursorMonth) === monthKey(new Date())
      ? todayKey()
      : `${monthKey(state.cursorMonth)}-01`;
    rerender();
  };
  document.getElementById('prevMonth').addEventListener('click', () => stepMonth(-1, renderHistory));
  document.getElementById('nextMonth').addEventListener('click', () => stepMonth(1, renderHistory));
  document.getElementById('calPrev').addEventListener('click', () => stepMonth(-1, renderCalendar));
  document.getElementById('calNext').addEventListener('click', () => stepMonth(1, renderCalendar));
  document.getElementById('calTodayBtn').addEventListener('click', () => {
    state.cursorMonth = new Date();
    state.selectedDate = todayKey();
    renderCalendar();
  });

  document.getElementById('addBtn').addEventListener('click', () => {
    openEntrySheet(null, state.view === 'calendar' ? state.selectedDate : null);
  });
  document.getElementById('addForDayBtn').addEventListener('click', () => {
    openEntrySheet(null, state.selectedDate);
  });
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
  document.getElementById('setBudgetBtn').addEventListener('click', handleEditBudgetClick);
  document.getElementById('syncChip').addEventListener('click', () => {
    if (Auth.isSignedIn()) { Sync.run(); toast('Syncing…'); }
    else switchView('settings');
  });

  document.getElementById('openSignInBtn').addEventListener('click', handleOpenSignIn);
  document.getElementById('signOutBtn').addEventListener('click', handleSignOut);
  document.getElementById('syncNowBtn').addEventListener('click', () => {
    Sync.run();
    toast('Syncing…');
  });
  document.getElementById('newCategoryForm').addEventListener('submit', handleNewCategory);
  document.getElementById('budgetForm').addEventListener('submit', handleBudgetSubmit);
  document.getElementById('exportCsvBtn').addEventListener('click', handleExportCsv);

  document.querySelectorAll('#periodSeg .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => handlePeriodChange(btn.dataset.period));
  });
  document.querySelectorAll('#newCatTypeSeg .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.newCatType = btn.dataset.cattype;
      document.querySelectorAll('#newCatTypeSeg .seg-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.cattype === state.newCatType);
      });
    });
  });

  document.getElementById('setupDoneBtn').addEventListener('click', handleSetupDone);

  document.querySelectorAll('.auth-tab').forEach((btn) => {
    btn.addEventListener('click', () => setAuthMode(btn.dataset.mode));
  });
  document.getElementById('authForm').addEventListener('submit', handleAuthSubmit);
  document.getElementById('continueOfflineBtn').addEventListener('click', handleContinueOffline);

  makeSheetDraggable(
    document.getElementById('entryBackdrop'),
    document.getElementById('entryGrab'),
    closeEntrySheet);
  bindSwipeNavigation(document.getElementById('swipeArea'));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('entryBackdrop').hidden) closeEntrySheet();
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch((err) => console.error('SW failed', err));
  }
}

document.addEventListener('DOMContentLoaded', init);
