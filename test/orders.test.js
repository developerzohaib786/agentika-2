// Smoke tests. The root-cause agent's fix PR should keep these green
// ("agents verifying their own fixes").
const test = require('node:test');
const assert = require('node:assert');
const { listOrders, getOrder, orderTotal } = require('../src/orders');

test('orderTotal sums qty * price', () => {
  assert.strictEqual(orderTotal({ items: [{ qty: 2, price: 3 }, { qty: 1, price: 4 }] }), 10);
});

test('orderTotal handles empty orders', () => {
  assert.strictEqual(orderTotal({ items: [] }), 0);
});

test('listOrders returns every order with a numeric total', () => {
  const orders = listOrders();
  assert.strictEqual(orders.length, 3);
  for (const o of orders) assert.ok(Number.isFinite(o.total));
});

test('getOrder returns null for unknown id', () => {
  assert.strictEqual(getOrder(999), null);
});
