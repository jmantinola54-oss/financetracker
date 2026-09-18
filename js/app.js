/**
 * app.js — UI state and rendering. Reads/writes go through Store (db.js).
 *
 * Views: dashboard | calendar | history | settings
 * Everything is offline-first: the UI never waits on the network.
 */
const DEFAULT_CATEGORIES = [
  { name: 'Allowance', type: 'income' },
  { name: 'Salary', type: 'income' },
  { name: 'Freelance', type: 'income' },
  { name: 'Food', type: 'expense' },
  { name: 'Transport', type: 'expense' },
  { name: 'Load & data', type: 'expense' },
  { name: 'School supplies', type: 'expense' },
  { name: 'Bills', type: 'expense' },
  { name: 'Rent', type: 'expense' },
  { name: 'Shopping', type: 'expense' },
  { name: 'Other', type: 'expense' },
];

const VIEWS = ['dashboard', 'calendar', 'history', 'settings'];
const VIEW_TITLES = {
  dashboard: 'Dashboard',
  calendar: 'Calendar',
  history: 'History',
  settings: 'Settings',
};
const BREAKDOWN_LIMIT = 5; // top N categories before the rest fold into "Other"
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

let state = {
  view: 'dashboard',
  cursorMonth: new Date(),   // month shown in Calendar + History
  selectedDate: null,        // 'YYYY-MM-DD' selected in Calendar
  transactions: [],
  categories: [],            // active only (drives pickers)
  allCategories: [],         // includes deleted, for naming old entries
  editingId: null,
  activeType: 'expense',
  budget: 0,
};

// ===== Formatting helpers =====
// The minus sign belongs in front of the symbol ("−₱60.00"), not between
// the symbol and the digits, which is what a naive prefix produces.
function peso(n) {
  const v = Number(n) || 0;
  const body = Math.abs(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '−' : '') + '₱' + body;
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
    try { navigator.vibrate(ms); } catch (_) { /* not supported, no matter */ }
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

// ===== Boot =====
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

  state.cursorMonth = new Date();
  state.selectedDate = todayKey();

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
  state.allCategories = cats;
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
    if (!existing || c.created_at < existing.created_at) seen.set(key, c);
  }
  // IndexedDB hands records back in key (uuid) order, which is effectively
  // random — so sort, or the category list reshuffles on every load.
  return [...seen.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'income' ? -1 : 1;
    return a.name.localeCompare(b.name, 'en');
  });
}

// Names resolve against every category ever created, so deleting a category
// doesn't orphan the entries that were filed under it.
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
  document.getElementById('topbarTitle').textContent = VIEW_TITLES[view];
  document.getElementById('addBtn').hidden = view === 'settings';

  if (view === 'dashboard') renderDashboard();
  else if (view === 'calendar') renderCalendar();
  else if (view === 'history') renderHistory();
  else if (view === 'settings') renderSettingsView();

  if (changed && !opts.silent) {
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    haptic(6);
  }
}

// ===== Shared selectors over state =====
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
  const now = new Date();
  const monthTxns = monthTxnsFor(now);
  const { income, expense } = totals(monthTxns);

  document.getElementById('heroGreeting').textContent =
    Auth.isSignedIn() ? `Hi, ${Auth.userName}` : 'Hi there';
  document.getElementById('dashMonthLabel').textContent = `${monthLabel(now)} balance`;
  document.getElementById('balanceFigure').textContent = peso(income - expense);
  document.getElementById('incomeTotal').textContent = peso(income);
  document.getElementById('expenseTotal').textContent = peso(expense);

  renderBudgetCard(expense);
  renderCategoryBreakdown(monthTxns);
  renderRecentActivity();
  renderCategorySelect();
}

