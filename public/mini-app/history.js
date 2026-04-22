const ACTIVITY_LABELS = {
  all: 'Все',
  running: 'Бег',
  nordic_walking: 'Скандинавская',
  cycling: 'Велосипед'
};

const PERIOD_LABELS = {
  7: '7 дн',
  30: '30 дн'
};

const METRIC_LABELS = {
  km: 'Км',
  time: 'Время',
  calories: 'Ккал'
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

function formatTotalCaloriesSummary(durationSec, distanceM) {
  const kcal = estimateWorkoutCaloriesKcal(distanceM, durationSec);
  if (!Number.isFinite(kcal) || kcal <= 0) return '—';
  return `${formatCaloriesKcalShort(kcal)} ккал`;
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatShortDate(isoDateKey) {
  const [y, m, d] = isoDateKey.split('-');
  return `${d}.${m}`;
}

function getDayKey(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildMetricSeries(sessions, periodDays, metric) {
  const map = new Map();
  sessions.forEach((s) => {
    const key = getDayKey(s.finishedAt || s.startedAt);
    if (!key) return;
    if (!map.has(key)) map.set(key, { distanceM: 0, durationSec: 0, estCaloriesKcal: 0, activities: {} });
    const agg = map.get(key);
    agg.distanceM += Number(s.distanceM) || 0;
    agg.durationSec += Number(s.durationSec) || 0;
    const bySession = Number(s.estCaloriesKcal);
    const fallbackCalories = estimateWorkoutCaloriesKcal(s.distanceM, s.durationSec);
    agg.estCaloriesKcal += Number.isFinite(bySession) && bySession > 0 ? bySession : fallbackCalories;
    const activityId = s.activityId || 'unknown';
    if (!agg.activities[activityId]) agg.activities[activityId] = 0;
    agg.activities[activityId] += Number(s.distanceM) || 0;
  });

  const points = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = periodDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = getDayKey(d);
    const dayAgg = map.get(key) || { distanceM: 0, durationSec: 0, estCaloriesKcal: 0, activities: {} };
    const activityEntries = Object.entries(dayAgg.activities);
    const activityId =
      activityEntries.length === 0
        ? null
        : activityEntries.sort((a, b) => b[1] - a[1])[0][0];
    let value = dayAgg.distanceM / 1000;
    if (metric === 'time') value = dayAgg.durationSec / 3600;
    if (metric === 'calories') value = dayAgg.estCaloriesKcal;
    points.push({
      key,
      date: formatShortDate(key),
      value,
      distanceM: dayAgg.distanceM,
      durationSec: dayAgg.durationSec,
      estCaloriesKcal: dayAgg.estCaloriesKcal,
      activityId
    });
  }

  return points;
}

function formatMetricValue(value, metric) {
  if (metric === 'time') return `${value.toFixed(1)} ч`;
  if (metric === 'calories') return `${Math.round(value)} ккал`;
  return `${value.toFixed(1)} км`;
}

function getChartTitle(metric) {
  if (metric === 'time') return 'Динамика времени тренировок';
  if (metric === 'calories') return 'Динамика калорий';
  return 'Динамика километража';
}

function getActivityLabel(activityId) {
  if (!activityId || activityId === 'unknown') return 'Смешанные';
  return ACTIVITY_LABELS[activityId] || 'Смешанные';
}

function prepareCanvas(canvas, cssHeight = 220) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(280, canvas.clientWidth || 360);
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: cssWidth, h: cssHeight };
}

