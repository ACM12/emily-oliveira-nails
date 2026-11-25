import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, asc, eq, isNull, lt, lte, or } from 'drizzle-orm';
import { getDb } from '../../db/index.ts';
import { bookingLimits, bookings } from '../../db/schema.ts';

const cancelledStatuses = new Set(['cancelled', 'rejected']);
const chargebackStatuses = new Set(['charged_back', 'refunded', 'in_mediation']);
const provider = 'https://api.mercadopago.com';

export const pixReady = () => Boolean(process.env.MERCADO_PAGO_ACCESS_TOKEN && process.env.MERCADO_PAGO_WEBHOOK_SECRET);

export class PaymentError extends Error {
  constructor(status) {
    super('Falha na comunicação com o provedor de pagamentos.');
    this.status = status;
  }
}

async function requestPayment(path, { method = 'GET', body, idempotencyKey } = {}) {
  const response = await fetch(`${provider}${path}`, {
    method,
    signal: AbortSignal.timeout(6500),
    headers: {
      Authorization: `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new PaymentError(response.status);
  return response.json();
}

export function createPayment(booking, customer, origin) {
  return requestPayment('/v1/payments', {
    method: 'POST',
    idempotencyKey: booking.id,
    body: {
      payment_method_id: 'pix',
      transaction_amount: booking.depositCents / 100,
      description: `Sinal de agendamento — ${booking.serviceName}`,
      date_of_expiration: booking.expiresAt.toISOString(),
      external_reference: booking.id,
      notification_url: new URL('/api/mercado-pago/webhook?source_news=webhooks', origin).href,
      payer: { email: customer.email, first_name: customer.name.split(' ')[0] },
    },
  });
}

export function getPayment(id) {
  return requestPayment(`/v1/payments/${encodeURIComponent(id)}`);
}

function cancelPayment(id) {
  return requestPayment(`/v1/payments/${encodeURIComponent(id)}`, { method: 'PUT', body: { status: 'cancelled' } });
}

export function verifyWebhook(request, url) {
  const id = url.searchParams.get('data.id');
  const requestId = request.headers.get('x-request-id');
  const rawSignature = request.headers.get('x-signature');
  if (!pixReady() || !/^\d{1,30}$/.test(id ?? '') || !requestId || !rawSignature) return null;
  const entries = Object.fromEntries(rawSignature.split(',').map((part) => part.trim().split('=')));
  if (!/^\d{9,13}$/.test(entries.ts ?? '') || !/^[a-f0-9]{64}$/i.test(entries.v1 ?? '')) return null;
  const sentAt = Number(entries.ts) * (entries.ts.length <= 10 ? 1000 : 1);
  if (Math.abs(Date.now() - sentAt) > 10 * 60_000) return null;
  const expected = createHmac('sha256', process.env.MERCADO_PAGO_WEBHOOK_SECRET)
    .update(`id:${id};request-id:${requestId};ts:${entries.ts};`).digest();
  return timingSafeEqual(expected, Buffer.from(entries.v1, 'hex')) ? id : null;
}

export async function getBooking(id) {
  const [booking] = await getDb().select().from(bookings).where(eq(bookings.id, id));
  return booking;
}

export function publicPayment(booking) {
  return {
    id: booking.id,
    status: booking.status,
    startsAt: booking.startsAt,
    serviceName: booking.serviceName,
    depositCents: booking.depositCents,
    totalCents: booking.totalCents,
    expiresAt: booking.expiresAt,
    pixCode: booking.status === 'awaiting' && booking.expiresAt > new Date() ? booking.pixCode : null,
    pixImage: booking.status === 'awaiting' && booking.expiresAt > new Date() ? booking.pixImage : null,
  };
}

export async function applyPayment(booking, payment) {
  const db = getDb();
  const paymentId = String(payment.id);
  if (booking.id !== payment.external_reference || (booking.paymentId && booking.paymentId !== paymentId) ||
      !/^\d{1,30}$/.test(paymentId) || payment.payment_method_id !== 'pix' || payment.currency_id !== 'BRL' ||
      Math.round(Number(payment.transaction_amount) * 100) !== booking.depositCents) return booking;

  if (booking.status === 'blocked' || booking.status === 'review') return booking;
  let status = booking.status;
  if (payment.status === 'approved') {
    if (status === 'awaiting') status = booking.startsAt > new Date() ? 'confirmed' : 'review';
    else if (status === 'cancelled') status = 'review';
  } else if (cancelledStatuses.has(payment.status) && status === 'awaiting') {
    status = 'cancelled';
  } else if (chargebackStatuses.has(payment.status) && ['awaiting', 'confirmed'].includes(status)) {
    status = 'review';
  }

  const data = payment.point_of_interaction?.transaction_data;
  const pixCode = typeof data?.qr_code === 'string' && data.qr_code.length <= 4096 ? data.qr_code : null;
  const pixImage = typeof data?.qr_code_base64 === 'string' && /^[A-Za-z0-9+/=]+$/.test(data.qr_code_base64) && data.qr_code_base64.length <= 100_000 ? data.qr_code_base64 : null;
  const [updated] = await db.update(bookings).set({
    status, paymentId,
    pixCode: status === 'awaiting' ? pixCode ?? booking.pixCode : null,
    pixImage: status === 'awaiting' ? pixImage ?? booking.pixImage : null,
  }).where(and(eq(bookings.id, booking.id), eq(bookings.status, booking.status), or(isNull(bookings.paymentId), eq(bookings.paymentId, paymentId)))).returning();
  if (updated) return updated;
  const fresh = await getBooking(booking.id);
  return fresh && fresh.status !== booking.status ? applyPayment(fresh, payment) : fresh ?? booking;
}

export async function reconcileBooking(booking) {
  const now = new Date();
  if (!pixReady() || booking.status !== 'awaiting' || booking.nextCheckAt > now) return booking;
  const db = getDb();
  const [claimed] = await db.update(bookings).set({ nextCheckAt: new Date(now.getTime() + 20_000) })
    .where(and(eq(bookings.id, booking.id), eq(bookings.status, 'awaiting'), lte(bookings.nextCheckAt, now))).returning();
  if (!claimed) return await getBooking(booking.id) ?? booking;

  let payment;
  if (claimed.paymentId) {
    payment = await getPayment(claimed.paymentId);
  } else {
    const search = await requestPayment(`/v1/payments/search?external_reference=${encodeURIComponent(claimed.id)}`);
    payment = search.results?.find((result) => result.external_reference === claimed.id);
  }
  if (payment) {
    const updated = await applyPayment(claimed, payment);
    if (updated.status !== 'awaiting' || updated.expiresAt > now || !updated.paymentId) return updated;
    try {
      return await applyPayment(updated, await cancelPayment(updated.paymentId));
    } catch (error) {
      if (error instanceof PaymentError && error.status < 500) return applyPayment(updated, await getPayment(updated.paymentId));
      throw error;
    }
  }
  if (!claimed.paymentId && now.getTime() > claimed.expiresAt.getTime() + 5 * 60_000) {
    const [updated] = await db.update(bookings).set({ status: 'cancelled', pixCode: null, pixImage: null })
      .where(and(eq(bookings.id, claimed.id), eq(bookings.status, 'awaiting'), eq(bookings.nextCheckAt, claimed.nextCheckAt), isNull(bookings.paymentId))).returning();
    return updated ?? await getBooking(claimed.id) ?? claimed;
  }
  return claimed;
}

export async function reconcileQueue() {
  if (!pixReady()) return;
  const db = getDb();
  const now = new Date();
  const pending = await db.select().from(bookings)
    .where(and(eq(bookings.status, 'awaiting'), lte(bookings.nextCheckAt, now)))
    .orderBy(asc(bookings.nextCheckAt)).limit(12);
  const results = await Promise.allSettled(pending.map(reconcileBooking));
  if (results.some(({ status }) => status === 'rejected')) console.warn('Algumas reservas Pix aguardam nova conciliação.');
  await db.delete(bookingLimits).where(lt(bookingLimits.expiresAt, now));
}