function renderBudgetCard(expense) {
  const prompt = document.getElementById('budgetSetPrompt');
  const wrap = document.getElementById('budgetProgressWrap');
  const fill = document.getElementById('budgetProgressFill');
  const caption = document.getElementById('budgetCaption');
  const pace = document.getElementById('budgetPace');

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
  if (remaining < 0) {
    caption.textContent = `${peso(-remaining)} over your ${peso(state.budget)} budget`;
    pace.textContent = 'Spending is above plan for this month.';
    return;
  }

  caption.textContent = `${peso(remaining)} left of ${peso(state.budget)}`;

  // Days left including today, so the daily figure is money you can still spend.
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate() + 1;
  const perDay = remaining / daysLeft;
  pace.textContent = `About ${peso(perDay)} a day for the ${daysLeft} day${daysLeft === 1 ? '' : 's'} left.`;
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

// ===== Calendar =====
function renderCalendar() {
  document.getElementById('calMonthLabel').textContent = monthLabel(state.cursorMonth);

  const weekdays = document.getElementById('calWeekdays');
  if (!weekdays.childElementCount) {
    weekdays.innerHTML = WEEKDAYS.map((d) => `<span>${d}</span>`).join('');
  }

  // Per-day income/expense for the visible month.
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
    cell.setAttribute('aria-label',
      data ? `${dayLabel}, spent ${peso(data.expense)}` : dayLabel);

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
  addBtn.textContent = isToday ? 'Add entry for today' : `Add entry for ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

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

  Object.keys(groups)
    .sort((a, b) => b.localeCompare(a))
    .forEach((date) => {
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
    .map((c) => `<option value="${c.id}">${escapeHTML(c.name)}</option>`)
    .join('');
  if (relevant.some((c) => c.id === current)) select.value = current;
}

function renderCategoryList() {
  const list = document.getElementById('categoryList');
  list.innerHTML = '';
  state.categories.forEach((c) => {
    const chip = document.createElement('span');
    chip.className = `category-chip ${c.type}`;
    chip.innerHTML =
      `${escapeHTML(c.name)}<button type="button" class="chip-x" aria-label="Remove ${escapeHTML(c.name)}">` +
      `<svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button>`;
    chip.querySelector('.chip-x').addEventListener('click', () => deleteCategory(c));
    list.appendChild(chip);
  });
}

// Re-render whichever view is on screen (after a data change).
function refreshCurrentView() {
  if (state.view === 'dashboard') renderDashboard();
  else if (state.view === 'calendar') renderCalendar();
  else if (state.view === 'history') renderHistory();
  else if (state.view === 'settings') renderSettingsView();
}

// ===== Sheet plumbing: open/close with animation, drag to dismiss =====
function openSheet(backdrop) {
  backdrop.hidden = false;
  document.body.classList.add('sheet-open');
  // Two frames: one to apply `hidden = false`, one for the transition to take.
  requestAnimationFrame(() => requestAnimationFrame(() => backdrop.classList.add('is-open')));
}

function closeSheet(backdrop) {
  const sheet = backdrop.querySelector('.sheet');
  backdrop.classList.remove('is-open');
  sheet.style.transform = '';     // hand back to CSS → animates down to 100%
  backdrop.style.opacity = '';
  document.body.classList.remove('sheet-open');
  setTimeout(() => {
    if (!backdrop.classList.contains('is-open')) backdrop.hidden = true;
  }, 340);
}

/**
 * Native-feeling drag-to-dismiss.
 * The grab strip always drags. Dragging from the sheet body only starts when
 * the sheet is already scrolled to the top and the finger moves downward, so
 * normal scrolling inside the form is never hijacked.
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
      if (sheet.scrollTop > 0) return;                                  // let it scroll
      if (e.target.closest('input, select, textarea, button, a')) return; // let it tap
    }
    tracking = true;
    dragging = fromGrab;                 // grab strip drags immediately
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
      if (dy > 8) {                      // clearly a downward pull → take over
        dragging = true;
        sheet.classList.add('dragging');
      } else if (dy < -4) {              // upward → it's a scroll, let go
        tracking = false;
        return;
      } else {
        return;
      }
    }

    if (e.cancelable) e.preventDefault();

    // Resist upward drag instead of letting the sheet fly off the top.
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

    // Dismiss on a long pull or a quick flick.
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

  // Pointer fallback so the gesture also works with a mouse/trackpad.
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
    const t = e.touches[0];
    x0 = t.clientX;
    y0 = t.clientY;
    tracking = true;
    decided = false;
    horizontal = false;
  }, { passive: true });

  area.addEventListener('touchmove', (e) => {
    if (!tracking || decided) return;
    const t = e.touches[0];
    const dx = Math.abs(t.clientX - x0);
    const dy = Math.abs(t.clientY - y0);
    if (dx < 12 && dy < 12) return;
    decided = true;
    horizontal = dx > dy * 1.6;   // axis lock: only a clearly sideways move counts
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

// ===== Entry sheet =====
function openEntrySheet(txn, defaultDate) {
  const backdrop = document.getElementById('entryBackdrop');

  state.editingId = txn ? txn.id : null;
  state.activeType = txn ? txn.type : 'expense';

  setTypeToggle(state.activeType);
  renderCategorySelect();

  const catSelect = document.getElementById('fieldCategory');
  document.getElementById('fieldAmount').value = txn ? txn.amount : '';
  // On a new entry, land on the first available category rather than an
  // empty selection the person has to notice and fix before saving.
  if (txn) catSelect.value = txn.category_id;
  else if (catSelect.options.length) catSelect.selectedIndex = 0;
  document.getElementById('fieldDate').value = txn ? txn.txn_date : (defaultDate || todayKey());
  document.getElementById('fieldNote').value = txn ? txn.note || '' : '';
  document.getElementById('fieldId').value = txn ? txn.id : '';

  document.getElementById('entryTitle').textContent = txn ? 'Edit entry' : 'New entry';
  document.getElementById('deleteEntryBtn').hidden = !txn;

  openSheet(backdrop);
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

// ===== Settings =====
function renderSettingsView() {
  renderAccountSection();
  renderCategoryList();
  document.getElementById('budgetInput').value = state.budget || '';
  document.getElementById('entryCount').textContent = state.transactions.length;
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
  const saved = document.getElementById('budgetSaved');
  saved.textContent = val > 0 ? `Budget set to ${peso(val)} a month.` : 'Budget cleared.';
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
  const type = document.getElementById('newCategoryType').value;
  if (!name) return;

  const clash = state.categories.some(
    (c) => c.type === type && c.name.trim().toLowerCase() === name.toLowerCase());
  if (clash) { toast('That category already exists.'); return; }

  await Store.put('categories', {
    id: uuid(),
    name,
    type,
    created_at: nowISO(),
    updated_at: nowISO(),
    synced: 0,
    deleted: 0,
  });
  input.value = '';
  input.blur();
  await loadAll();
  renderCategoryList();
  renderCategorySelect();
  toast(`${name} added`);
  Sync.run();
}

async function deleteCategory(cat) {
  const used = state.transactions.filter((t) => t.category_id === cat.id).length;
  const message = used
    ? `Remove "${cat.name}"? ${used} entr${used === 1 ? 'y' : 'ies'} will keep the name but you can't pick it for new ones.`
    : `Remove "${cat.name}"?`;
  if (!window.confirm(message)) return;

  const record = await Store.get('categories', cat.id);
  record.deleted = 1;
  record.updated_at = nowISO();
  record.synced = 0;
  await Store.put('categories', record);
  await loadAll();
  renderCategoryList();
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

  // BOM keeps the peso sign and accents intact when opened in Excel.
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

// ===== Auth gate =====
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
  dot.className = 'sync-dot ' +
    (status === 'synced' ? 'synced' : status === 'syncing' ? 'syncing' : status === 'error' ? 'error' : '');
  dot.title = 'Sync: ' + status;
  if (status === 'synced') loadAll().then(refreshCurrentView);
}

// ===== Events =====
function bindEvents() {
  // Month navigation — Calendar and History share the same cursor.
  const stepMonth = (delta, rerender) => {
    state.cursorMonth = new Date(
      state.cursorMonth.getFullYear(), state.cursorMonth.getMonth() + delta, 1);
    // Keep a sensible selection when the month changes.
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
    const preset = state.view === 'calendar' ? state.selectedDate : null;
    openEntrySheet(null, preset);
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

  document.getElementById('openSignInBtn').addEventListener('click', handleOpenSignIn);
  document.getElementById('signOutBtn').addEventListener('click', handleSignOut);
  document.getElementById('newCategoryForm').addEventListener('submit', handleNewCategory);
  document.getElementById('budgetForm').addEventListener('submit', handleBudgetSubmit);
  document.getElementById('exportCsvBtn').addEventListener('click', handleExportCsv);

  document.querySelectorAll('.auth-tab').forEach((btn) => {
    btn.addEventListener('click', () => setAuthMode(btn.dataset.mode));
  });
  document.getElementById('authForm').addEventListener('submit', handleAuthSubmit);
  document.getElementById('continueOfflineBtn').addEventListener('click', handleContinueOffline);

  // Gestures
  makeSheetDraggable(
    document.getElementById('entryBackdrop'),
    document.getElementById('entryGrab'),
    closeEntrySheet);
  bindSwipeNavigation(document.getElementById('swipeArea'));

  // Escape closes the sheet, like every other dialog on the platform.
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
