-- SPDX-License-Identifier: Apache-2.0
INSERT INTO customer (id, name, email, city, created_at, internal_note) VALUES
  (1, 'Ada Lovelace', 'ada@example.org', 'London', TIMESTAMP '2026-01-05 09:30:00', 'prefers email'),
  (2, 'Grace Hopper', 'grace@example.org', 'Arlington', TIMESTAMP '2026-02-11 14:00:00', 'VIP'),
  (3, 'Alan Turing', 'alan@example.org', 'Manchester', TIMESTAMP '2026-03-20 08:15:00', NULL);

INSERT INTO product (id, sku, name, price_eur, active) VALUES
  (1, 'MUG-01', 'Coffee mug', 9.90, TRUE),
  (2, 'TEE-02', 'T-shirt', 19.00, TRUE),
  (3, 'CAP-03', 'Cap', 14.50, FALSE);

INSERT INTO purchase_order (id, customer_id, status, total_eur, placed_on) VALUES
  (1, 1, 'SHIPPED', 28.90, DATE '2026-04-01'),
  (2, 1, 'OPEN', 19.00, DATE '2026-05-12'),
  (3, 2, 'CANCELLED', 14.50, DATE '2026-05-20'),
  (4, 3, 'OPEN', 9.90, DATE '2026-06-02');

INSERT INTO audit_entry (id, at, message) VALUES
  (1, TIMESTAMP '2026-06-02 10:00:00', 'order 4 created');
