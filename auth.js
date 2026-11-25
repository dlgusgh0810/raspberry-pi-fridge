import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { rateLimit } from 'express-rate-limit';

const derive = promisify(scrypt);
const cookieName = 'fridge_session';
const sessionAge = 7 * 24 * 60 * 60 * 1000;
const invalid = '이메일 또는 비밀번호를 확인해 주세요.';

function readCredentials(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = body?.password;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof password !== 'string' || password.length > 128) return null;
  return { email, password };
}

function tokenId(token) {
  return createHash('sha256').update(token).digest('hex');
}

function sessionToken(req) {
  const cookie = req.get('cookie')?.split(';').find(part => part.trim().startsWith(cookieName + '='));
  const token = cookie?.trim().slice(cookieName.length + 1);
  return /^[a-f0-9]{64}$/.test(token ?? '') ? token : null;
}

export function installAuth(app, { users, sessions, secure }) {
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure, path: '/' };
  const limit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: '시도가 너무 많아요. 잠시 후 다시 시도해 주세요.' },
  });

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.get('origin');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        (req.get('sec-fetch-site') === 'cross-site' ||
        (origin && origin !== (secure ? 'https://' : 'http://') + req.get('host')))) {
      return res.status(403).json({ error: '같은 사이트에서 다시 시도해 주세요.' });
    }
    next();
  });

  async function readSession(req) {
    const token = sessionToken(req);
    if (!token) return null;
    return sessions.findOne({ _id: tokenId(token), expiresAt: { $gt: new Date() } });
  }

  async function signIn(req, res, email) {
    const oldToken = sessionToken(req);
    if (oldToken) await sessions.deleteOne({ _id: tokenId(oldToken) });
    const token = randomBytes(32).toString('hex');
    await sessions.insertOne({ _id: tokenId(token), email, expiresAt: new Date(Date.now() + sessionAge) });
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: sessionAge });
    res.status(200).json({ email });
  }

  app.post('/api/auth/register', limit, async (req, res) => {
    const credentials = readCredentials(req.body);
    if (!credentials || credentials.password.length < 8) {
      return res.status(400).json({ error: '이메일과 8~128자 비밀번호를 입력해 주세요.' });
    }
    const { email, password } = credentials;
    const salt = randomBytes(16).toString('hex');
    const hash = (await derive(password, salt, 64)).toString('hex');
    try {
      await users.insertOne({ _id: email, salt, hash });
    } catch (error) {
      if (error.code !== 11000) throw error;
      return res.status(409).json({ error: '이미 가입한 이메일이에요.' });
    }
    await signIn(req, res, email);
  });

  app.post('/api/auth/login', limit, async (req, res) => {
    const credentials = readCredentials(req.body);
    if (!credentials) return res.status(401).json({ error: invalid });
    const { email, password } = credentials;
    const user = await users.findOne({ _id: email });
    const actual = await derive(password, user?.salt ?? 'missing-account', 64);
    const expected = user ? Buffer.from(user.hash, 'hex') : Buffer.alloc(64);
    if (!timingSafeEqual(actual, expected) || !user) {
      return res.status(401).json({ error: invalid });
    }
    await signIn(req, res, email);
  });

  app.get('/api/auth/session', async (req, res) => {
    res.json({ email: (await readSession(req))?.email ?? null });
  });

  app.post('/api/auth/logout', async (req, res) => {
    const token = sessionToken(req);
    if (token) await sessions.deleteOne({ _id: tokenId(token) });
    res.clearCookie(cookieName, cookieOptions).sendStatus(204);
  });

  app.use('/api/items', async (req, res, next) => {
    const session = await readSession(req);
    if (!session) return res.status(401).json({ error: '로그인해 주세요.' });
    req.owner = { owner: session.email };
    next();
  });
}
