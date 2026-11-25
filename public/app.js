const byId = id => document.getElementById(id);
const editor = byId('editor');
const form = byId('item-form');
const submit = form.querySelector('[type=submit]');
const filters = [...document.querySelectorAll('[data-filter]')];
const icons = { 냉장: '❄', 냉동: '◈', 실온: '☼' };
let entries = [];
let filter = 'active';
let editingId;

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function request(path = '', method = 'GET', body) {
  const response = await fetch('/api/items' + path, {
    method,
    ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const { error } = await response.json().catch(() => ({}));
    throw new Error(error || '서버 요청에 실패했어요.');
  }
  return response.status === 204 ? undefined : response.json();
}

function tell(message = '') {
  const notice = byId('notice');
  notice.textContent = message;
  notice.hidden = !message;
}

async function load() {
  const data = await request();
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
  const active = entries.filter(item => !item.consumed);
  const urgent = active.filter(item => item.daysLeft >= 0 && item.daysLeft <= 3);
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

  const visible = {
    active, urgent,
    expired: active.filter(item => item.daysLeft < 0),
    consumed: entries.filter(item => item.consumed),
  }[filter];
  byId('count').textContent = `${visible.length}개`;
  const list = byId('items');
  list.replaceChildren();
  if (!visible.length) list.append(element('li', '표시할 식재료가 없어요.', 'empty'));
  for (const item of visible) {
    const [label, tone] = status(item);
    const row = element('li', '', 'item');
    const marker = element('span', icons[item.location], 'marker');
    marker.setAttribute('aria-hidden', 'true');
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
    row.append(marker, details, element('span', label, `badge ${tone}`), actions);
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
for (const control of filters) control.addEventListener('click', () => {
  filter = control.dataset.filter;
  for (const option of filters) option.setAttribute('aria-pressed', option === control);
  render();
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
    if (!editingId) filters[0].click();
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

load().catch(error => tell(error.message));
