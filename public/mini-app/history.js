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

const MONTH_SHORT = ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
const DEFAULT_WEIGHT_KG = 70;

let profileWeightKg = null;
let profileAge = null;

function estimateCaloriesWithProfile(distanceM, durationSec) {
  const weight = Number.isFinite(Number(profileWeightKg)) && Number(profileWeightKg) > 0
    ? Number(profileWeightKg)
    : DEFAULT_WEIGHT_KG;
  const base = estimateWorkoutCaloriesKcal(distanceM, durationSec, weight);
  const age = Number(profileAge);
  if (!Number.isFinite(age) || age <= 0) return base;
  const ageFactor = Math.max(0.9, Math.min(1.1, 1 + (age - 30) * 0.002));
  return base * ageFactor;
}

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
  const kcal = estimateCaloriesWithProfile(distanceM, durationSec);
  if (!Number.isFinite(kcal) || kcal <= 0) return '—';
  return `${formatCaloriesKcalShort(kcal)} ккал`;
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatShortDate(isoDateKey) {
  const [, m, d] = isoDateKey.split('-');
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
    const fallbackCalories = estimateCaloriesWithProfile(s.distanceM, s.durationSec);
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
    const activityId = activityEntries.length ? activityEntries.sort((a, b) => b[1] - a[1])[0][0] : null;
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
    hitBoxes.push({ index: idx, x, y, width: barW, height: barH });
  });
  return hitBoxes;
}

function renderDayDetails(container, point) {
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

function renderFilters(container, selected, onSelect, labels = ACTIVITY_LABELS) {
  container.innerHTML = '';
  Object.entries(labels).forEach(([id, label]) => {
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

function inferRouteActivity(routeId, sessions) {
  const linked = sessions
    .filter((s) => String(s.plannedRouteId || '') === String(routeId) && s.activityId)
    .sort((a, b) => new Date(b.finishedAt || b.startedAt) - new Date(a.finishedAt || a.startedAt));
  return linked[0]?.activityId || 'all';
}

function renderRouteHistory(container, historyRecords, sessions, selectedActivity, onDelete) {
  container.innerHTML = '';
  const normalized = historyRecords
    .map((item) => ({
      ...item,
      activityId: item.activityId || inferRouteActivity(item.routeId, sessions)
    }))
    .filter((item) => selectedActivity === 'all' || item.activityId === selectedActivity)
    .slice()
    .reverse();

  if (!normalized.length) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = '<div class="row-meta">Пока нет сохраненных маршрутов</div>';
    container.appendChild(row);
    return;
  }

  normalized.slice(0, 30).forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'row';
    const activity = item.activityId && item.activityId !== 'all' ? ` · ${ACTIVITY_LABELS[item.activityId] || 'Активность'}` : '';
    row.innerHTML = `
      <div class="row-head">
        <div class="row-title">${idx + 1}. ${item.routeName || 'Маршрут'}</div>
        <button type="button" class="row-delete-btn">Удалить</button>
      </div>
      <div class="row-meta">${item.date || formatDate(item.timestamp)}${activity}</div>
    `;
    const deleteBtn = row.querySelector('.row-delete-btn');
    if (deleteBtn && typeof onDelete === 'function') {
      deleteBtn.addEventListener('click', () => onDelete(item));
    }
    container.appendChild(row);
  });
}

function getHeatLevel(value) {
  if (value <= 0) return 0;
  if (value < 3000) return 1;
  if (value < 7000) return 2;
  return 3;
}

function buildYearHeatmapData(sessions, days = 364) {
  const byDay = new Map();
  sessions.forEach((s) => {
    const key = getDayKey(s.finishedAt || s.startedAt);
    if (!key) return;
    byDay.set(key, (byDay.get(key) || 0) + (Number(s.distanceM) || 0));
  });

  const result = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = getDayKey(d);
    const distanceM = byDay.get(key) || 0;
    result.push({ key, date: d, distanceM, level: getHeatLevel(distanceM) });
  }
  return result;
}

function computeStreaks(heatmapDays) {
  let current = 0;
  for (let i = heatmapDays.length - 1; i >= 0; i--) {
    if (heatmapDays[i].distanceM > 0) current += 1;
    else break;
  }
  let best = 0;
  let run = 0;
  heatmapDays.forEach((day) => {
    if (day.distanceM > 0) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  });
  return { current, best };
}

