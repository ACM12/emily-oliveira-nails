import { acceptInvite, getUser, handleAuthCallback, login, logout, requestPasswordRecovery, updateUser } from '@netlify/identity';
import { money } from './catalog.js';
import { api, brazilDay, element, node, timeLabel } from './ui.js';

const loginPanel = element('#admin-login');
const loginForm = element('#login-form');
const setupForm = element('#setup-form');
const loginMessage = element('#login-message');
const dashboard = element('#admin-dashboard');
const adminMessage = element('#admin-message');
const dateInput = element('#admin-day');
const blockTime = element('#block-time');
const blockButton = element('#block-button');
const agendaList = element('#agenda-list');
const clientList = element('#client-list');
const pageButtons = element('#client-pages');
const active = new Set(['awaiting', 'confirmed', 'blocked']);
const labels = { awaiting: 'Aguardando Pix', confirmed: 'Confirmado', cancelled: 'Não confirmado', blocked: 'Bloqueado', review: 'Revisar pagamento' };
let inviteToken;
let clientPage = 1;
let agendaRequest;

function message(target, text = '') {
  target.hidden = !text;
  target.textContent = text;
}

function showLogin(text) {
  dashboard.hidden = true;
  loginPanel.hidden = false;
  loginForm.hidden = false;
  setupForm.hidden = true;
  element('#login-description').textContent = 'Acesso reservado à equipe do estúdio.';
  message(loginMessage, text);
}

function showError(error) {
  if (error.status === 401 || error.status === 403) {
    showLogin(error.message);
    return;
  }
  message(adminMessage, error.status ? error.message : 'Não foi possível conectar. Tente novamente.');
}

async function loadAgenda({ opening = false } = {}) {
  agendaRequest?.abort();
  const controller = new AbortController();
  agendaRequest = controller;
  agendaList.replaceChildren(node('p', 'Carregando agenda…', 'muted'));
  blockTime.replaceChildren(new Option('Selecione', ''));
  blockButton.disabled = true;
  try {
    const query = dateInput.value ? `?date=${encodeURIComponent(dateInput.value)}` : '';
    const data = await api(`/api/admin/agenda${query}`, { signal: controller.signal });
    if (controller.signal.aborted) return;
    dateInput.value = data.day;
    loginPanel.hidden = true;
    dashboard.hidden = false;
    element('#admin-payment-status').hidden = data.pixAvailable;
    agendaList.replaceChildren();
    if (!data.items.length) agendaList.append(node('p', 'Ainda não há reservas ou bloqueios para este dia.', 'muted'));
    const occupied = new Set(data.items.filter((item) => active.has(item.status)).map((item) => timeLabel(item.startsAt)));
    for (const time of data.slots) {
      if (!occupied.has(time) && new Date(`${data.day}T${time}:00-03:00`) > new Date()) blockTime.add(new Option(time, time));
    }
    for (const item of data.items) {
      const row = node('article', null, 'admin-item');
      const details = node('div');
      const actions = node('div');
      details.append(node('strong', `${timeLabel(item.startsAt)} · ${item.serviceName ?? 'Bloqueio manual'}`));
      if (item.customer?.name) {
        details.append(node('p', `${item.customer.name} · ${item.customer.email} · ${item.customer.phone}`));
      }
      if (item.depositCents) details.append(node('p', `Sinal: ${money(item.depositCents)} · Total: ${money(item.totalCents)}`));
      if (item.paymentId) details.append(node('p', `Pagamento Mercado Pago: ${item.paymentId}`));
      actions.append(node('span', labels[item.status], `pill ${item.status}`));
      if (item.status === 'blocked') {
        const release = node('button', 'Liberar', 'button secondary');
        release.type = 'button';
        release.setAttribute('aria-label', `Liberar ${timeLabel(item.startsAt)}`);
        release.addEventListener('click', async () => {
          release.disabled = true;
          message(adminMessage);
          try {
            await api(`/api/admin/bloqueios/${item.id}`, { method: 'DELETE' });
            message(adminMessage, 'Horário liberado.');
            await loadAgenda();
          } catch (error) {
            release.disabled = false;
            showError(error);
          }
        });
        const buttons = node('div', null, 'booking-buttons');
        buttons.append(release);
        actions.append(buttons);
      }
      row.append(details, actions);
      agendaList.append(row);
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    agendaList.replaceChildren();
    if (opening && error.status !== 401 && error.status !== 403) showLogin('Não foi possível abrir o painel agora. Tente novamente.');
    else showError(error);
  }
}

async function loadClients(page) {
  clientList.replaceChildren(node('p', 'Carregando clientes…', 'muted'));
  pageButtons.hidden = true;
  try {
    const { items, hasNext } = await api(`/api/admin/clientes?page=${page}`);
    clientPage = page;
    clientList.replaceChildren();
    if (!items.length) clientList.append(node('p', 'Ainda não há clientes cadastrados.', 'muted'));
    for (const client of items) {
      const row = node('article', null, 'admin-item');
      const details = node('div');
      details.append(node('strong', client.name), node('p', `${client.email} · ${client.phone}`));
      row.append(details);
      clientList.append(row);
    }
    element('#client-previous').disabled = page <= 1;
    element('#client-next').disabled = !hasNext;
    pageButtons.hidden = page <= 1 && !hasNext;
  } catch (error) {
    clientList.replaceChildren();
    showError(error);
  }
}

function switchSection(showClients) {
  element('#agenda-tab').setAttribute('aria-pressed', !showClients);
  element('#clientes-tab').setAttribute('aria-pressed', showClients);
  element('#agenda-panel').hidden = showClients;
  element('#clientes-panel').hidden = !showClients;
  message(adminMessage);
  if (showClients) loadClients(1);
  else loadAgenda();
}

element('#agenda-tab').addEventListener('click', () => switchSection(false));
element('#clientes-tab').addEventListener('click', () => switchSection(true));
element('#client-previous').addEventListener('click', () => loadClients(clientPage - 1));
element('#client-next').addEventListener('click', () => loadClients(clientPage + 1));
dateInput.addEventListener('change', () => { message(adminMessage); loadAgenda(); });
blockTime.addEventListener('change', () => { blockButton.disabled = !blockTime.value; });

element('#block-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (blockButton.disabled) return;
  blockButton.disabled = true;
  message(adminMessage);
  try {
    await api('/api/admin/bloqueios', { body: { date: dateInput.value, time: blockTime.value } });
    message(adminMessage, 'Horário bloqueado.');
    await loadAgenda();
  } catch (error) {
    showError(error);
    await loadAgenda();
  }
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = loginForm.querySelector('[type=submit]');
  if (submit.disabled) return;
  submit.disabled = true;
  message(loginMessage);
  try {
    await login(loginForm.elements.email.value, loginForm.elements.password.value);
    loginForm.reset();
    await loadAgenda({ opening: true });
  } catch {
    message(loginMessage, 'Não foi possível entrar. Confira suas credenciais ou redefina a senha.');
  } finally { submit.disabled = false; }
});

