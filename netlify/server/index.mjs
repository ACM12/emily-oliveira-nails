import { createHmac, randomUUID } from 'node:crypto';
import { getContext } from '@netlify/server';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { getDb } from '../../db/index.ts';
import { bookingLimits, bookings, customers } from '../../db/schema.ts';
import { services } from '../../src/catalog.js';
import { activeStatuses, bookable, brazilDay, dayAfter, lastBookingDay, slotDate, slotTimes, uuidPattern, validBookingDay, validDay } from './schedule.mjs';
import { applyPayment, createPayment, getBooking, getPayment, PaymentError, pixReady, publicPayment, reconcileBooking, verifyWebhook } from './pix.mjs';

export const config = { path: '/api/*' };

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

async function readBody(request, url) {
  if (request.headers.get('origin') !== url.origin) throw new RequestError(403, 'Origem não autorizada.');
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) throw new RequestError(415, 'Formato inválido.');
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, 'Pedido inválido.');
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) {
      await reader.cancel();
      throw new RequestError(413, 'Pedido muito grande.');
    }
    chunks.push(value);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
    return body;
  } catch {
    throw new RequestError(400, 'Pedido inválido.');
  }
}

async function availability(day) {
  if (!validBookingDay(day)) throw new RequestError(400, 'Escolha uma data nos próximos 60 dias.');
  const existing = await getDb().select({ startsAt: bookings.startsAt }).from(bookings).where(and(
    gte(bookings.startsAt, slotDate(day)), lt(bookings.startsAt, dayAfter(day)), inArray(bookings.status, activeStatuses),
  ));
  const taken = new Set(existing.map(({ startsAt }) => startsAt.getTime()));
  const slots = slotTimes.map((time) => {
    const startsAt = slotDate(day, time);
    return { time, available: bookable(startsAt) && !taken.has(startsAt.getTime()) };
  });
  return json({ day, slots, today: brazilDay(), lastDay: lastBookingDay(), pixAvailable: pixReady() });
}

async function limitBookings(scope, value, maximum) {
  const bucket = Math.floor(Date.now() / 900_000);
  const key = createHmac('sha256', process.env.MERCADO_PAGO_WEBHOOK_SECRET).update(`${bucket}:${scope}:${value}`).digest('hex');
  const [limit] = await getDb().insert(bookingLimits).values({ key, count: 1, expiresAt: new Date((bucket + 1) * 900_000) })
    .onConflictDoUpdate({ target: bookingLimits.key, set: { count: sql`${bookingLimits.count} + 1` }, setWhere: lt(bookingLimits.count, maximum) })
    .returning({ count: bookingLimits.count });
  if (!limit) throw new RequestError(429, 'Muitas tentativas. Aguarde alguns minutos ou fale no WhatsApp.');
}

async function book(request, url) {
  const body = await readBody(request, url);
  const { id, date, time, serviceId, extra } = body;
  if (typeof id !== 'string' || !uuidPattern.test(id)) throw new RequestError(400, 'Pedido inválido.');
  const previous = await getBooking(id);
  if (previous?.serviceName) return json(publicPayment(previous));
  if (!pixReady()) throw new RequestError(503, 'O Pix online ainda não está disponível. Reserve pelo WhatsApp.');
  const service = services.find((item) => item.id === serviceId && item.cents && !item.extra);
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const phone = typeof body.phone === 'string' ? body.phone.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '') : '';
  if (!service || typeof extra !== 'boolean' || !validBookingDay(date) || !slotTimes.includes(time)) throw new RequestError(400, 'Confira o serviço, a data e o horário.');
  if (name.length < 3 || name.length > 100 || email.length > 180 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[1-9]{2}\d{8,9}$/.test(phone)) {
    throw new RequestError(400, 'Confira o nome, o e-mail e o WhatsApp com DDD.');
  }
  const startsAt = slotDate(date, time);
  if (!bookable(startsAt)) throw new RequestError(409, 'Esse horário não está mais disponível. Escolha outro.');
  const context = getContext();
  await limitBookings('ip', context.ip ?? 'unknown', 6);
  await limitBookings('contact', `${email}:${phone}`, 3);

  const totalCents = service.cents + (extra ? services.find((item) => item.extra).cents : 0);
  const db = getDb();
  const [booking] = await db.insert(bookings).values({
    id, startsAt, status: 'awaiting', serviceName: `${service.name}${extra ? ' + acessório' : ''}`, totalCents,
    depositCents: totalCents / 2, expiresAt: new Date(Date.now() + 35 * 60_000), nextCheckAt: new Date(Date.now() + 20_000),
  }).onConflictDoNothing().returning();
  if (!booking) {
    const existing = await getBooking(id);
    if (existing?.serviceName) return json(publicPayment(existing));
    throw new RequestError(409, 'Esse horário acabou de ser reservado. Escolha outro.');
  }

  let paymentSubmitted = false;
  try {
    await db.insert(customers).values({ name, email, phone }).onConflictDoNothing();
    const [customer] = await db.select().from(customers).where(and(eq(customers.email, email), eq(customers.phone, phone)));
    await db.update(bookings).set({ customerId: customer.id }).where(eq(bookings.id, id));
    const deployOrigin = process.env.DEPLOY_PRIME_URL ?? process.env.URL ?? context.site.url;
    paymentSubmitted = true;
    const payment = await createPayment(booking, { name, email }, deployOrigin);
    const updated = await applyPayment(booking, payment);
    if (!updated.paymentId) console.warn('Resposta Pix sem os dados esperados.');
    return json(publicPayment(updated), 201);
  } catch (error) {
    if (!paymentSubmitted || (error instanceof PaymentError && [400, 401, 403, 422].includes(error.status))) {
      await db.update(bookings).set({ status: 'cancelled' }).where(and(eq(bookings.id, id), eq(bookings.status, 'awaiting')));
      throw new RequestError(502, 'Não foi possível gerar o Pix. Tente novamente ou fale no WhatsApp.');
    }
    console.warn('Criação do Pix aguarda conciliação.');
    return json(publicPayment(booking), 202);
  }
}

