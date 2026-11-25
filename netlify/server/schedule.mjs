const opening = 7 * 60;
const closing = 23 * 60;
const duration = 90;

export const slotTimes = Array.from({ length: Math.floor((closing - opening) / duration) }, (_, index) => {
  const minutes = opening + index * duration;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

export const activeStatuses = ['awaiting', 'confirmed', 'blocked'];
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit' });
export const brazilDay = (date = new Date()) => dateFormat.format(date);
export const slotDate = (date, time = '00:00') => new Date(`${date}T${time}:00-03:00`);
export const dayAfter = (day) => new Date(slotDate(day).getTime() + 86_400_000);
export const lastBookingDay = () => brazilDay(new Date(Date.now() + 60 * 86_400_000));
export const validDay = (date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(slotDate(date).getTime()) && brazilDay(slotDate(date)) === date;
export const validBookingDay = (date) => validDay(date) && date >= brazilDay() && date <= lastBookingDay();
export const bookable = (startsAt) => startsAt.getTime() >= Date.now() + 45 * 60_000;
