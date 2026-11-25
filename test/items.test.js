import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { createApp, memoryItems } from '../server.js';

const uri = process.env.TEST_MONGODB_URI;

async function serve(t, items, auth) {
  const fixedTime = () => new Date('2026-11-24T15:01:00Z');
  const server = createApp(items, 'Asia/Seoul', fixedTime, auth).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve())));
  const base = 'http://127.0.0.1:' + server.address().port;

  return async (path, method = 'GET', body, cookie) => fetch(base + path, {
    method,
    headers: {
      ...(body && { 'Content-Type': 'application/json' }),
      ...(cookie && { Cookie: cookie }),
    },
    ...(body && { body: JSON.stringify(body) }),
  });
}

async function checkItems(t, items, storage, auth, cookie) {
  const call = await serve(t, items, auth);
  const request = (path, method, body) => call(path, method, body, cookie);
  const path = '/api/items';
  const tofu = { name: '두부', quantity: '1 모', location: '냉장', expires: '2026-11-28' };
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /오늘 먼저 먹을 식재료/);
  assert.equal((await request(path, 'POST', { ...tofu, expires: '2026-02-30' })).status, 400);
  assert.equal((await request(path, 'POST', { ...tofu, location: '기타' })).status, 400);

  assert.equal((await request(path, 'POST', { ...tofu, category: '잘못된 분류' })).status, 400);

  async function add(item) {
    const response = await request(path, 'POST', item);
    assert.equal(response.status, 201);
    return (await response.json()).id;
  }

  const tofuId = await add({ ...tofu, category: '가공식품' });
  const eggId = await add({ ...tofu, name: '계란', expires: '2026-11-24' });
  const milkId = await add({ ...tofu, name: '우유', expires: '2026-11-25' });

  const response = await request(path);
  assert.equal(response.status, 200);
  const list = await response.json();
  assert.equal(list.today, '2026-11-25');
  assert.equal(list.storage, storage);
  assert.equal(list.entries.find(item => item.id === tofuId).category, '가공식품');
  assert.equal(list.entries.find(item => item.id === milkId).category, '기타');
  assert.deepEqual(list.entries.map(({ id, daysLeft }) => [id, daysLeft]),
    [[eggId, -1], [milkId, 0], [tofuId, 3]]);

  assert.equal((await request(path + '/' + tofuId, 'PATCH', { consumed: true })).status, 204);
  assert.equal((await request(path + '/' + tofuId, 'PATCH', { ...tofu, quantity: '2 모' })).status, 204);
  const reopened = await serve(t, items, auth);
  const updated = (await (await reopened(path, 'GET', undefined, cookie)).json()).entries.find(item => item.id === tofuId);
  assert.equal(updated.category, '가공식품');
  assert.equal(updated.quantity, '2 모');
  assert.equal((await request(path + '/' + tofuId, 'PATCH', { ...tofu, category: '양념' })).status, 204);
  assert.equal((await (await request(path)).json()).entries.find(item => item.id === tofuId).category, '양념');
  assert.equal(updated.consumed, true);
  assert.equal((await request(path + '/' + tofuId, 'PATCH', { consumed: false })).status, 204);
  assert.equal((await request(path + '/' + eggId, 'DELETE')).status, 204);
  assert.equal((await request(path + '/' + eggId, 'DELETE')).status, 404);
  assert.deepEqual((await (await request(path)).json()).entries.map(item => item.id), [milkId, tofuId]);
}

test('체험 모드 HTTP 등록, 목록, 날짜, 수정, 소비 완료, 삭제', t =>
  checkItems(t, memoryItems(), 'demo'));

test('분류 필드가 없는 기존 식재료는 기타로 표시', async t => {
  const request = await serve(t, memoryItems([{ _id: 'legacy', expires: '2026-11-25' }]));
  const response = await request('/api/items');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).entries[0].category, '기타');
});

test('MongoDB 회원가입, 자동 로그인, 식재료 CRUD 및 계정 격리', { skip: !uri }, async t => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  const db = client.db();
  const suffix = randomUUID();
  const collection = db.collection('fridge_test_' + suffix);
  const users = db.collection('fridge_users_test_' + suffix);
  const sessions = db.collection('fridge_sessions_test_' + suffix);
  const auth = { users, sessions, secure: false };
  try {
    await client.connect();
    const call = await serve(t, collection, auth);
    const a = { email: 'first@example.test', password: 'dinner-pass-123' };
    const b = { ...a, email: 'second@example.test' };
    const path = '/api/items';
    assert.equal((await call(path)).status, 401);
    const register = credentials => call('/api/auth/register', 'POST', credentials);
    const account = await register(a);
    assert.equal(account.status, 200);
    const cookieHeader = account.headers.get('set-cookie');
    assert.match(cookieHeader, /HttpOnly/);
    assert.match(cookieHeader, /SameSite=Strict/);
    const cookie = cookieHeader.split(';')[0];
    assert.equal((await register(a)).status, 409);
    const session = await call('/api/auth/session', 'GET', undefined, cookie);
    assert.deepEqual(await session.json(), { email: a.email });
    const user = await users.findOne({ _id: a.email });
    assert.equal(user.hash.length, 128);
    assert.equal(user.password, undefined);

    await collection.insertOne({ _id: 'legacy', name: '기존 재료', expires: '2026-11-25' });
    await checkItems(t, collection, 'mongodb', auth, cookie);
    const owned = await collection.find({ owner: a.email }).toArray();
    assert.equal(owned.length, 2);
    const other = await register(b);
    assert.equal(other.status, 200);
    const otherCookie = other.headers.get('set-cookie').split(';')[0];
    const otherList = await call(path, 'GET', undefined, otherCookie);
    assert.deepEqual((await otherList.json()).entries, []);
    assert.equal((await call(path + '/' + owned[0]._id, 'PATCH', { consumed: true }, otherCookie)).status, 404);
    assert.equal((await call(path + '/' + owned[0]._id, 'DELETE', undefined, otherCookie)).status, 404);

    assert.equal((await call('/api/auth/logout', 'POST', undefined, cookie)).status, 204);
    assert.equal((await call(path, 'GET', undefined, cookie)).status, 401);
    assert.equal((await call('/api/auth/login', 'POST', { ...a, password: 'wrong-pass' })).status, 401);
    const signedIn = await call('/api/auth/login', 'POST', a);
    assert.equal(signedIn.status, 200);
    const signedInCookie = signedIn.headers.get('set-cookie').split(';')[0];
    const saved = await call(path, 'GET', undefined, signedInCookie);
    assert.equal((await saved.json()).entries.length, 2);
  } finally {
    try {
      await Promise.all([collection, users, sessions].map(table => table.drop()));
    } finally {
      await client.close();
    }
  }
});
