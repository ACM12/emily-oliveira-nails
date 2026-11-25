import { money, services, whatsapp } from './catalog.js';
import { api, brazilDay, dayLabel, element, icon, node, timeLabel } from './ui.js';

if (/^#(?:invite_token|recovery_token)=/.test(location.hash)) location.replace(`/admin${location.hash}`);

const gallery = [
  ['francesinha', 'Francesinha clássica', 'Unhas rosadas com pontas brancas sobre tecido claro'],
  ['rosa', 'Rosa delicado', 'Unhas rosa com um fio dourado sobre cetim'],
  ['nude', 'Nude elegante', 'Unhas em tom caramelo sobre linho claro'],
  ['perola', 'Brilho perolado', 'Unhas brancas com acabamento perolado'],
];

function imageUrl(name, width) {
  return `/.netlify/images?url=/img/${name}.webp&w=${width}&fm=webp`;
}

const menu = element('.menu-toggle');
const navigation = element('#main-nav');
function setMenu(open) {
  menu.setAttribute('aria-expanded', open);
  menu.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  menu.innerHTML = icon(open ? 'close' : 'menu');
  navigation.classList.toggle('is-open', open);
}
menu.addEventListener('click', () => setMenu(menu.getAttribute('aria-expanded') !== 'true'));
navigation.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
  navigation.querySelector('[aria-current]')?.removeAttribute('aria-current');
  link.setAttribute('aria-current', 'location');
  setMenu(false);
}));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
    setMenu(false);
    menu.focus();
  }
});

element('#service-list').innerHTML = services.map((service) => {
  const label = service.cents === null ? 'Consultar' : service.extra ? 'Adicionar' : 'Agendar';
  const href = service.cents === null ? `${whatsapp}?text=${encodeURIComponent('Olá, Emily! Gostaria de saber mais sobre a arte em 3D.')}` : '#agendar';
  return `<article class="service-card"><span class="stamp">${icon(service.icon)}</span><h3>${service.name}</h3><p>${service.description}</p><footer><strong>${service.cents === null ? 'Sob consulta' : money(service.cents)}</strong><a class="text-link" data-service="${service.id}" href="${href}" ${service.cents === null ? 'target="_blank" rel="noopener noreferrer"' : ''}>${label} ${icon(service.cents === null ? 'external' : 'arrow')}</a></footer></article>`;
}).join('');

const lightbox = element('#lightbox');
gallery.forEach(([file, title, description]) => {
  const button = node('button', null, 'gallery-photo');
  button.type = 'button';
  button.setAttribute('aria-label', `Ampliar foto: ${title}`);
  button.innerHTML = `<img src="${imageUrl(file, 600)}" alt="${description}" loading="lazy" width="600" height="750" /><span>${title} ${icon('external')}</span>`;
  button.addEventListener('click', () => {
    const photo = lightbox.querySelector('img');
    photo.src = imageUrl(file, 900);
    photo.alt = description;
    element('#lightbox-title').textContent = title;
    lightbox.showModal();
  });
  element('#gallery-list').append(button);
});
lightbox.addEventListener('click', (event) => { if (event.target === lightbox) lightbox.close(); });

const form = element('#booking-form');
const serviceInput = element('#booking-service');
const extraInput = element('#booking-extra');
const dateInput = element('#booking-date');
const slotList = element('#slots');
const paymentPanel = element('#booking-payment');
const message = element('#booking-message');
const nextButton = element('#next-step');
const pixButton = element('#generate-pix');
const storageKey = 'emily-reserva';
let phase = 1;
let selectedTime = '';
let pixAvailable = false;
let slotRequest;
let bookingId;
let requestId;
let pollTimer;
let renderedPayment = '';

form.noValidate = true;
for (const service of services.filter((item) => item.cents && !item.extra)) {
  const option = new Option(`${service.name} — ${money(service.cents)}`, service.id);
  serviceInput.add(option);
}
dateInput.min = dateInput.value = brazilDay();
dateInput.max = brazilDay(new Date(Date.now() + 60 * 86_400_000));

function showMessage(text = '', withContact = false) {
  message.replaceChildren();
  message.hidden = !text;
  if (!text) return;
  message.append(text);
  if (withContact) {
    const link = node('a', ' Falar no WhatsApp');
    link.href = whatsapp;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    message.append(link);
  }
}

function setPhase(next) {
  phase = next;
  form.hidden = next === 3;
  element('#booking-time').hidden = next !== 1;
  element('#booking-client').hidden = next !== 2;
  paymentPanel.hidden = next !== 3;
  document.querySelectorAll('.steps li').forEach((step, index) => {
    if (index + 1 === next) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  });
  showMessage();
}