function drawChart(canvas, points, metric, selectedIndex) {
  const { ctx, w, h } = prepareCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#171c22';
  ctx.fillRect(0, 0, w, h);

  if (!points.length) {
    ctx.fillStyle = '#9da7b3';
    ctx.font = '14px sans-serif';
    ctx.fillText('Нет данных для графика', 12, 24);
    return [];
  }

  const max = Math.max(...points.map((p) => p.value), 1);
  const left = 30;
  const right = 12;
  const top = 14;
  const bottom = 40;
  const plotW = w - left - right;
  const plotH = h - top - bottom;
  const stepX = plotW / points.length;
  const barW = Math.max(3, Math.floor(stepX) - 4);

  ctx.strokeStyle = '#2d3742';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = top + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(w - right, y);
    ctx.stroke();
  }

  ctx.fillStyle = '#8c98a5';
  ctx.font = '10px sans-serif';
  ctx.fillText(formatMetricValue(max, metric), 4, top + 4);
  ctx.fillText('0', 14, top + plotH + 2);

  const hitBoxes = [];
  points.forEach((p, idx) => {
    const x = left + idx * stepX + 2;
    const barH = Math.max(2, (p.value / max) * plotH);
    const y = top + (plotH - barH);

    const gradient = ctx.createLinearGradient(0, y, 0, y + barH);
    gradient.addColorStop(0, '#41c776');
    gradient.addColorStop(1, '#1f7a46');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, barW, barH);
    if (idx === selectedIndex) {
      ctx.strokeStyle = '#cce8d7';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 1, y - 1, barW + 2, barH + 2);
    }

    ctx.fillStyle = '#9da7b3';
    ctx.font = '10px sans-serif';
    if (points.length <= 10 || idx % 3 === 0 || idx === points.length - 1) {
      ctx.fillText(p.date, x, h - 20);
    }

    if (p.value > 0) {
      ctx.fillStyle = '#dfe6ee';
      ctx.font = '10px sans-serif';
      ctx.fillText(p.value.toFixed(1), x, y - 4);
    }
    hitBoxes.push({ index: idx, x, y, width: barW, height: barH, point: p });
  });
  return hitBoxes;
}

