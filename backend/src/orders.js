// Demo business logic. This is the file we "break" live during the demo
// (e.g. a bad commit that divides by zero or reads a missing field), so the
// incident agents have a real stack trace and a real diff to reason about.

const ORDERS = [
  { id: 1, customer: 'alice', items: [{ sku: 'A1', qty: 2, price: 9.5 }] },
  { id: 2, customer: 'bob', items: [{ sku: 'B2', qty: 1, price: 24 }, { sku: 'C3', qty: 3, price: 4 }] },
  { id: 3, customer: 'carol', items: [] },
];

function orderTotal(order) {
  if (!order || !Array.isArray(order.items)) return 0;
  return order.items.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.price) || 0), 0);
}

function listOrders() {
  return ORDERS.map((o) => ({ ...o, total: orderTotal(o) }));
}

function getOrder(id) {
  const numericId = Number(id);
  const order = ORDERS.find((o) => o.id === numericId || o.id === id);
  if (!order) return null;
  return { ...order, total: orderTotal(order) };
}

module.exports = { listOrders, getOrder, orderTotal };