async function loadSlots() {
  slotRequest?.abort();
  selectedTime = '';
  nextButton.disabled = true;
  if (!dateInput.value || !dateInput.validity.valid) {
    slotList.replaceChildren(node('p', 'Selecione uma data para ver os horários.', 'muted'));
    return;
  }
  const controller = new AbortController();
  slotRequest = controller;
  slotList.replaceChildren(node('p', 'Buscando horários…', 'muted'));
  slotList.setAttribute('aria-busy', 'true');
  try {
    const data = await api(`/api/availability?date=${encodeURIComponent(dateInput.value)}`, { signal: controller.signal });
    if (controller.signal.aborted) return;
    pixAvailable = data.pixAvailable;
    dateInput.min = data.today;
    dateInput.max = data.lastDay;
    slotList.replaceChildren();
    if (!data.slots.some((slot) => slot.available)) {
      slotList.append(node('p', 'Não há horários disponíveis nesta data. Escolha outro dia.', 'muted'));
    }
    for (const slot of data.slots) {
      const button = node('button', slot.time, 'slot-button');
      button.type = 'button';
      button.disabled = !slot.available;
      button.setAttribute('aria-label', `${slot.time}${slot.available ? '' : ', indisponível'}`);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        slotList.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-pressed', 'true');
        selectedTime = slot.time;
        nextButton.disabled = false;
        showMessage();
      });
      slotList.append(button);
    }
  } catch {
    if (controller.signal.aborted) return;
    const retry = node('button', 'Tentar novamente', 'button secondary');
    retry.type = 'button';
    retry.addEventListener('click', loadSlots);
    slotList.replaceChildren(node('p', 'Não foi possível consultar a agenda agora.', 'muted'), retry);
  } finally {
    if (slotRequest === controller) slotList.removeAttribute('aria-busy');
  }
}

dateInput.addEventListener('change', () => { showMessage(); loadSlots(); });
serviceInput.addEventListener('change', () => showMessage());

element('#service-list').addEventListener('click', (event) => {
  const target = event.target.closest('[data-service]');
  if (!target || target.dataset.service === 'arte-3d' || phase === 3 || pixButton.disabled) return;
  setPhase(1);
  if (target.dataset.service === 'acessorios') extraInput.checked = true;
  else serviceInput.value = target.dataset.service;
});

nextButton.addEventListener('click', () => {
  if (!serviceInput.reportValidity() || !dateInput.reportValidity() || !selectedTime) return;
  if (!pixAvailable) {
    showMessage('O Pix online ainda não está disponível.', true);
    return;
  }
  const service = services.find((item) => item.id === serviceInput.value);
  const deposit = (service.cents + (extraInput.checked ? 200 : 0)) / 2;
  element('#booking-summary').textContent = `${service.name}${extraInput.checked ? ' + acessório' : ''} · ${dayLabel(`${dateInput.value}T12:00:00-03:00`)} às ${selectedTime} · Sinal de ${money(deposit)}`;
  setPhase(2);
  form.elements.name.focus();
});

element('#back-step').addEventListener('click', () => {
  if (pixButton.disabled) return;
  setPhase(1);
  requestId = undefined;
  nextButton.focus();
});

function remember(id) {
  try {
    if (id) sessionStorage.setItem(storageKey, id);
    else sessionStorage.removeItem(storageKey);
  } catch { }
}

function resetBooking() {
  clearTimeout(pollTimer);
  remember();
  bookingId = requestId = undefined;
  renderedPayment = '';
  paymentPanel.replaceChildren();
  form.reset();
  dateInput.value = brazilDay();
  setPhase(1);
  loadSlots();
  serviceInput.focus();
}

function action(text, className, handler) {
  const button = node('button', text, `button ${className}`);
  button.type = 'button';
  button.addEventListener('click', handler);
  return button;
}