function renderHomeRegularity(heatmapEl, sessions) {
  const days = buildYearHeatmapData(sessions, 364);
  heatmapEl.innerHTML = '';
  const byMonth = new Map();
  days.forEach((day) => {
    const key = `${day.date.getFullYear()}-${day.date.getMonth()}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(day);
  });

  Array.from(byMonth.entries()).forEach(([monthKey, monthDays]) => {
    const [, monthNumRaw] = monthKey.split('-');
    const monthNum = Number(monthNumRaw);
    const block = document.createElement('div');
    block.className = 'month-block';
    const grid = document.createElement('div');
    grid.className = 'month-grid';
    monthDays.forEach((day) => {
      const cell = document.createElement('div');
      cell.className = `heat-day${day.level ? ` lvl-${day.level}` : ''}`;
      cell.title = `${formatDate(day.date)}: ${((day.distanceM || 0) / 1000).toFixed(2)} км`;
      grid.appendChild(cell);
    });
    const label = document.createElement('div');
    label.className = 'month-label';
    label.textContent = MONTH_SHORT[monthNum] || '';
    block.appendChild(grid);
    block.appendChild(label);
    heatmapEl.appendChild(block);
  });
  return days;
}

function switchTab(tabId) {
  const tabs = Array.from(document.querySelectorAll('.tab-btn'));
  const panels = Array.from(document.querySelectorAll('.tab-panel'));
  tabs.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabId));
  panels.forEach((panel) => panel.classList.toggle('active', panel.id === `panel-${tabId}`));
}

async function fetchSessions(chatId, authToken) {
  const query = new URLSearchParams({ chatId });
  if (authToken) query.set('authToken', authToken);
  const resp = await fetch(`/api/sessions?${query.toString()}`, {
    headers: authToken ? { 'x-miniapp-auth': authToken } : {}
  });
  const contentType = (resp.headers.get('content-type') || '').toLowerCase();
  const rawText = await resp.text();
  if (!contentType.includes('application/json')) {
    throw new Error(`Сервер истории вернул не JSON (content-type: ${contentType || 'unknown'})`);
  }
  let json;
  try {
    json = JSON.parse(rawText);
  } catch (_err) {
    throw new Error('Некорректный JSON от /api/sessions');
  }
  if (!resp.ok || !json.ok) throw new Error(json.error || 'Не удалось загрузить историю');
  return json;
}

async function saveProfile(chatId, authToken, profile) {
  const query = new URLSearchParams({ chatId });
  if (authToken) query.set('authToken', authToken);
  const resp = await fetch(`/api/profile?${query.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { 'x-miniapp-auth': authToken } : {})
    },
    body: JSON.stringify(profile)
  });
  const json = await resp.json();
  if (!resp.ok || !json?.ok) throw new Error(json?.error || 'Не удалось сохранить профиль');
  return json.profile || {};
}

