import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import worker from '../src/duitku-sandbox-worker.js';

const base = 'https://bor-ai-duitku-sandbox.example.test';
const key = 'synthetic-API-key-not-a-real-credential';
const operator = 'synthetic-operator-secret-at-least-32-characters';
const sign = value => createHmac('sha256', key).update(value).digest('hex');
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(new URL('../sandbox/duitku/migrations/0001_orders.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => sqlite.prepare(sql).get(...args) || null,
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } })
  });
  const calls = [];
  const control = { status: '00', failInvoice: false, failStatus: false, wrongStatus: {}, invoiceUrl: 'https://sandbox.duitku.com/topup/topupdirectv2.aspx?ref=TESTREF' };
  const env = { PAYMENT_SANDBOX_ENABLED: 'true', DUITKU_SANDBOX_MERCHANT_CODE: 'DS38217',
    DUITKU_SANDBOX_API_KEY: key, DUITKU_SANDBOX_OPERATOR_TOKEN: operator, SANDBOX_PUBLIC_ORIGIN: base,
    SANDBOX_DB: { prepare: sql => statement(sql) },
    DUITKU_FETCHER: async (url, options) => {
      const data = JSON.parse(options.body); calls.push({ url, options, data });
      assert.ok(url.startsWith('https://sandbox.duitku.com/webapi/api/merchant/'));
      assert.equal(options.redirect, 'error');
      if (url.endsWith('v2/inquiry')) {
        assert.equal(data.signature, sign('DS38217' + data.merchantOrderId + '10000'));
        assert.equal(data.callbackUrl, base + '/api/duitku/callback');
        if (control.failInvoice) throw Error(key + ' private provider output');
        return Response.json({ merchantCode: 'DS38217', statusCode: '00', reference: 'REF-' + data.merchantOrderId,
          amount: '10000', paymentUrl: control.invoiceUrl });
      }
      assert.ok(url.endsWith('transactionStatus'));
      assert.equal(data.signature, sign('DS38217' + data.merchantOrderId));
      if (control.failStatus) throw Error(key + ' private provider output');
      return Response.json({ merchantOrderId: data.merchantOrderId, amount: '10000', reference: 'REF-' + data.merchantOrderId,
        statusCode: control.status, ...control.wrongStatus });
    }
  };
  const input = () => ({ requestId: randomUUID(), email: 'operator@example.test', customerName: 'BOR AI Test' });
  const request = (path, body, authenticated = true, method = body ? 'POST' : 'GET') => new Request(base + path, {
    method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(authenticated ? { Authorization: 'Bearer ' + operator } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const create = (body = input()) => worker.fetch(request('/api/sandbox/checkout', body), env);
  const callback = async (id, overrides = {}) => {
    const form = new URLSearchParams({ merchantCode: 'DS38217', amount: '10000', merchantOrderId: id, reference: 'REF-' + id,
      resultCode: '00', signature: sign('DS38217' + '10000' + id), ...overrides });
    return worker.fetch(new Request(base + '/api/duitku/callback', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form }), env);
  };
  const row = id => sqlite.prepare('SELECT * FROM duitku_sandbox_orders WHERE id=?').get(id);
  const grants = () => sqlite.prepare('SELECT * FROM duitku_sandbox_credit_ledger').all();
  const unlock = id => sqlite.prepare('UPDATE duitku_sandbox_orders SET verify_after=0 WHERE id=?').run(id);
  return { sqlite, env, calls, control, input, request, create, callback, row, grants, unlock, close: () => sqlite.close() };
}

test('Duitku sandbox refuses missing secrets, disabled flags and production merchant codes', async () => {
  const h = setup(); try {
    for (const changes of [{ DUITKU_SANDBOX_API_KEY: '' }, { DUITKU_SANDBOX_OPERATOR_TOKEN: 'short' }, { PAYMENT_SANDBOX_ENABLED: 'false' }, { DUITKU_SANDBOX_MERCHANT_CODE: 'D12345' }, { SANDBOX_DB: undefined }]) {
      const response = await worker.fetch(h.request('/api/sandbox/checkout', h.input()), { ...h.env, ...changes });
      assert.equal(response.status, 503);
    }
    assert.equal(h.calls.length, 0);
    const health = await (await worker.fetch(h.request('/health'), h.env)).json();
    assert.equal(health.configured, true); assert.equal(health.realPaymentsEnabled, false);
  } finally { h.close(); }
});
test('operator authentication is required for checkout, order inspection and reconciliation', async () => {
  const h = setup(); try {
    for (const path of ['/api/sandbox/checkout', '/api/sandbox/orders/BORTEST-' + randomUUID(), '/api/sandbox/orders/BORTEST-' + randomUUID() + '/reconcile']) {
      assert.equal((await worker.fetch(h.request(path, h.input(), false), h.env)).status, 401);
    }
    assert.equal(h.calls.length, 0);
  } finally { h.close(); }
});
test('fixed sandbox checkout is signed, private, capped and idempotent under concurrent requests', async () => {
  const h = setup(); try {
    const input = h.input();
    const responses = await Promise.all([h.create(input), h.create(input)]);
    assert.ok(responses.some(response => response.status === 201));
    assert.equal(h.calls.length, 1);
    const order = await (await h.create(input)).json();
    assert.equal(order.status, 'pending'); assert.equal(order.amountIdr, 10000); assert.equal(order.realCreditsGranted, false);
    assert.equal((await h.create({ ...input, customerName: 'Different' })).status, 409);
    assert.equal((await h.create({ ...h.input(), amount: 1 })).status, 400);
    assert.doesNotMatch(JSON.stringify(h.row(order.orderId)), /operator@example|BOR AI Test/);
    for (let i = 0; i < 9; i++) assert.equal((await h.create()).status, 201);
    assert.equal((await h.create()).status, 429);
    assert.equal(h.calls.length, 10);
  } finally { h.close(); }
});
test('verified callback settles once and duplicate/concurrent callbacks cannot duplicate test credits', async () => {
  const h = setup(); try {
    const order = await (await h.create()).json();
    const responses = await Promise.all([h.callback(order.orderId), h.callback(order.orderId)]);
    assert.ok(responses.some(response => response.status === 200));
    assert.equal(h.row(order.orderId).status, 'paid'); assert.equal(h.grants().length, 1);
    assert.equal((await h.callback(order.orderId)).status, 200);
    assert.equal(h.calls.filter(call => call.url.endsWith('transactionStatus')).length, 1);
    assert.throws(() => h.sqlite.prepare("UPDATE duitku_sandbox_orders SET status='pending'").run(), /sandbox_paid_is_terminal/);
    assert.deepEqual(h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name).sort(), ['duitku_sandbox_credit_ledger', 'duitku_sandbox_orders']);
  } finally { h.close(); }
});
test('forged or altered callback identity, amount, reference and unknown orders never settle', async () => {
  const h = setup(); try {
    const order = await (await h.create()).json();
    for (const [override, expected] of [[{ signature: '0'.repeat(64) },403], [{ signature: 'a'.repeat(32) },403], [{ merchantCode: 'D38217' },400], [{ amount: '9999' },400], [{ reference: 'WRONG' },409]]) {
      assert.equal((await h.callback(order.orderId, override)).status, expected);
    }
    assert.equal((await h.callback('BORTEST-' + randomUUID())).status, 404);
    assert.equal(h.calls.length, 1); assert.equal(h.grants().length, 0);
  } finally { h.close(); }
});
test('browser redirect parameters and unsigned callback result codes never authorize credits', async () => {
  const h = setup(); try {
    const order = await (await h.create()).json();
    const redirect = await worker.fetch(h.request('/return?resultCode=00&merchantOrderId=' + order.orderId), h.env);
    assert.equal((await redirect.json()).realCreditsGranted, false); assert.equal(h.grants().length, 0);
    h.control.status = '01';
    assert.equal((await h.callback(order.orderId, { resultCode: '00' })).status, 503);
    assert.equal(h.grants().length, 0);
    h.unlock(order.orderId); h.control.status = '00';
    assert.equal((await h.callback(order.orderId, { resultCode: '01' })).status, 200);
    assert.equal(h.grants().length, 1);
  } finally { h.close(); }
});
test('provider outages and mismatched status order, amount or reference cannot grant credits', async () => {
  const h = setup(); try {
    const order = await (await h.create()).json();
    h.control.failStatus = true;
    const response = await h.callback(order.orderId); assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /synthetic-API|private provider/);
    h.control.failStatus = false;
    for (const wrong of [{ merchantOrderId: 'another-order' }, { amount: '10001' }, { reference: 'different' }, { statusCode: 'unknown' }]) {
      h.unlock(order.orderId); h.control.wrongStatus = wrong;
      assert.equal((await h.callback(order.orderId)).status, 502);
    }
    assert.equal(h.row(order.orderId).status, 'pending'); assert.equal(h.grants().length, 0);
  } finally { h.close(); }
});
test('a failed status can later recover to verified paid, while paid never downgrades', async () => {
  const h = setup(); try {
    const order = await (await h.create()).json(); h.control.status = '02';
    assert.equal((await h.callback(order.orderId, { resultCode: '01' })).status, 200);
    assert.equal(h.row(order.orderId).status, 'failed'); assert.equal(h.grants().length, 0);
    h.unlock(order.orderId); h.control.status = '00';
    assert.equal((await h.callback(order.orderId)).status, 200);
    h.control.status = '02';
    assert.equal((await h.callback(order.orderId, { resultCode: '01' })).status, 200);
    assert.equal(h.row(order.orderId).status, 'paid'); assert.equal(h.grants().length, 1);
  } finally { h.close(); }
});
test('ambiguous invoice creation is never retried and reconciliation recovers its original order', async () => {
  const h = setup(); try {
    const input = h.input(); h.control.failInvoice = true;
    assert.equal((await h.create(input)).status, 502);
    assert.equal((await h.create(input)).status, 409); assert.equal(h.calls.length, 1);
    const id = 'BORTEST-' + input.requestId;
    assert.equal(h.row(id).status, 'provider_unknown');
    const response = await worker.fetch(h.request('/api/sandbox/orders/' + id + '/reconcile', undefined, true, 'POST'), h.env);
    assert.equal(response.status, 200); assert.equal(h.row(id).status, 'paid'); assert.equal(h.grants().length, 1);
  } finally { h.close(); }
});
test('SQL ledger failure rolls back payment settlement and remains recoverable', async () => {
  const h = setup(); try {
    const order = await (await h.create()).json();
    h.sqlite.exec("CREATE TRIGGER injected_failure BEFORE INSERT ON duitku_sandbox_credit_ledger BEGIN SELECT RAISE(ABORT,'injected'); END;");
    assert.equal((await h.callback(order.orderId)).status, 503);
    assert.equal(h.row(order.orderId).status, 'pending'); assert.equal(h.grants().length, 0);
    h.sqlite.exec('DROP TRIGGER injected_failure'); h.unlock(order.orderId);
    assert.equal((await h.callback(order.orderId)).status, 200); assert.equal(h.grants().length, 1);
  } finally { h.close(); }
});
test('callback before invoice acknowledgement cannot be downgraded by late checkout completion', async () => {
  const h = setup(); try {
    const original = h.env.DUITKU_FETCHER;
    h.env.DUITKU_FETCHER = async (url, options) => {
      const response = await original(url, options);
      if (url.endsWith('v2/inquiry')) {
        const id = JSON.parse(options.body).merchantOrderId;
        assert.equal((await h.callback(id)).status, 200);
      }
      return response;
    };
    const order = await (await h.create()).json();
    assert.equal(order.status, 'paid'); assert.ok(order.paymentUrl); assert.equal(h.grants().length, 1);
  } finally { h.close(); }
});
test('untrusted payment URLs, oversized bodies and duplicate callback parameters fail closed', async () => {
  const h = setup(); try {
    h.control.invoiceUrl = 'https://passport.duitku.com/real-payment';
    assert.equal((await h.create()).status, 502);
    assert.equal((await h.create({ ...h.input(), email: 'x'.repeat(9000) })).status, 413);
    const malformed = new Request(base + '/api/duitku/callback', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'merchantCode=DS38217&merchantCode=D123' });
    assert.equal((await worker.fetch(malformed, h.env)).status, 400);
    assert.equal((await worker.fetch(h.request('/api/duitku/callback'), h.env)).status, 405);
    assert.equal(h.grants().length, 0);
  } finally { h.close(); }
});