async function bookingStatus(id) {
  if (!uuidPattern.test(id)) throw new RequestError(404, 'Reserva não encontrada.');
  const booking = await getBooking(id);
  if (!booking?.serviceName) throw new RequestError(404, 'Reserva não encontrada.');
  if (booking.status !== 'awaiting') return json(publicPayment(booking));
  try {
    return json(publicPayment(await reconcileBooking(booking)));
  } catch {
    return json(publicPayment(booking));
  }
}

async function webhook(request, url) {
  const id = verifyWebhook(request, url);
  if (!id) throw new RequestError(401, 'Notificação não autenticada.');
  const topic = url.searchParams.get('type');
  if (topic && topic !== 'payment') return json({ received: true });
  const payment = await getPayment(id);
  if (typeof payment.external_reference === 'string' && uuidPattern.test(payment.external_reference)) {
    const booking = await getBooking(payment.external_reference);
    if (booking?.serviceName) await applyPayment(booking, payment);
  }
  return json({ received: true });
}

async function requireAdmin() {
  const context = getContext();
  const token = context.cookies.get('nf_jwt');
  if (!token) throw new RequestError(401, 'Entre para acessar a área administrativa.');
  const address = new URL('/.netlify/identity/user', process.env.URL ?? context.site.url);
  const response = await fetch(address, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (response.status >= 500) throw new RequestError(503, 'Não foi possível verificar sua sessão agora.');
  if (!response.ok) throw new RequestError(401, 'Sessão inválida. Entre novamente.');
  const account = await response.json();
  if (!Array.isArray(account.app_metadata?.roles) || !account.app_metadata.roles.includes('admin')) throw new RequestError(403, 'Sua conta não tem acesso administrativo.');
}

async function adminRoute(request, url) {
  await requireAdmin();
  const db = getDb();
  if (request.method === 'GET' && url.pathname === '/api/admin/agenda') {
    const day = url.searchParams.get('date') || brazilDay();
    if (!validDay(day)) throw new RequestError(400, 'Data inválida.');
    const items = await db.select({
      id: bookings.id, startsAt: bookings.startsAt, status: bookings.status, serviceName: bookings.serviceName,
      totalCents: bookings.totalCents, depositCents: bookings.depositCents, paymentId: bookings.paymentId,
      customer: { name: customers.name, email: customers.email, phone: customers.phone },
    }).from(bookings).leftJoin(customers, eq(bookings.customerId, customers.id))
      .where(and(gte(bookings.startsAt, slotDate(day)), lt(bookings.startsAt, dayAfter(day)))).orderBy(asc(bookings.startsAt));
    return json({ day, slots: slotTimes, items, today: brazilDay(), pixAvailable: pixReady() });
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/clientes') {
    const page = Number(url.searchParams.get('page') ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > 5000) throw new RequestError(400, 'Página inválida.');
    const items = await db.select().from(customers).orderBy(desc(customers.createdAt), asc(customers.id)).limit(31).offset((page - 1) * 30);
    return json({ items: items.slice(0, 30), hasNext: items.length > 30 });
  }
  if (request.method === 'POST' && url.pathname === '/api/admin/bloqueios') {
    const { date, time } = await readBody(request, url);
    if (!validBookingDay(date) || !slotTimes.includes(time) || slotDate(date, time) <= new Date()) throw new RequestError(400, 'Escolha um horário futuro nos próximos 60 dias.');
    const [blocked] = await db.insert(bookings).values({ id: randomUUID(), startsAt: slotDate(date, time), status: 'blocked' }).onConflictDoNothing().returning({ id: bookings.id });
    if (!blocked) throw new RequestError(409, 'O horário já está ocupado.');
    return json(blocked, 201);
  }
  if (request.method === 'DELETE' && /^\/api\/admin\/bloqueios\/[0-9a-f-]+$/i.test(url.pathname)) {
    if (request.headers.get('origin') !== url.origin) throw new RequestError(403, 'Origem não autorizada.');
    const id = url.pathname.split('/').at(-1);
    if (!uuidPattern.test(id)) throw new RequestError(404, 'Bloqueio não encontrado.');
    const [removed] = await db.delete(bookings).where(and(eq(bookings.id, id), eq(bookings.status, 'blocked'))).returning({ id: bookings.id });
    if (!removed) throw new RequestError(404, 'Bloqueio não encontrado.');
    return json({ removed: true });
  }
  throw new RequestError(404, 'Rota não encontrada.');
}

export default async function handle(request) {
  const url = new URL(request.url);
  try {
    if (request.method === 'GET' && url.pathname === '/api/availability') return await availability(url.searchParams.get('date'));
    if (request.method === 'POST' && url.pathname === '/api/bookings') return await book(request, url);
    if (request.method === 'GET' && url.pathname.startsWith('/api/bookings/')) return await bookingStatus(url.pathname.split('/').at(-1));
    if (request.method === 'POST' && url.pathname === '/api/mercado-pago/webhook') return await webhook(request, url);
    if (url.pathname.startsWith('/api/admin/')) return await adminRoute(request, url);
    return json({ error: 'Rota não encontrada.' }, 404);
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    console.error(`Falha ao processar ${request.method}: ${error instanceof PaymentError ? 'provedor Pix' : 'operação interna'}.`);
    return json({ error: 'Não foi possível concluir a operação. Tente novamente.' }, 503);
  }
}