async function saveLocation(chatId, authToken, latitude, longitude) {
  const query = new URLSearchParams({ chatId });
  if (authToken) query.set('authToken', authToken);
  const resp = await fetch(`/api/profile/location?${query.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { 'x-miniapp-auth': authToken } : {})
    },
    body: JSON.stringify({ latitude, longitude })
  });
  const json = await resp.json();
  if (!resp.ok || !json?.ok) throw new Error(json?.error || 'Не удалось сохранить местоположение');
  return json.profile || {};
}

async function deleteHistoryEntry(chatId, authToken, entry) {
  const query = new URLSearchParams({
    chatId,
    routeId: String(entry.routeId || ''),
    timestamp: String(entry.timestamp || '')
  });
  if (authToken) query.set('authToken', authToken);
  const resp = await fetch(`/api/history?${query.toString()}`, {
    method: 'DELETE',
    headers: authToken ? { 'x-miniapp-auth': authToken } : {}
  });
  const json = await resp.json();
  if (!resp.ok || !json?.ok) throw new Error(json?.error || 'Не удалось удалить запись истории');
  return true;
}

async function init() {
  const { chatId, authToken } = getParams();
  const statusEl = document.getElementById('status');
  const errorBox = document.getElementById('errorBox');
  const filtersEl = document.getElementById('filters');
  const metricFiltersEl = document.getElementById('metricFilters');
  const periodFiltersEl = document.getElementById('periodFilters');
  const historyFiltersEl = document.getElementById('historyFilters');
  const routeHistoryEl = document.getElementById('routeHistoryList');
  const dayDetailsEl = document.getElementById('dayDetails');
  const canvas = document.getElementById('chart');
  const chartTitleEl = document.querySelector('.chart-title');
  const homeUserNameEl = document.getElementById('homeUserName');
  const homeTodayStatusEl = document.getElementById('homeTodayStatus');
  const regularityHeatmapEl = document.getElementById('regularityHeatmap');
  const userWeightInputEl = document.getElementById('userWeightInput');
  const userAgeInputEl = document.getElementById('userAgeInput');
  const saveUserProfileBtnEl = document.getElementById('saveUserProfileBtn');
  const userProfileStatusEl = document.getElementById('userProfileStatus');
  const locationStatusEl = document.getElementById('locationStatus');
  const updateLocationBtnEl = document.getElementById('updateLocationBtn');

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

  const allSessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  let historyRecords = Array.isArray(payload.history) ? [...payload.history] : [];
  const fullName = (payload.profile && typeof payload.profile.fullName === 'string' && payload.profile.fullName.trim()) || 'Пользователь';
  profileWeightKg = payload?.profile?.weightKg ?? null;
  profileAge = payload?.profile?.age ?? null;
  homeUserNameEl.textContent = fullName;
  if (userWeightInputEl) userWeightInputEl.value = Number.isFinite(Number(profileWeightKg)) ? String(profileWeightKg) : '';
  if (userAgeInputEl) userAgeInputEl.value = Number.isFinite(Number(profileAge)) ? String(profileAge) : '';
  if (locationStatusEl) {
    locationStatusEl.textContent = payload?.profile?.hasLocation
      ? 'Геолокация указана'
      : 'Геолокация не указана';
  }

  let listSessions = [...allSessions];
  let selectedActivity = 'all';
  let selectedPeriodDays = 7;
  let selectedMetric = 'km';
  let selectedDayIndex = null;
  let selectedHistoryActivity = 'all';
  let currentPoints = [];
  let currentHitBoxes = [];

  const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  function renderAll() {
    const metricsFiltered = selectedActivity === 'all'
      ? allSessions
      : allSessions.filter((s) => s.activityId === selectedActivity);
    const distanceM = metricsFiltered.reduce((sum, s) => sum + (Number(s.distanceM) || 0), 0);
    const durationSec = metricsFiltered.reduce((sum, s) => sum + (Number(s.durationSec) || 0), 0);
    document.getElementById('totalKm').textContent = (distanceM / 1000).toFixed(2);
    document.getElementById('totalTime').textContent = formatDuration(durationSec);
    document.getElementById('totalSessions').textContent = String(metricsFiltered.length);
    document.getElementById('estCalories').textContent = formatTotalCaloriesSummary(durationSec, distanceM);

    const bestSession = metricsFiltered.reduce((best, s) => {
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

    chartTitleEl.textContent = getChartTitle(selectedMetric);
    currentPoints = buildMetricSeries(metricsFiltered, selectedPeriodDays, selectedMetric);
    currentHitBoxes = drawChart(canvas, currentPoints, selectedMetric, selectedDayIndex);
    renderDayDetails(dayDetailsEl, Number.isInteger(selectedDayIndex) ? currentPoints[selectedDayIndex] || null : null);

    renderRouteHistory(routeHistoryEl, historyRecords, listSessions, selectedHistoryActivity, async (entry) => {
      const confirmed = window.confirm('Удалить прохождение маршрута из истории?');
      if (!confirmed) return;
      try {
        await deleteHistoryEntry(chatId, authToken, entry);
        historyRecords = historyRecords.filter(
          (h) => !(String(h.routeId || '') === String(entry.routeId || '') && String(h.timestamp || '') === String(entry.timestamp || ''))
        );
        renderAll();
      } catch (err) {
        errorBox.textContent = err.message;
      }
    });

    renderFilters(filtersEl, selectedActivity, (id) => {
      selectedActivity = id;
      selectedDayIndex = null;
      renderAll();
    });
    renderPeriodFilters(periodFiltersEl, selectedPeriodDays, (days) => {
      selectedPeriodDays = days;
      selectedDayIndex = null;
      renderAll();
    });
    renderMetricFilters(metricFiltersEl, selectedMetric, (metric) => {
      selectedMetric = metric;
      selectedDayIndex = null;
      renderAll();
    });
    renderFilters(historyFiltersEl, selectedHistoryActivity, (id) => {
      selectedHistoryActivity = id;
      renderAll();
    });

    const heatmapDays = renderHomeRegularity(regularityHeatmapEl, listSessions);
    const today = getDayKey(new Date());
    const trainedToday = heatmapDays.some((d) => d.key === today && d.distanceM > 0);
    homeTodayStatusEl.textContent = trainedToday ? 'Сегодня тренировка есть' : 'Сегодня тренировки не было';
    const streaks = computeStreaks(heatmapDays);
    document.getElementById('streakNow').textContent = String(streaks.current);
    document.getElementById('streakMax').textContent = String(streaks.best);
    document.getElementById('homeTotalSessions').textContent = String(listSessions.length);

    const weightText = Number.isFinite(Number(profileWeightKg)) ? `${profileWeightKg} кг` : 'примерный вес';
    statusEl.textContent = `Данные обновлены · ${listSessions.length} тренировок · ${weightText}`;
  }

  renderAll();

  canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = currentHitBoxes.find((box) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height);
    if (!hit) {
      if (selectedDayIndex !== null) {
        selectedDayIndex = null;
        renderAll();
      }
      return;
    }
    event.stopPropagation();
    selectedDayIndex = hit.index;
    renderAll();
  });

  document.addEventListener('click', () => {
    if (selectedDayIndex !== null) {
      selectedDayIndex = null;
      renderAll();
    }
  });

  window.addEventListener('resize', renderAll);

  if (saveUserProfileBtnEl) {
    saveUserProfileBtnEl.addEventListener('click', async () => {
      try {
        const weightValRaw = String(userWeightInputEl?.value || '').trim();
        const ageValRaw = String(userAgeInputEl?.value || '').trim();
        const weightVal = weightValRaw === '' ? null : Number(weightValRaw);
        const ageVal = ageValRaw === '' ? null : Number(ageValRaw);
        if (weightVal !== null && (!Number.isFinite(weightVal) || weightVal < 10 || weightVal > 250)) {
          if (userProfileStatusEl) userProfileStatusEl.textContent = 'Введите действительные данные';
          return;
        }
        if (ageVal !== null && (!Number.isFinite(ageVal) || ageVal < 0 || ageVal > 110)) {
          if (userProfileStatusEl) userProfileStatusEl.textContent = 'Введите действительные данные';
          return;
        }
        const profile = await saveProfile(chatId, authToken, {
          weightKg: weightVal,
          age: ageVal
        });
        profileWeightKg = profile.weightKg ?? null;
        profileAge = profile.age ?? null;
        const resolvedName = (profile.fullName || '').trim() || 'Пользователь';
        homeUserNameEl.textContent = resolvedName;
        if (userProfileStatusEl) userProfileStatusEl.textContent = 'Данные сохранены';
        renderAll();
      } catch (err) {
        if (userProfileStatusEl) userProfileStatusEl.textContent = err.message || 'Ошибка сохранения профиля';
      }
    });
  }

  if (updateLocationBtnEl) {
    updateLocationBtnEl.addEventListener('click', () => {
      if (!navigator.geolocation) {
        if (locationStatusEl) locationStatusEl.textContent = 'Геолокация недоступна на устройстве';
        return;
      }
      if (locationStatusEl) locationStatusEl.textContent = 'Определяем местоположение...';
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const profile = await saveLocation(chatId, authToken, pos.coords.latitude, pos.coords.longitude);
            if (locationStatusEl) {
              locationStatusEl.textContent = profile?.hasLocation
                ? 'Геолокация сохранена'
                : 'Геолокация не указана';
            }
          } catch (err) {
            if (locationStatusEl) locationStatusEl.textContent = err.message || 'Ошибка сохранения геолокации';
          }
        },
        () => {
          if (locationStatusEl) locationStatusEl.textContent = 'Не удалось получить геолокацию';
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    });
  }
}

init();