function showPayment(payment) {
  if (phase !== 3) setPhase(3);
  const expired = payment.expiresAt && new Date(payment.expiresAt) <= new Date();
  const key = `${payment.status}:${expired}:${payment.pixCode ?? ''}:${Boolean(payment.pixImage)}`;
  if (renderedPayment === key) return;
  renderedPayment = key;
  paymentPanel.replaceChildren();
  const content = node('div', null, 'payment-content');
  const stamp = node('span', null, 'stamp');
  stamp.innerHTML = icon(payment.status === 'confirmed' ? 'check' : 'shield');
  const titles = { confirmed: 'Reserva confirmada!', cancelled: 'Reserva não confirmada', review: 'Pagamento em análise' };
  content.append(stamp, node('h3', titles[payment.status] ?? (expired ? 'Verificando o pagamento' : 'Pague o sinal via Pix')));
  content.append(node('p', `${payment.serviceName} · ${dayLabel(payment.startsAt)} às ${timeLabel(payment.startsAt)}`, 'muted'));
  if (payment.status === 'awaiting') {
    content.append(node('p', expired ? 'O prazo do Pix terminou. Estamos verificando se o pagamento foi recebido antes de liberar o horário.' : `Sinal de ${money(payment.depositCents)}. Pague até ${timeLabel(payment.expiresAt)} (horário de Salvador).`, 'muted'));
    if (!expired && payment.pixImage) {
      const image = node('img', null, 'pix-image');
      image.alt = 'QR Code Pix para pagamento do sinal';
      image.src = `data:image/png;base64,${payment.pixImage}`;
      image.width = image.height = 205;
      content.append(image);
    }
    if (!expired && payment.pixCode) {
      const input = node('input', null, 'pix-copy');
      input.value = payment.pixCode;
      input.readOnly = true;
      input.setAttribute('aria-label', 'Código Pix copia e cola');
      const copy = action('Copiar Pix', 'primary', async () => {
        try {
          await navigator.clipboard.writeText(payment.pixCode);
          showMessage('Código Pix copiado.');
        } catch {
          input.select();
          showMessage('Selecione e copie o código Pix exibido.');
        }
      });
      const controls = node('div', null, 'pix-controls');
      controls.append(input, copy);
      content.append(controls);
    } else if (!expired) {
      content.append(node('p', 'Estamos preparando seu código Pix. Acompanhe por aqui.', 'muted'));
    }
    if (!expired) content.append(node('p', 'A confirmação aparece aqui automaticamente após a aprovação.', 'muted'));
    content.append(action('Verificar agora', 'secondary', () => refreshPayment()));
  } else {
    const texts = {
      confirmed: `Sinal de ${money(payment.depositCents)} aprovado. O restante, ${money(payment.totalCents - payment.depositCents)}, é pago no atendimento.`,
      cancelled: 'O sinal não foi aprovado e o horário foi liberado. Você pode escolher outro horário.',
      review: 'Fale com o estúdio pelo WhatsApp antes de fazer um novo pagamento.',
    };
    content.append(node('p', texts[payment.status], 'muted'));
    if (payment.status !== 'review') content.append(action('Novo agendamento', 'secondary', resetBooking));
    else showMessage('A reserva precisa de atendimento manual.', true);
  }
  paymentPanel.append(content);
}

async function refreshPayment() {
  clearTimeout(pollTimer);
  const current = bookingId;
  if (!current) return;
  try {
    const payment = await api(`/api/bookings/${current}`);
    if (bookingId !== current) return;
    showPayment(payment);
    if (payment.status === 'awaiting') pollTimer = setTimeout(refreshPayment, 6500);
  } catch (error) {
    if (bookingId !== current) return;
    if (error.status === 404) {
      resetBooking();
      return;
    }
    showMessage('Não foi possível atualizar a reserva agora. Tentaremos de novo.', true);
    pollTimer = setTimeout(refreshPayment, 10_000);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (phase !== 2 || pixButton.disabled) return;
  const values = new FormData(form);
  for (const field of form.querySelectorAll('#booking-client input')) if (!field.reportValidity()) return;
  requestId ??= crypto.randomUUID();
  pixButton.disabled = true;
  element('#back-step').disabled = true;
  pixButton.textContent = 'Gerando Pix…';
  showMessage();
  try {
    const payment = await api('/api/bookings', { body: {
      id: requestId, name: values.get('name'), email: values.get('email'), phone: values.get('phone'),
      date: dateInput.value, time: selectedTime, serviceId: serviceInput.value, extra: extraInput.checked,
    } });
    bookingId = payment.id;
    remember(bookingId);
    showPayment(payment);
    if (payment.status === 'awaiting') pollTimer = setTimeout(refreshPayment, 6500);
  } catch (error) {
    if (error.status === 409) {
      requestId = undefined;
      setPhase(1);
      loadSlots();
    }
    if (error.status === 502) requestId = undefined;
    showMessage(error.status ? error.message : 'A conexão falhou. Tente novamente para consultar a mesma reserva.', error.status >= 500);
  } finally {
    pixButton.disabled = false;
    element('#back-step').disabled = false;
    pixButton.textContent = 'Gerar Pix';
  }
});

try { bookingId = sessionStorage.getItem(storageKey); } catch { }
if (bookingId && /^[a-f0-9-]{36}$/i.test(bookingId)) {
  setPhase(3);
  paymentPanel.append(node('p', 'Carregando sua reserva…', 'muted'));
  refreshPayment();
}
loadSlots();
