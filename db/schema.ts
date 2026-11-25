import { sql } from 'drizzle-orm';
import { check, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const bookingStatus = pgEnum('booking_status', ['awaiting', 'confirmed', 'cancelled', 'blocked', 'review']);

export const customers = pgTable('customers', {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull(),
  email: text().notNull(),
  phone: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex('customers_contact_unique').on(table.email, table.phone)]);

export const bookings = pgTable('bookings', {
  id: uuid().primaryKey(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  status: bookingStatus().notNull(),
  customerId: uuid('customer_id').references(() => customers.id),
  serviceName: text('service_name'),
  totalCents: integer('total_cents'),
  depositCents: integer('deposit_cents'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  paymentId: text('payment_id').unique(),
  pixCode: text('pix_code'),
  pixImage: text('pix_image'),
  nextCheckAt: timestamp('next_check_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('bookings_one_active_per_slot').on(table.startsAt).where(sql`status IN ('awaiting', 'confirmed', 'blocked')`),
  index('bookings_starts_at_idx').on(table.startsAt),
  index('bookings_payment_queue_idx').on(table.nextCheckAt).where(sql`status = 'awaiting'`),
  check('bookings_amount_valid', sql`${table.status} = 'blocked' OR (${table.depositCents} > 0 AND ${table.depositCents} * 2 = ${table.totalCents})`),
]);

export const bookingLimits = pgTable('booking_limits', {
  key: text().primaryKey(),
  count: integer().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
