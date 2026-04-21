const ACTIVITY_LABELS = {
  all: 'Все',
  walking: 'Ходьба',
  running: 'Бег',
  nordic_walking: 'Скандинавская',
  cycling: 'Велосипед'
};

function getParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    chatId: params.get('chatId'),
    authToken: params.get('authToken')
  };
}

function formatDuration(totalSec) {
  const sec = Number(totalSec) || 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h} ч ${m} м`;
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function bucketByDate(sessions) {
  const map = new Map();
  sessions.forEach((s) => {
    const key = formatDate(s.finishedAt || s.startedAt);
    if (!map.has(key)) map.set(key, 0);
    map.set(key, map.get(key) + (Number(s.distanceM) || 0));
  });
  return Array.from(map.entries())
    .slice(-7)
    .map(([date, meters]) => ({ date, km: meters / 1000 }));
}

function drawChart(canvas, points) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#171c22';
  ctx.fillRect(0, 0, w, h);

  if (!points.length) {
    ctx.fillStyle = '#9da7b3';
    ctx.font = '14px sans-serif';
    ctx.fillText('Нет данных для графика', 12, 24);
    return;
  }

  const max = Math.max(...points.map((p) => p.km), 1);
  const left = 24;
  const right = 12;
  const top = 14;
  const bottom = 36;
  const plotW = w - left - right;
  const plotH = h - top - bottom;
  const barW = Math.max(10, Math.floor(plotW / points.length) - 8);

  points.forEach((p, idx) => {
    const x = left + idx * (plotW / points.length) + 4;
    const barH = Math.max(2, (p.km / max) * plotH);
    const y = top + (plotH - barH);

    ctx.fillStyle = '#2a9a5b';
    ctx.fillRect(x, y, barW, barH);

    ctx.fillStyle = '#9da7b3';
    ctx.font = '10px sans-serif';
    ctx.fillText(p.date.slice(0, 5), x, h - 20);

    ctx.fillStyle = '#dfe6ee';
    ctx.font = '10px sans-serif';
    ctx.fillText(p.km.toFixed(1), x, y - 4);
  });
}

function renderFilters(container, selected, onSelect) {
  container.innerHTML = '';
  Object.entries(ACTIVITY_LABELS).forEach(([id, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chip${selected === id ? ' active' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', () => onSelect(id));
    container.appendChild(btn);
  });
}

function renderSessions(container, sessions) {
  container.innerHTML = '';
  if (!sessions.length) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = '<div class="row-meta">Пока нет тренировок</div>';
    container.appendChild(row);
    return;
  }

  sessions
    .slice()
    .sort((a, b) => new Date(b.finishedAt || b.startedAt) - new Date(a.finishedAt || a.startedAt))
    .slice(0, 20)
    .forEach((s) => {
      const row = document.createElement('div');
      row.className = 'row';
      const km = ((Number(s.distanceM) || 0) / 1000).toFixed(2);
      row.innerHTML = `
        <div class="row-title">${ACTIVITY_LABELS[s.activityId] || 'Активность'} - ${km} км</div>
        <div class="row-meta">${formatDate(s.finishedAt || s.startedAt)} · ${formatDuration(s.durationSec)}</div>
      `;
      container.appendChild(row);
    });
}

async function fetchSessions(chatId, authToken) {
  const query = new URLSearchParams({ chatId });
  if (authToken) query.set('authToken', authToken);
  const resp = await fetch(`/api/sessions?${query.toString()}`);
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || 'Не удалось загрузить историю');
  return json;
}

async function init() {
  const { chatId, authToken } = getParams();
  const statusEl = document.getElementById('status');
  const errorBox = document.getElementById('errorBox');
  const filtersEl = document.getElementById('filters');
  const listEl = document.getElementById('sessionList');
  const canvas = document.getElementById('chart');

  if (!chatId) {
    errorBox.textContent = 'Отсутствует chatId в ссылке mini-app.';
    statusEl.textContent = 'Ошибка параметров';
    return;
  }

  let payload;
  try {
    payload = await fetchSessions(chatId, authToken);
  } catch (err) {
    statusEl.textContent = 'Ошибка загрузки';
    errorBox.textContent = err.message;
    return;
  }

  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  let selectedActivity = 'all';

  function render() {
    const filtered = selectedActivity === 'all'
      ? sessions
      : sessions.filter((s) => s.activityId === selectedActivity);

    const distanceM = filtered.reduce((sum, s) => sum + (Number(s.distanceM) || 0), 0);
    const durationSec = filtered.reduce((sum, s) => sum + (Number(s.durationSec) || 0), 0);

    document.getElementById('totalKm').textContent = (distanceM / 1000).toFixed(2);
    document.getElementById('totalTime').textContent = formatDuration(durationSec);
    document.getElementById('totalSessions').textContent = String(filtered.length);

    drawChart(canvas, bucketByDate(filtered));
    renderSessions(listEl, filtered);
    renderFilters(filtersEl, selectedActivity, (id) => {
      selectedActivity = id;
      render();
    });
    statusEl.textContent = `Показаны данные: ${ACTIVITY_LABELS[selectedActivity]}`;
  }

  render();
}

init();
