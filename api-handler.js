import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'data', 'db.json');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function readDb() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const initial = {
        downloads: 20,
        baseRegisteredUsers: 7,
        users: [],
        downloadHistory: []
      };
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading database:', err);
    return { downloads: 20, baseRegisteredUsers: 7, users: [], downloadHistory: [] };
  }
}

function writeDb(db) {
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing database:', err);
  }
}

export function handleApiRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  // GET /api/stats
  if (method === 'GET' && pathname === '/api/stats') {
    const db = readDb();
    const totalUsers = (db.baseRegisteredUsers || 7) + (db.users ? db.users.length : 0);
    res.statusCode = 200;
    res.end(JSON.stringify({
      success: true,
      downloads: db.downloads || 20,
      registeredUsers: totalUsers,
      recentDownloads: (db.downloadHistory || []).slice(-5)
    }));
    return true;
  }

  // Parse Body helper
  function parseBody(callback) {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const json = body ? JSON.parse(body) : {};
        callback(json);
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, message: 'Geçersiz JSON verisi' }));
      }
    });
  }

  // POST /api/download-click
  if (method === 'POST' && pathname === '/api/download-click') {
    parseBody(data => {
      const db = readDb();
      db.downloads = (db.downloads || 0) + 1;
      if (!db.downloadHistory) db.downloadHistory = [];
      db.downloadHistory.push({
        time: new Date().toISOString(),
        platform: data.platform || 'Windows x64',
        version: '2.0.1'
      });
      // keep only last 100 history items
      if (db.downloadHistory.length > 100) {
        db.downloadHistory = db.downloadHistory.slice(-100);
      }
      writeDb(db);

      res.statusCode = 200;
      res.end(JSON.stringify({
        success: true,
        downloads: db.downloads,
        message: 'İndirme sayısı başarıyla güncellendi!'
      }));
    });
    return true;
  }

  // POST /api/auth/register
  if (method === 'POST' && pathname === '/api/auth/register') {
    parseBody(data => {
      const { username, email, password } = data;
      if (!username || username.trim().length < 3) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, message: 'Kullanıcı adı en az 3 karakter olmalıdır.' }));
        return;
      }
      if (!password || password.length < 4) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, message: 'Şifre en az 4 karakter olmalıdır.' }));
        return;
      }

      const db = readDb();
      if (!db.users) db.users = [];

      const existingUser = db.users.find(
        u => u.username.toLowerCase() === username.trim().toLowerCase() ||
             (email && u.email && u.email.toLowerCase() === email.trim().toLowerCase())
      );

      if (existingUser) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, message: 'Bu kullanıcı adı veya e-posta zaten kullanımda.' }));
        return;
      }

      const newUser = {
        id: 'usr_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
        username: username.trim(),
        email: email ? email.trim() : '',
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString(),
        isPro: true,
        role: 'VIP Geliştirici'
      };

      db.users.push(newUser);
      writeDb(db);

      const totalUsers = (db.baseRegisteredUsers || 7) + db.users.length;

      res.statusCode = 201;
      res.end(JSON.stringify({
        success: true,
        message: 'Kayıt başarıyla tamamlandı! 20.000 kod açıldı 🎉',
        registeredUsers: totalUsers,
        token: 'token_' + newUser.id,
        user: {
          id: newUser.id,
          username: newUser.username,
          email: newUser.email,
          role: newUser.role,
          isPro: true
        }
      }));
    });
    return true;
  }

  // POST /api/auth/login
  if (method === 'POST' && pathname === '/api/auth/login') {
    parseBody(data => {
      const { username, password } = data;
      if (!username || !password) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, message: 'Kullanıcı adı ve şifre gereklidir.' }));
        return;
      }

      const db = readDb();
      if (!db.users) db.users = [];

      const user = db.users.find(
        u => (u.username.toLowerCase() === username.trim().toLowerCase() ||
              (u.email && u.email.toLowerCase() === username.trim().toLowerCase())) &&
             u.passwordHash === hashPassword(password)
      );

      // Support built-in demo user if password is demo or demo123
      if (!user && username.toLowerCase() === 'demo' && (password === 'demo' || password === 'demo123')) {
        const demoUser = {
          id: 'usr_demo',
          username: 'demo',
          email: 'demo@lolimod.dev',
          role: 'VIP Modder',
          isPro: true
        };
        res.statusCode = 200;
        res.end(JSON.stringify({
          success: true,
          message: 'Giriş başarılı! 20.000 kod hazır.',
          token: 'token_demo',
          user: demoUser
        }));
        return;
      }

      if (!user) {
        res.statusCode = 401;
        res.end(JSON.stringify({ success: false, message: 'Kullanıcı adı veya şifre hatalı!' }));
        return;
      }

      res.statusCode = 200;
      res.end(JSON.stringify({
        success: true,
        message: 'Giriş başarılı! Hoş geldin ' + user.username,
        token: 'token_' + user.id,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role || 'VIP Geliştirici',
          isPro: true
        }
      }));
    });
    return true;
  }

  // GET /api/auth/me
  if (method === 'GET' && pathname === '/api/auth/me') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();

    if (!token || !token.startsWith('token_')) {
      res.statusCode = 401;
      res.end(JSON.stringify({ success: false, authenticated: false }));
      return true;
    }

    const userId = token.replace('token_', '');
    if (userId === 'demo') {
      res.statusCode = 200;
      res.end(JSON.stringify({
        success: true,
        authenticated: true,
        user: {
          id: 'usr_demo',
          username: 'demo',
          email: 'demo@lolimod.dev',
          role: 'VIP Modder',
          isPro: true
        }
      }));
      return true;
    }

    const db = readDb();
    const user = (db.users || []).find(u => u.id === userId);
    if (!user) {
      res.statusCode = 401;
      res.end(JSON.stringify({ success: false, authenticated: false }));
      return true;
    }

    res.statusCode = 200;
    res.end(JSON.stringify({
      success: true,
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role || 'VIP Geliştirici',
        isPro: true
      }
    }));
    return true;
  }

  return false;
}
