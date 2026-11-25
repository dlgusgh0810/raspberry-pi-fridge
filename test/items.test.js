import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { MongoClient } from 'mongodb';
import { createApp, memoryItems } from '../server.js';

const uri = process.env.TEST_MONGODB_URI;

async function serve(t, items) {
  const fixedTime = () => new Date('2026-11-24T15:01:00Z');
  const server = createApp(items, 'Asia/Seoul', fixedTime).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve())));
  const base = 'http://127.0.0.1:' + server.address().port;

  return (path, method = 'GET', body) => fetch(base + path, {
    method,
    ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

async function checkItems(t, items, storage) {
  const request = await serve(t, items);
  const path = '/api/items';
  const tofu = { name: '두부', quantity: '1 모', location: '냉장', expires: '2026-11-28' };
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /오늘 먼저 먹을 식재료/);
  assert.equal((await request(path, 'POST', { ...tofu, expires: '2026-02-30' })).status, 400);
  assert.equal((await request(path, 'POST', { ...tofu, location: '기타' })).status, 400);

  async function add(item) {
    const response = await request(path, 'POST', item);
    assert.equal(response.status, 201);
    return (await response.json()).id;
  }

  const tofuId = await add(tofu);
  const eggId = await add({ ...tofu, name: '계란', expires: '2026-11-24' });
  const milkId = await add({ ...tofu, name: '우유', expires: '2026-11-25' });

  const response = await request(path);
  assert.equal(response.status, 200);
  const list = await response.json();
  assert.equal(list.today, '2026-11-25');
  assert.equal(list.storage, storage);
  assert.deepEqual(list.entries.map(({ id, daysLeft }) => [id, daysLeft]),
    [[eggId, -1], [milkId, 0], [tofuId, 3]]);

  assert.equal((await request(path + '/' + tofuId, 'PATCH', { consumed: true })).status, 204);
  assert.equal((await request(path + '/' + tofuId, 'PATCH', { ...tofu, quantity: '2 모' })).status, 204);
  const reopened = await serve(t, items);
  const updated = (await (await reopened(path)).json()).entries.find(item => item.id === tofuId);
  assert.equal(updated.quantity, '2 모');
  assert.equal(updated.consumed, true);
  assert.equal((await request(path + '/' + tofuId, 'PATCH', { consumed: false })).status, 204);
  assert.equal((await request(path + '/' + eggId, 'DELETE')).status, 204);
  assert.equal((await request(path + '/' + eggId, 'DELETE')).status, 404);
  assert.deepEqual((await (await request(path)).json()).entries.map(item => item.id), [milkId, tofuId]);
}

test('체험 모드 HTTP 등록, 목록, 날짜, 수정, 소비 완료, 삭제', t =>
  checkItems(t, memoryItems(), 'demo'));

test('MongoDB HTTP 등록, 목록, 날짜, 수정, 소비 완료, 삭제', { skip: !uri }, async t => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  const collection = client.db().collection('fridge_test_' + randomUUID());
  try {
    await client.connect();
    await checkItems(t, collection, 'mongodb');
    assert.equal(await collection.countDocuments(), 2);
  } finally {
    try {
      await collection.drop();
    } finally {
      await client.close();
    }
  }
});
