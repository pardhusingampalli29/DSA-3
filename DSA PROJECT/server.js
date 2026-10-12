const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname);
const accountsFile = path.join(root, 'accounts.json');
const port = 5500;
const sessions = new Map();
const publicFiles = new Map([
  ['/','index.html'], ['/index.html','index.html'], ['/styles.css','styles.css'], ['/app.js','app.js']
]);
const fileTypes = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8' };

function sendJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...extraHeaders });
  response.end(JSON.stringify(body));
}
function getCookie(request, name) {
  const part = (request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return part ? part.slice(name.length + 1) : '';
}
async function readAccounts() {
  try {
    const accounts = JSON.parse(await fs.readFile(accountsFile, 'utf8'));
    return Array.isArray(accounts) ? accounts : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
async function writeAccounts(accounts) {
  const temporary = `${accountsFile}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(accounts, null, 2), { mode: 0o600 });
  await fs.rename(temporary, accountsFile);
}
function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 8192) {
        reject(new Error('Request is too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid request data')); }
    });
    request.on('error', reject);
  });
}
function currentUser(request, accounts) {
  const token = getCookie(request, 'rd_session');
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  const account = accounts.find(item => item.email === session.email);
  return account ? { id: account.id, name: account.name, email: account.email } : null;
}
function createSession(email) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { email, expires: Date.now() + 8 * 60 * 60 * 1000 });
  return `rd_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`;
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

async function handleApi(request, response, pathname) {
  if (pathname === '/api/me' && request.method === 'GET') {
    const account = currentUser(request, await readAccounts());
    return account ? sendJson(response, 200, { user: account }) : sendJson(response, 401, { error: 'Please log in.' });
  }
  if (pathname === '/api/logout' && request.method === 'POST') {
    const token = getCookie(request, 'rd_session');
    sessions.delete(token);
    return sendJson(response, 200, { ok: true }, { 'Set-Cookie':'rd_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if ((pathname !== '/api/register' && pathname !== '/api/login') || request.method !== 'POST') {
    return sendJson(response, 404, { error:'Endpoint not found.' });
  }

  if (request.headers.origin) {
    const origin = new URL(request.headers.origin).host;
    if (origin !== request.headers.host) return sendJson(response, 403, { error:'Request origin was rejected.' });
  }
  if (!String(request.headers['content-type'] || '').startsWith('application/json')) {
    return sendJson(response, 415, { error:'Send the form as JSON.' });
  }
  let input;
  try { input = await readJson(request); }
  catch (error) { return sendJson(response, error.message === 'Request is too large' ? 413 : 400, { error:error.message }); }

  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return sendJson(response, 400, { error:'Enter a valid email address.' });
  }
  const accounts = await readAccounts();
  if (pathname === '/api/register') {
    const name = String(input.name || '').trim();
    if (name.length < 2 || name.length > 60) return sendJson(response, 400, { error:'Enter a name between 2 and 60 characters.' });
    if (password.length < 8 || password.length > 128) return sendJson(response, 400, { error:'Use a password between 8 and 128 characters.' });
    if (accounts.some(account => account.email === email)) return sendJson(response, 409, { error:'An account with that email already exists. Log in instead.' });
    const credentials = hashPassword(password);
    const account = { id: crypto.randomUUID(), name, email, salt:credentials.salt, passwordHash:credentials.hash, createdAt:new Date().toISOString() };
    accounts.push(account);
    await writeAccounts(accounts);
    return sendJson(response, 201, { user:{ id:account.id, name:account.name, email:account.email } }, { 'Set-Cookie':createSession(email) });
  }

  const account = accounts.find(item => item.email === email);
  if (!account) return sendJson(response, 401, { error:'Email or password is incorrect.' });
  const attemptedHash = crypto.scryptSync(password, account.salt, 64);
  const savedHash = Buffer.from(account.passwordHash, 'hex');
  if (attemptedHash.length !== savedHash.length || !crypto.timingSafeEqual(attemptedHash, savedHash)) {
    return sendJson(response, 401, { error:'Email or password is incorrect.' });
  }
  return sendJson(response, 200, { user:{ id:account.id, name:account.name, email:account.email } }, { 'Set-Cookie':createSession(email) });
}

http.createServer(async (request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { return sendJson(response, 400, { error:'Bad request.' }); }

  if (pathname.startsWith('/api/')) {
    try { return await handleApi(request, response, pathname); }
    catch (error) {
      console.error('Request failed:', error);
      if (!response.headersSent) return sendJson(response, 500, { error:'The request could not be completed.' });
      return response.end();
    }
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { 'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store' });
    return response.end('Method not allowed');
  }
  const filename = publicFiles.get(pathname);
  if (!filename) {
    response.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store' });
    return response.end('Page not found');
  }
  try {
    const data = await fs.readFile(path.join(root, filename));
    response.writeHead(200, { 'Content-Type':fileTypes[path.extname(filename)], 'X-Content-Type-Options':'nosniff', 'Cache-Control':'no-store' });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch (error) {
    console.error('Could not read site file:', error);
    response.writeHead(500, { 'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store' });
    response.end('Unable to open this file');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`RouteDesk is running at http://localhost:${port}`);
});
