const byId = id => document.getElementById(id);
const editor = byId('editor');
const form = byId('item-form');
const submit = form.querySelector('[type=submit]');
const views = [...document.querySelectorAll('[data-view]')];
const locationFilters = [...document.querySelectorAll('[data-location]')];
const expiryFilters = [...document.querySelectorAll('[data-expiry]')];
const search = byId('item-search');
const selectedLocations = new Set();
const selectedExpiries = new Set();
const inventory = byId('inventory-title').closest('section');
let entries = [];
let view = 'active';
let editingId;
let registering = false;
let authPending = false;
let viewVersion = 0;
const authForm = byId('auth-form');
const authSubmit = authForm.querySelector('[type=submit]');
const passwordInput = authForm.elements.namedItem('password');
const authError = byId('auth-error');

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function api(path, method = 'GET', body) {
  const response = await fetch('/api' + path, {
    method,
    ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const { error } = await response.json().catch(() => ({}));
    if (response.status === 401 && path.startsWith('/items')) {
      showAuth();
      if (editor.open) editor.close();
    }
    throw new Error(error || '서버 요청에 실패했어요.');
  }
  return response.status === 204 ? undefined : response.json();
}

function request(path = '', method = 'GET', body) {
  return api('/items' + path, method, body);
}

function tell(message = '') {
  const notice = byId('notice');
  notice.textContent = message;
  notice.hidden = !message;
}

async function load() {
  const version = viewVersion;
  const data = await request();
  if (version !== viewVersion) return;
  entries = data.entries;
  const date = byId('today');
  date.dateTime = data.today;
  date.textContent = data.today.replaceAll('-', '.');
  if (data.storage === 'demo') byId('subtitle').textContent = '체험 모드 · 서버를 다시 시작하면 변경 사항이 초기화돼요.';
  render();
}

function status(item) {
  if (item.consumed) return ['소비 완료', 'done'];
  if (item.daysLeft < 0) return ['기한 경과', 'expired'];
  if (item.daysLeft === 0) return ['오늘까지', 'urgent'];
  return [`D-${item.daysLeft}`, item.daysLeft <= 3 ? 'urgent' : 'fresh'];
}

function button(label, run) {
  const control = element('button', label);
  control.type = 'button';
  control.addEventListener('click', run);
  return control;
}

function render() {
  const urgent = entries.filter(item => !item.consumed && isUrgent(item));
  const priority = byId('priority');
  priority.replaceChildren();
  if (urgent.length) {
    for (const item of urgent.slice(0, 3)) {
      const card = element('div', '', 'priority-card');
      card.append(element('strong', item.name), element('span', status(item)[0]));
      priority.append(card);
    }
  } else {
    priority.append(element('p', '3일 이내에 소비기한이 끝나는 식재료가 없어요.'));
  }

  renderItems();
}

function isUrgent(item) {
  return item.daysLeft >= 0 && item.daysLeft <= 3;
}

function renderItems() {
  const query = search.value.trim().normalize().toLowerCase();
  const visible = entries.filter(item => {
    if ((view === 'active' && item.consumed) || (view === 'consumed' && !item.consumed)) return false;
    const expiry = item.daysLeft < 0 ? 'expired' : isUrgent(item) ? 'urgent' : 'fresh';
    return (!selectedLocations.size || selectedLocations.has(item.location)) &&
      (!selectedExpiries.size || selectedExpiries.has(expiry)) &&
      item.name.normalize().toLowerCase().includes(query);
  });
  byId('count').textContent = `${visible.length}개`;
  const list = byId('items');
  list.replaceChildren();
  if (!visible.length) list.append(element('li', query || selectedLocations.size || selectedExpiries.size ? '조건에 맞는 식재료가 없어요.' : '표시할 식재료가 없어요.', 'empty'));
  for (const item of visible) {
    const [label, tone] = status(item);
    const row = element('li', '', 'item');
    const details = element('div', '', 'details');
    details.append(element('strong', item.name), element('small', `${item.quantity} · ${item.location} · ${item.expires}`));
    const actions = element('div', '', 'actions');
    actions.append(
      button(item.consumed ? '보관 복원' : '소비 완료', event => mutate(event.currentTarget, item, 'PATCH', { consumed: !item.consumed })),
      button('수정', () => edit(item)),
      button('삭제', event => {
        if (confirm(`${item.name} 항목을 삭제할까요?`)) mutate(event.currentTarget, item, 'DELETE');
      }),
    );
    row.append(details, element('span', label, `badge ${tone}`), actions);
    list.append(row);
  }
}

async function mutate(control, item, method, body) {
  control.disabled = true;
  tell();
  try {
    await request('/' + item.id, method, body);
    await load();
  } catch (error) {
    tell(error.message);
  } finally {
    control.disabled = false;
  }
}

function edit(item) {
  editingId = item?.id;
  form.reset();
  byId('form-error').hidden = true;
  byId('form-title').textContent = item ? '식재료 수정' : '식재료 등록';
  if (item) for (const key of ['name', 'quantity', 'location', 'expires']) form.elements.namedItem(key).value = item[key];
  editor.showModal();
}

byId('add').addEventListener('click', () => edit());
byId('cancel').addEventListener('click', () => editor.close());
editor.addEventListener('cancel', event => { if (submit.disabled) event.preventDefault(); });
function selectView(value) {
  view = value;
  for (const control of views) control.setAttribute('aria-pressed', control.dataset.view === value);
}

function renderFilteredItems() {
  // Keep the current scroll offset when the new results shorten the page.
  const visibleHeight = document.documentElement.clientHeight - inventory.getBoundingClientRect().top;
  inventory.style.minBlockSize = window.scrollY > 0 ? Math.max(0, Math.ceil(visibleHeight)) + 'px' : '';
  renderItems();
}

function resetFilters() {
  search.value = '';
  selectView('active');
  selectedLocations.clear();
  selectedExpiries.clear();
  for (const control of [...locationFilters, ...expiryFilters]) control.setAttribute('aria-pressed', 'false');
}

for (const control of views) control.addEventListener('click', () => {
  selectView(control.dataset.view);
  renderFilteredItems();
});

function bindFilters(controls, field, selection) {
  for (const control of controls) control.addEventListener('click', () => {
    const value = control.dataset[field];
    if (!selection.delete(value)) selection.add(value);
    control.setAttribute('aria-pressed', selection.has(value));
    renderFilteredItems();
  });
}

bindFilters(locationFilters, 'location', selectedLocations);
bindFilters(expiryFilters, 'expiry', selectedExpiries);
search.addEventListener('input', renderFilteredItems);
byId('reset-filters').addEventListener('click', () => {
  resetFilters();
  renderFilteredItems();
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  submit.disabled = byId('cancel').disabled = true;
  const errorText = byId('form-error');
  errorText.hidden = true;
  tell();
  try {
    const body = Object.fromEntries(new FormData(form));
    await request(editingId ? '/' + editingId : '', editingId ? 'PATCH' : 'POST', body);
    editor.close();
    await load();
  } catch (error) {
    if (editor.open) {
      errorText.textContent = error.message;
      errorText.hidden = false;
    } else tell(error.message);
  } finally {
    submit.disabled = byId('cancel').disabled = false;
  }
});

function showAuth() {
  viewVersion++;
  entries = [];
  render();
  byId('fridge').hidden = byId('logout').hidden = byId('today').hidden = true;
  byId('startup').hidden = true;
  byId('auth').hidden = false;
}

async function showFridge(demo = false) {
  viewVersion++;
  byId('auth').hidden = byId('startup').hidden = true;
  byId('fridge').hidden = byId('today').hidden = false;
  byId('logout').hidden = demo;
  inventory.style.minBlockSize = '';
  resetFilters();
  renderItems();
  tell();
  try {
    await load();
  } catch (error) {
    tell(error.message);
  }
}

byId('switch-auth').addEventListener('click', () => {
  registering = !registering;
  const title = registering ? '회원가입' : '로그인';
  byId('auth-title').textContent = authSubmit.textContent = title;
  byId('switch-auth').textContent = registering ? '로그인으로 돌아가기' : '회원가입';
  passwordInput.autocomplete = registering ? 'new-password' : 'current-password';
  passwordInput.minLength = registering ? 8 : 0;
  passwordInput.value = '';
  authError.hidden = true;
});

authForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (authPending) return;
  authPending = authSubmit.disabled = byId('switch-auth').disabled = true;
  authError.hidden = true;
  try {
    await api('/auth/' + (registering ? 'register' : 'login'), 'POST', Object.fromEntries(new FormData(authForm)));
    authForm.reset();
    await showFridge();
  } catch (error) {
    authError.textContent = error.message;
    authError.hidden = false;
  } finally {
    authPending = authSubmit.disabled = byId('switch-auth').disabled = false;
    if (registering && byId('auth').hidden) byId('switch-auth').click();
  }
});

byId('logout').addEventListener('click', async event => {
  const control = event.currentTarget;
  control.disabled = true;
  try {
    await api('/auth/logout', 'POST');
    showAuth();
  } catch (error) {
    tell(error.message);
  } finally {
    control.disabled = false;
  }
});

api('/auth/session').then(session => {
  if (session.demo || session.email) return showFridge(session.demo);
  showAuth();
}).catch(error => {
  byId('startup').textContent = error.message;
});