function renderDayDetails(container, point) {
  if (!container) return;
  if (!point) {
    container.classList.remove('show');
    container.innerHTML = '';
    return;
  }

  container.classList.add('show');
  container.innerHTML = `
    <div class="label">Детали за ${point.date}</div>
    <div class="row-title">Тип тренировки: ${getActivityLabel(point.activityId)}</div>
    <div class="row-meta">Расстояние: ${(point.distanceM / 1000).toFixed(2)} км</div>
    <div class="row-meta">Время: ${formatDuration(point.durationSec)}</div>
    <div class="row-meta">Калории: ${Math.round(point.estCaloriesKcal || 0)} ккал</div>
  `;
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

function renderPeriodFilters(container, selected, onSelect) {
  container.innerHTML = '';
  Object.entries(PERIOD_LABELS).forEach(([id, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chip${String(selected) === id ? ' active' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', () => onSelect(Number(id)));
    container.appendChild(btn);
  });
}

function renderMetricFilters(container, selected, onSelect) {
  container.innerHTML = '';
  Object.entries(METRIC_LABELS).forEach(([id, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chip${selected === id ? ' active' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', () => onSelect(id));
    container.appendChild(btn);
  });
}

function renderSessions(container, sessions, onDelete) {
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
      const activityLabel = ACTIVITY_LABELS[s.activityId] || 'Активность';
      const kcal = Number(s.estCaloriesKcal) > 0
        ? Number(s.estCaloriesKcal)
        : estimateWorkoutCaloriesKcal(s.distanceM, s.durationSec);
      row.innerHTML = `
        <div class="row-head">
          <div class="row-title">${activityLabel} - ${km} км</div>
          <button type="button" class="row-delete-btn" data-session-id="${s.id}">Удалить</button>
        </div>
        <div class="row-meta">${formatDate(s.finishedAt || s.startedAt)} · ${formatDuration(s.durationSec)} · ${Math.round(kcal)} ккал</div>
      `;
      const deleteBtn = row.querySelector('.row-delete-btn');
      if (deleteBtn && typeof onDelete === 'function') {
        deleteBtn.addEventListener('click', () => onDelete(s));
      }
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

async function deleteSession(chatId, authToken, sessionId) {
  const query = new URLSearchParams({ chatId });
  if (authToken) query.set('authToken', authToken);
  const resp = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}?${query.toString()}`, {
    method: 'DELETE'
  });
  const json = await resp.json();
  if (!resp.ok || !json.ok) throw new Error(json.error || 'Не удалось удалить тренировку');
  return json;
}

async function init() {
  const { chatId, authToken } = getParams();
  const statusEl = document.getElementById('status');
  const errorBox = document.getElementById('errorBox');
  const filtersEl = document.getElementById('filters');
  const metricFiltersEl = document.getElementById('metricFilters');
  const periodFiltersEl = document.getElementById('periodFilters');
  const listEl = document.getElementById('sessionList');
  const dayDetailsEl = document.getElementById('dayDetails');
  const canvas = document.getElementById('chart');
  const chartTitleEl = document.querySelector('.chart-title');
  const summaryPanelEl = document.getElementById('summaryPanel');
  const summaryToggleEl = document.getElementById('summaryToggle');

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

  let sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  let selectedActivity = 'all';
  let selectedPeriodDays = 7;
  let selectedMetric = 'km';
  let selectedDayIndex = null;
  let currentPoints = [];
  let currentHitBoxes = [];
  let isSummaryOpen = true;

  function render() {
    const filtered = selectedActivity === 'all'
      ? sessions
      : sessions.filter((s) => s.activityId === selectedActivity);

    const distanceM = filtered.reduce((sum, s) => sum + (Number(s.distanceM) || 0), 0);
    const durationSec = filtered.reduce((sum, s) => sum + (Number(s.durationSec) || 0), 0);

    document.getElementById('totalKm').textContent = (distanceM / 1000).toFixed(2);
    document.getElementById('totalTime').textContent = formatDuration(durationSec);
    document.getElementById('totalSessions').textContent = String(filtered.length);
    document.getElementById('estCalories').textContent = formatTotalCaloriesSummary(durationSec, distanceM);

    const bestSession = filtered.reduce((best, s) => {
      const dist = Number(s.distanceM) || 0;
      if (!best || dist > (Number(best.distanceM) || 0)) return s;
      return best;
    }, null);
    document.getElementById('personalBest').textContent = bestSession
      ? `${((Number(bestSession.distanceM) || 0) / 1000).toFixed(2)} км`
      : '0.00 км';
    document.getElementById('personalBestDate').textContent = bestSession
      ? formatDate(bestSession.finishedAt || bestSession.startedAt)
      : '—';

    if (chartTitleEl) {
      chartTitleEl.textContent = getChartTitle(selectedMetric);
    }
    currentPoints = buildMetricSeries(filtered, selectedPeriodDays, selectedMetric);
    currentHitBoxes = drawChart(canvas, currentPoints, selectedMetric, selectedDayIndex);
    renderDayDetails(
      dayDetailsEl,
      Number.isInteger(selectedDayIndex) ? currentPoints[selectedDayIndex] || null : null
    );
    renderSessions(listEl, filtered, async (session) => {
      const confirmed = window.confirm('Удалить тренировку из истории?');
      if (!confirmed) return;
      try {
        await deleteSession(chatId, authToken, session.id);
        sessions = sessions.filter((s) => String(s.id) !== String(session.id));
        selectedDayIndex = null;
        render();
      } catch (err) {
        errorBox.textContent = err.message;
      }
    });
    renderFilters(filtersEl, selectedActivity, (id) => {
      selectedActivity = id;
      selectedDayIndex = null;
      render();
    });
    renderPeriodFilters(periodFiltersEl, selectedPeriodDays, (days) => {
      selectedPeriodDays = days;
      selectedDayIndex = null;
      render();
    });
    renderMetricFilters(metricFiltersEl, selectedMetric, (metric) => {
      selectedMetric = metric;
      selectedDayIndex = null;
      render();
    });
    statusEl.textContent = `Показаны данные: ${ACTIVITY_LABELS[selectedActivity]} · ${METRIC_LABELS[selectedMetric]} · период ${selectedPeriodDays} дн`;
  }

  render();
  if (summaryToggleEl && summaryPanelEl) {
    summaryToggleEl.addEventListener('click', () => {
      isSummaryOpen = !isSummaryOpen;
      summaryPanelEl.classList.toggle('hidden', !isSummaryOpen);
      summaryToggleEl.classList.toggle('active', isSummaryOpen);
    });
  }
  canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = currentHitBoxes.find(
      (box) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height
    );
    if (!hit) {
      if (selectedDayIndex !== null) {
        selectedDayIndex = null;
        render();
      }
      return;
    }
    event.stopPropagation();
    selectedDayIndex = hit.index;
    render();
  });
  document.addEventListener('click', () => {
    if (selectedDayIndex !== null) {
      selectedDayIndex = null;
      render();
    }
  });
  window.addEventListener('resize', render);
}

init();