test('operator-only, read-only Duitku provider probe checks worker API key and BT without invoices', async () => {
  const h = setup();
  try {
    const path = '/api/sandbox/provider-check';
    assert.equal((await worker.fetch(h.request(path, undefined, false), h.env)).status, 401);
    assert.equal(h.calls.length, 0);
    h.env.DUITKU_FETCHER = async (url, options) => {
      assert.equal(url, 'https://sandbox.duitku.com/webapi/api/merchant/paymentmethod/getpaymentmethod');
      assert.equal(options.method, 'POST');
      const payload = JSON.parse(options.body);
      assert.equal(payload.merchantcode, 'DS38217');
      assert.equal(payload.amount, 10000);
      assert.match(payload.datetime, /^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$/);
      assert.equal(payload.signature, sign('DS38217' + '10000' + payload.datetime));
      return Response.json({ responseCode: '00', paymentFee: [{ paymentMethod: 'BT' }] });
    };
    const success = await worker.fetch(h.request(path), h.env);
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), {
      sandbox: true, probe: 'payment_methods', providerHttpStatus: 200,
      responseCode: '00', credentialsAccepted: true, btAvailable: true
    });
    h.env.DUITKU_FETCHER = async () => new Response('provider-private-secret', { status: 401 });
    const denied = await worker.fetch(h.request(path), h.env);
    assert.equal(denied.status, 502);
    const deniedText = await denied.text();
    assert.match(deniedText, /"providerHttpStatus":401/);
    assert.doesNotMatch(deniedText, /provider-private-secret|synthetic-API/);
    h.env.DUITKU_FETCHER = async () => { throw Error('provider-private-secret'); };
    const offline = await worker.fetch(h.request(path), h.env);
    assert.equal(offline.status, 502);
    assert.deepEqual(await offline.json(), {
      sandbox: true, probe: 'payment_methods', error: 'provider_network_error'
    });
    assert.equal(sqliteCount(h.sqlite, 'duitku_sandbox_orders'), 0);
    assert.equal(sqliteCount(h.sqlite, 'duitku_sandbox_credit_ledger'), 0);
  } finally { h.close(); }
});
function sqliteCount(sqlite, name) {
  return sqlite.prepare('SELECT COUNT(*) AS count FROM ' + name).get().count;
}
