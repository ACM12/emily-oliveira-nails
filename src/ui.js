const zonedDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit' });
const localTime = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const localDate = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Bahia', dateStyle: 'long' });

export const element = (selector) => document.querySelector(selector);
export const brazilDay = (date = new Date()) => zonedDate.format(date);
export const timeLabel = (date) => localTime.format(new Date(date));
export const dayLabel = (date) => localDate.format(new Date(date));
export const icon = (name) => `<svg aria-hidden="true"><use href="/icons.svg#${name}" /></svg>`;

export function node(tag, text, className) {
  const item = document.createElement(tag);
  if (text) item.textContent = text;
  if (className) item.className = className;
  return item;
}

export async function api(path, { body, method, signal } = {}) {
  const response = await fetch(path, {
    method: method ?? (body ? 'POST' : 'GET'),
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(16_000)]) : AbortSignal.timeout(16_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    const error = new Error(result.error || 'Não foi possível concluir a operação. Tente novamente.');
    error.status = response.status;
    throw error;
  }
  return result;
}