element('#forgot-password').addEventListener('click', async () => {
  const input = loginForm.elements.email;
  if (!input.reportValidity()) return;
  const button = element('#forgot-password');
  button.disabled = true;
  try {
    await requestPasswordRecovery(input.value);
  } catch { }
  message(loginMessage, 'Se houver uma conta ativa para esse e-mail, você receberá as instruções de recuperação.');
  button.disabled = false;
});

setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = setupForm.querySelector('[type=submit]');
  if (submit.disabled) return;
  submit.disabled = true;
  try {
    const password = setupForm.elements.password.value;
    if (inviteToken) await acceptInvite(inviteToken, password);
    else await updateUser({ password });
    inviteToken = undefined;
    setupForm.reset();
    await loadAgenda({ opening: true });
  } catch {
    message(loginMessage, 'Não foi possível salvar a senha. Tente novamente ou solicite um novo link.');
  } finally { submit.disabled = false; }
});

element('#admin-logout').addEventListener('click', async () => {
  try { await logout(); } catch { showError(new Error()); return; }
  agendaRequest?.abort();
  agendaList.replaceChildren();
  clientList.replaceChildren();
  element('#agenda-tab').setAttribute('aria-pressed', 'true');
  element('#clientes-tab').setAttribute('aria-pressed', 'false');
  element('#agenda-panel').hidden = false;
  element('#clientes-panel').hidden = true;
  dateInput.value = brazilDay();
  showLogin();
});

async function initialize() {
  try {
    const callback = await handleAuthCallback();
    if (callback?.type === 'invite' || callback?.type === 'recovery') {
      inviteToken = callback.token;
      element('#login-description').textContent = callback.type === 'invite' ? 'Defina sua senha para aceitar o convite.' : 'Crie uma nova senha para sua conta.';
      setupForm.hidden = false;
      return;
    }
    if (await getUser()) await loadAgenda({ opening: true });
    else showLogin();
  } catch { showLogin('Link inválido ou expirado. Entre ou solicite um novo link.'); }
}

initialize();
