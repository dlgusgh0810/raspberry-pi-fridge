import express from 'express';
import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DAY = 86_400_000;
const locations = ['냉장', '냉동', '실온'];

export function createApp(items, timezone = 'Asia/Seoul', now = () => new Date()) {
  const dateFormat = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const today = () => dateFormat.format(now());
  const app = express();
  app.use(express.json({ limit: '8kb' }));
  app.use(express.static(fileURLToPath(new URL('./public/', import.meta.url))));

  app.get('/api/items', async (_req, res) => {
    const date = today();
    const entries = (await items.find().sort({ expires: 1, _id: 1 }).toArray()).map(({ _id, ...item }) => ({
      ...item,
      id: _id,
      daysLeft: (Date.parse(item.expires) - Date.parse(date)) / DAY,
    }));
    res.json({ today: date, storage: items.storage ?? 'mongodb', entries });
  });

  app.post('/api/items', async (req, res) => {
    const item = readItem(req.body);
    if (!item) return res.status(400).json({ error: '식재료명, 수량, 보관 장소, 소비기한을 확인해 주세요.' });
    const id = randomUUID();
    await items.insertOne({ ...item, _id: id, consumed: false });
    res.status(201).json({ id });
  });

  app.patch('/api/items/:id', async (req, res) => {
    const body = req.body;
    const update = body && Object.keys(body).length === 1 && typeof body.consumed === 'boolean'
      ? { consumed: body.consumed }
      : readItem(body);
    if (!update) return res.status(400).json({ error: '수정할 정보를 확인해 주세요.' });
    const result = await items.updateOne({ _id: req.params.id }, { $set: update });
    if (!result.matchedCount) return res.status(404).json({ error: '식재료를 찾을 수 없어요.' });
    res.sendStatus(204);
  });

  app.delete('/api/items/:id', async (req, res) => {
    const result = await items.deleteOne({ _id: req.params.id });
    if (!result.deletedCount) return res.status(404).json({ error: '식재료를 찾을 수 없어요.' });
    res.sendStatus(204);
  });

  app.use((error, _req, res, _next) => {
    if (error.status === 400 || error.status === 413) {
      return res.status(error.status).json({ error: '요청 형식이나 크기를 확인해 주세요.' });
    }
    console.error(error.name);
    res.status(500).json({ error: '처리 중 오류가 발생했어요. 다시 시도해 주세요.' });
  });
  return app;
}

function readItem(body) {
  const { name, quantity, location, expires } = body ?? {};
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 60 ||
      typeof quantity !== 'string' || !quantity.trim() || quantity.trim().length > 30 ||
      !locations.includes(location) || typeof expires !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return null;
  const date = new Date(expires);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== expires || expires.startsWith('0000')) return null;
  return { name: name.trim(), quantity: quantity.trim(), location, expires };
}

export function memoryItems(initial = []) {
  const entries = new Map(initial.map(item => [item._id, item]));
  return {
    storage: 'demo',
    find: () => ({
      sort: () => ({
        toArray: async () => [...entries.values()].sort((a, b) =>
          a.expires.localeCompare(b.expires) || a._id.localeCompare(b._id)),
      }),
    }),
    insertOne: async item => entries.set(item._id, item),
    updateOne: async ({ _id }, { $set }) => {
      const entry = entries.get(_id);
      if (entry) Object.assign(entry, $set);
      return { matchedCount: Number(Boolean(entry)) };
    },
    deleteOne: async ({ _id }) => ({ deletedCount: Number(entries.delete(_id)) }),
  };
}

function samples(timezone) {
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, dateStyle: 'short' }).format(new Date());
  return [
    ['딸기', '1 팩', '냉장', -1],
    ['우유', '1 병', '냉장', 0],
    ['두부', '1 모', '냉장', 2],
    ['계란', '6 개', '냉장', 8],
    ['냉동 만두', '1 봉지', '냉동', 21],
    ['파스타면', '500 g', '실온', 35],
  ].map(([name, quantity, location, offset]) => ({
    _id: randomUUID(), name, quantity, location, consumed: false,
    expires: new Date(Date.parse(date) + offset * DAY).toISOString().slice(0, 10),
  }));
}

async function start() {
  const timezone = process.env.APP_TIMEZONE || 'Asia/Seoul';
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3000);
  const uri = process.env.MONGODB_URI;
  const demo = process.argv.includes('--demo');
  if (!demo && !uri) throw new Error('MONGODB_URI를 .env에 설정하세요.');
  if (demo && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('데모 모드는 로컬 주소에서 실행하세요.');
  }
  const client = demo ? null : new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    if (client) {
      await client.connect();
      await client.db(process.env.MONGODB_DATABASE || 'home_fridge').command({ ping: 1 });
    }
    const items = client
      ? client.db(process.env.MONGODB_DATABASE || 'home_fridge').collection('items')
      : memoryItems(samples(timezone));
    const server = createApp(items, timezone).listen(port, host, () => {
      console.log(`우리집 냉장고 · ${host}:${server.address().port} · ${client ? 'MongoDB' : 'demo'}`);
    });
    server.on('error', async error => {
      console.error('웹 서버 시작 실패', error.code);
      await client?.close();
      process.exitCode = 1;
    });
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => server.close(async () => { await client?.close(); }));
    }
  } catch (error) {
    await client?.close();
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start().catch(error => {
    console.error('시작 실패', error.name, error.name.startsWith('Mongo') ? 'MongoDB 연결 설정을 확인하세요.' : error.message);
    process.exitCode = 1;
  });
}
