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
const DEFAULT_HEIGHT_CM = 170;
const DEFAULT_SEX = 'male';
const ACTIVITY_MET = {
  running: 9.0,
  nordic_walking: 6.5,
  cycling: 8.0,
  unknown: 7.0
};

let profileWeightKg = null;
let profileAge = null;
let profileHeightCm = null;
let profileSex = null;

function resolveProfileForCalories() {
  const weight = Number(profileWeightKg);
  const age = Number(profileAge);
  const heightCm = Number(profileHeightCm);
  const sexRaw = String(profileSex || '').toLowerCase();
  return {
    weightKg: Number.isFinite(weight) && weight > 0 ? weight : DEFAULT_WEIGHT_KG,
    age: Number.isFinite(age) && age > 0 ? age : 30,
    heightCm: Number.isFinite(heightCm) && heightCm >= 50 && heightCm <= 290 ? heightCm : DEFAULT_HEIGHT_CM,
    sex: sexRaw === 'male' || sexRaw === 'female' ? sexRaw : DEFAULT_SEX
  };
}

function estimateCaloriesWithProfile(distanceM, durationSec, activityId = null) {
  const p = resolveProfileForCalories();
  const bmr = (10 * p.weightKg) + (6.25 * p.heightCm) - (5 * p.age) + (p.sex === 'male' ? 5 : -161);
  const hours = Math.max(0, Number(durationSec) || 0) / 3600;
  const met = ACTIVITY_MET[String(activityId || 'unknown').toLowerCase()] || ACTIVITY_MET.unknown;
  const kcal = (bmr / 24) * hours * met;
  if (Number.isFinite(kcal) && kcal > 0) return kcal;
  return estimateWorkoutCaloriesKcal(distanceM, durationSec, p.weightKg);
}

function getParams() {
  const params = new URLSearchParams(window.location.search);
  const readMaxInitDataRaw = () => {
    const fromWebApp = window.WebApp?.initData;
    if (typeof fromWebApp === 'string' && fromWebApp.trim()) return fromWebApp.trim();
    const hashRaw = String(window.location.hash || '');
    if (!hashRaw) return '';
    const fragment = hashRaw.startsWith('#') ? hashRaw.slice(1) : hashRaw;
    const fragmentParams = new URLSearchParams(fragment);
    const webAppData = fragmentParams.get('WebAppData') || fragmentParams.get('tgWebAppData') || '';
    if (!webAppData) return '';
    try {
      return decodeURIComponent(webAppData);
    } catch {
      return webAppData;
    }
  };
  const maxInitData = readMaxInitDataRaw();
  const extractChatIdFromInitData = (raw) => {
    if (!raw) return null;
    const p = new URLSearchParams(raw);
    const direct = p.get('chat_id') || p.get('chatId') || p.get('user_id') || p.get('userId');
    if (direct && /^\d+$/.test(String(direct))) return String(direct);
    const parseObj = (value) => {
      if (!value) return null;
      const attempts = [value];
      try {
        attempts.push(decodeURIComponent(value));
      } catch {
        // игнорируем ошибку декодирования
      }
      for (const item of attempts) {
        try {
          const parsed = JSON.parse(item);
          if (parsed && typeof parsed === 'object') return parsed;
        } catch {
          // игнорируем ошибку парсинга
        }
      }
      return null;
    };
    const userObj = parseObj(p.get('user'));
    const chatObj = parseObj(p.get('chat'));
    const nested = userObj?.id || chatObj?.id || chatObj?.chat_id || chatObj?.chatId;
    if (nested && /^\d+$/.test(String(nested))) return String(nested);
    return null;
  };
  return {
    chatId: params.get('chatId') || extractChatIdFromInitData(maxInitData),
    authToken: params.get('authToken'),
    maxInitData
  };
}

let closeConfirmationBound = false;
function enableMiniAppCloseConfirmation() {
  if (closeConfirmationBound) return;
  closeConfirmationBound = true;
  const webApp = window.WebApp || window.Telegram?.WebApp || null;
  if (!webApp) return;
  try {
    if (typeof webApp.ready === 'function') webApp.ready();
  } catch {
    // без действия
  }
  try {
    if (typeof webApp.enableClosingConfirmation === 'function') webApp.enableClosingConfirmation();
  } catch {
    // без действия
  }
  try {
    if (typeof webApp.setClosingConfirmation === 'function') webApp.setClosingConfirmation(true);
  } catch {
    // без действия
  }
  try {
    if (typeof webApp.setupClosingBehavior === 'function') {
      webApp.setupClosingBehavior({ need_confirmation: true });
    }
  } catch {
    // без действия
  }
}

function buildAuthHeaders(authToken, maxInitData) {
  const headers = {};
  if (authToken) headers['x-miniapp-auth'] = authToken;
  if (maxInitData) headers['x-max-init-data'] = encodeURIComponent(maxInitData);
  return headers;
}

function buildAuthQuery(chatId, authToken, maxInitData) {
  const query = new URLSearchParams();
  if (chatId) query.set('chatId', String(chatId));
  if (authToken) query.set('authToken', authToken);
  // Держим maxInitData вне URL, чтобы не раздувать query-строку в WebView/прокси-цепочках.
  void maxInitData;
  return query;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(input, init = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchWithRetry(input, init = {}, options = {}) {
  const retries = Number.isFinite(options.retries) ? options.retries : 2;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 12000;
  const retryDelays = Array.isArray(options.retryDelays) ? options.retryDelays : [900, 1800, 3200];
  const retryStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(input, init, timeoutMs);
      if (retryStatuses.has(response.status) && attempt < retries) {
        await sleep(retryDelays[Math.min(attempt, retryDelays.length - 1)] || 1000);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await sleep(retryDelays[Math.min(attempt, retryDelays.length - 1)] || 1000);
    }
  }
  throw lastError || new Error('network-request-failed');
}

function getSessionsCacheKey(chatId) {
  return `livetrack.history.payload.v1:${String(chatId || 'unknown')}`;
}

function saveSessionsPayloadCache(chatId, payload) {
  try {
    localStorage.setItem(
      getSessionsCacheKey(chatId),
      JSON.stringify({
        cachedAt: new Date().toISOString(),
        payload
      })
    );
  } catch {
    // В ограниченных WebView localStorage может быть недоступен — молча пропускаем.
  }
}

function readSessionsPayloadCache(chatId) {
  try {
    const raw = localStorage.getItem(getSessionsCacheKey(chatId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.payload !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
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
    const fallbackCalories = estimateCaloriesWithProfile(s.distanceM, s.durationSec, s.activityId);
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

function drawChart(canvas, points, metric, selectedIndex, options = {}) {
  const {
    animationProgress = 1,
    hoverIndex = null
  } = options;
  const { ctx, w, h } = prepareCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const bgGradient = ctx.createLinearGradient(0, 0, 0, h);
  bgGradient.addColorStop(0, '#141a22');
  bgGradient.addColorStop(1, '#11161d');
  ctx.fillStyle = bgGradient;
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
  const bottom = 42;
  const plotW = w - left - right;
  const plotH = h - top - bottom;
  const stepX = plotW / points.length;
  const barW = Math.max(4, Math.floor(stepX) - 5);
  const progress = Math.max(0, Math.min(1, Number(animationProgress) || 0));
  const easedProgress = 1 - Math.pow(1 - progress, 3);

  ctx.strokeStyle = '#25303c';
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
    const finalBarH = Math.max(2, (p.value / max) * plotH);
    const barH = Math.max(2, finalBarH * easedProgress);
    const y = top + (plotH - barH);
    const isFocused = idx === selectedIndex || idx === hoverIndex;
    const gradient = ctx.createLinearGradient(0, y, 0, y + barH);
    gradient.addColorStop(0, isFocused ? '#55de8c' : '#44cf7c');
    gradient.addColorStop(1, isFocused ? '#1f8e53' : '#1d7447');
    ctx.fillStyle = gradient;
    const radius = Math.min(7, Math.floor(barW / 2), Math.floor(barH / 2));
    ctx.beginPath();
    ctx.moveTo(x, y + barH);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.lineTo(x + barW - radius, y);
    ctx.quadraticCurveTo(x + barW, y, x + barW, y + radius);
    ctx.lineTo(x + barW, y + barH);
    ctx.closePath();
    ctx.fill();
    if (isFocused) {
      ctx.strokeStyle = '#d9f2e4';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#4ad17d';
      ctx.fillRect(x - 2, y - 6, barW + 4, barH + 8);
      ctx.restore();
    }
    ctx.fillStyle = '#9da7b3';
    ctx.font = '10px sans-serif';
    if (points.length <= 10 || idx % 3 === 0 || idx === points.length - 1) {
      ctx.fillText(p.date, x, h - 18);
    }
    if (p.value > 0 && (isFocused || points.length <= 10)) {
      ctx.fillStyle = '#dfe6ee';
      ctx.font = '10px sans-serif';
      const valueLabel = metric === 'calories' ? String(Math.round(p.value)) : p.value.toFixed(1);
      ctx.fillText(valueLabel, x, y - 4);
    }
    hitBoxes.push({
      index: idx,
      x,
      y: top + (plotH - finalBarH),
      width: barW,
      height: finalBarH,
      centerX: x + barW / 2
    });
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
    row.innerHTML = '<div class="row-meta">Пока нет сохраненных маршрутов. Начните первую тренировку в мини-приложении.</div>';
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

async function fetchSessions(chatId, authToken, maxInitData) {
  const query = buildAuthQuery(chatId, authToken, maxInitData);
  const resp = await fetchWithRetry(
    `/api/sessions?${query.toString()}`,
    { headers: buildAuthHeaders(authToken, maxInitData) },
    { retries: 2, timeoutMs: 12000 }
  );
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

async function saveProfile(chatId, authToken, maxInitData, profile) {
  const query = buildAuthQuery(chatId, authToken, maxInitData);
  const resp = await fetchWithRetry(`/api/profile?${query.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(authToken, maxInitData)
    },
    body: JSON.stringify(profile)
  }, { retries: 0, timeoutMs: 12000 });
  const json = await resp.json();
  if (!resp.ok || !json?.ok) throw new Error(json?.error || 'Не удалось сохранить профиль');
  return json.profile || {};
}

async function saveLocation(chatId, authToken, maxInitData, latitude, longitude) {
  const query = buildAuthQuery(chatId, authToken, maxInitData);
  const resp = await fetchWithRetry(`/api/profile/location?${query.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(authToken, maxInitData)
    },
    body: JSON.stringify({ latitude, longitude })
  }, { retries: 0, timeoutMs: 12000 });
  const json = await resp.json();
  if (!resp.ok || !json?.ok) throw new Error(json?.error || 'Не удалось сохранить местоположение');
  return json.profile || {};
}

async function deleteHistoryEntry(chatId, authToken, maxInitData, entry) {
  const query = buildAuthQuery(chatId, authToken, maxInitData);
  query.set('routeId', String(entry.routeId || ''));
  query.set('timestamp', String(entry.timestamp || ''));
  const resp = await fetchWithRetry(`/api/history?${query.toString()}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(authToken, maxInitData)
  }, { retries: 0, timeoutMs: 12000 });
  const json = await resp.json();
  if (!resp.ok || !json?.ok) throw new Error(json?.error || 'Не удалось удалить запись истории');
  return true;
}

async function init() {
  enableMiniAppCloseConfirmation();
  const { chatId, authToken, maxInitData } = getParams();
  const statusEl = document.getElementById('status');
  const errorBox = document.getElementById('errorBox');
  const filtersEl = document.getElementById('filters');
  const metricFiltersEl = document.getElementById('metricFilters');
  const periodFiltersEl = document.getElementById('periodFilters');
  const historyFiltersEl = document.getElementById('historyFilters');
  const routeHistoryEl = document.getElementById('routeHistoryList');
  const dayDetailsEl = document.getElementById('dayDetails');
  const canvas = document.getElementById('chart');
  const chartTooltipEl = document.getElementById('chartTooltip');
  const chartTitleEl = document.querySelector('.chart-title');
  const homeUserNameEl = document.getElementById('homeUserName');
  const homeTodayStatusEl = document.getElementById('homeTodayStatus');
  const regularityHeatmapEl = document.getElementById('regularityHeatmap');
  const userWeightInputEl = document.getElementById('userWeightInput');
  const userAgeInputEl = document.getElementById('userAgeInput');
  const userHeightInputEl = document.getElementById('userHeightInput');
  const userSexSelectEl = document.getElementById('userSexSelect');
  const saveUserProfileBtnEl = document.getElementById('saveUserProfileBtn');
  const userProfileStatusEl = document.getElementById('userProfileStatus');
  const locationStatusEl = document.getElementById('locationStatus');
  const updateLocationBtnEl = document.getElementById('updateLocationBtn');

  if (!chatId && !maxInitData) {
    errorBox.textContent = 'Не удалось авторизоваться в мини-приложении. Откройте экран снова из бота.';
    statusEl.textContent = 'Ошибка авторизации';
    return;
  }

  let payload;
  let loadedFromCache = false;
  try {
    payload = await fetchSessions(chatId, authToken, maxInitData);
  } catch (err) {
    const cached = readSessionsPayloadCache(chatId);
    if (!cached?.payload) {
      statusEl.textContent = 'Не удалось загрузить данные';
      errorBox.textContent = err.message;
      return;
    }
    payload = cached.payload;
    loadedFromCache = true;
    statusEl.textContent = 'Вы офлайн';
    errorBox.textContent = 'Сеть нестабильна. Показываю последние сохранённые данные.';
  }
  saveSessionsPayloadCache(chatId, payload);
  if (!loadedFromCache) {
    statusEl.textContent = 'Данные обновлены';
    errorBox.textContent = '';
  }

  const allSessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  let historyRecords = Array.isArray(payload.history) ? [...payload.history] : [];
  const fullName = (payload.profile && typeof payload.profile.fullName === 'string' && payload.profile.fullName.trim()) || 'Пользователь';
  profileWeightKg = payload?.profile?.weightKg ?? null;
  profileAge = payload?.profile?.age ?? null;
  profileHeightCm = payload?.profile?.heightCm ?? null;
  profileSex = payload?.profile?.sex ?? null;
  homeUserNameEl.textContent = fullName;
  if (userWeightInputEl) userWeightInputEl.value = Number.isFinite(Number(profileWeightKg)) ? String(profileWeightKg) : '';
  if (userAgeInputEl) userAgeInputEl.value = Number.isFinite(Number(profileAge)) ? String(profileAge) : '';
  if (userHeightInputEl) userHeightInputEl.value = Number.isFinite(Number(profileHeightCm)) ? String(profileHeightCm) : '';
  if (userSexSelectEl) userSexSelectEl.value = (profileSex === 'male' || profileSex === 'female') ? profileSex : '';
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
  let currentHoverIndex = null;
  let chartAnimationRafId = null;
  let chartAnimationToken = 0;
  let locationRetryTimerId = null;
  const LOCATION_RETRY_MS = 15000;

  function hideChartTooltip() {
    if (!chartTooltipEl) return;
    chartTooltipEl.classList.remove('show');
    chartTooltipEl.innerHTML = '';
  }

  function showChartTooltip(point, box, canvasRect) {
    if (!chartTooltipEl || !point || !box || !canvasRect) return;
    chartTooltipEl.innerHTML = `
      <div class="tt-title">${point.date} · ${getActivityLabel(point.activityId)}</div>
      <div>Расстояние: ${(point.distanceM / 1000).toFixed(2)} км</div>
      <div>Время: ${formatDuration(point.durationSec)}</div>
      <div>Калории: ${Math.round(point.estCaloriesKcal || 0)} ккал</div>
    `;
    const x = Math.min(canvasRect.width - 8, Math.max(8, box.centerX));
    const y = Math.max(18, box.y);
    chartTooltipEl.style.left = `${x}px`;
    chartTooltipEl.style.top = `${y}px`;
    chartTooltipEl.classList.add('show');
  }

  function renderChartAnimated(animated = true) {
    chartAnimationToken += 1;
    const token = chartAnimationToken;
    if (chartAnimationRafId !== null && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(chartAnimationRafId);
      chartAnimationRafId = null;
    }
    if (!animated) {
      currentHitBoxes = drawChart(canvas, currentPoints, selectedMetric, selectedDayIndex, {
        animationProgress: 1,
        hoverIndex: currentHoverIndex
      });
      return;
    }
    const startedAt = performance.now();
    const durationMs = 460;
    const tick = () => {
      if (token !== chartAnimationToken) return;
      const progress = Math.min(1, (performance.now() - startedAt) / durationMs);
      currentHitBoxes = drawChart(canvas, currentPoints, selectedMetric, selectedDayIndex, {
        animationProgress: progress,
        hoverIndex: currentHoverIndex
      });
      if (progress >= 1) {
        chartAnimationRafId = null;
        return;
      }
      chartAnimationRafId = window.requestAnimationFrame(tick);
    };
    chartAnimationRafId = window.requestAnimationFrame(tick);
  }

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
    renderChartAnimated(true);
    renderDayDetails(dayDetailsEl, Number.isInteger(selectedDayIndex) ? currentPoints[selectedDayIndex] || null : null);

    renderRouteHistory(routeHistoryEl, historyRecords, listSessions, selectedHistoryActivity, async (entry) => {
      const confirmed = window.confirm('Удалить прохождение маршрута из истории?');
      if (!confirmed) return;
      try {
        await deleteHistoryEntry(chatId, authToken, maxInitData, entry);
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
    currentHoverIndex = hit.index;
    renderAll();
    showChartTooltip(currentPoints[hit.index], hit, rect);
  });

  canvas.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = currentHitBoxes.find((box) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height);
    if (!hit) {
      if (currentHoverIndex !== null) {
        currentHoverIndex = null;
        renderChartAnimated(false);
      }
      hideChartTooltip();
      return;
    }
    if (currentHoverIndex !== hit.index) {
      currentHoverIndex = hit.index;
      renderChartAnimated(false);
    }
    showChartTooltip(currentPoints[hit.index], hit, rect);
  });

  canvas.addEventListener('mouseleave', () => {
    currentHoverIndex = null;
    hideChartTooltip();
    renderChartAnimated(false);
  });

  document.addEventListener('click', () => {
    if (selectedDayIndex !== null) {
      selectedDayIndex = null;
      renderAll();
    }
    hideChartTooltip();
  });

  window.addEventListener('resize', renderAll);

  if (saveUserProfileBtnEl) {
    saveUserProfileBtnEl.addEventListener('click', async () => {
      try {
        const weightValRaw = String(userWeightInputEl?.value || '').trim();
        const ageValRaw = String(userAgeInputEl?.value || '').trim();
        const heightValRaw = String(userHeightInputEl?.value || '').trim();
        const sexValRaw = String(userSexSelectEl?.value || '').trim().toLowerCase();
        const weightVal = weightValRaw === '' ? null : Number(weightValRaw);
        const ageVal = ageValRaw === '' ? null : Number(ageValRaw);
        const heightVal = heightValRaw === '' ? null : Number(heightValRaw);
        const sexVal = sexValRaw === '' ? null : sexValRaw;
        if (weightVal !== null && (!Number.isFinite(weightVal) || weightVal < 10 || weightVal > 250)) {
          if (userProfileStatusEl) userProfileStatusEl.textContent = 'Введите действительные данные';
          return;
        }
        if (ageVal !== null && (!Number.isFinite(ageVal) || ageVal < 0 || ageVal > 110)) {
          if (userProfileStatusEl) userProfileStatusEl.textContent = 'Введите действительные данные';
          return;
        }
        if (heightVal !== null && (!Number.isFinite(heightVal) || heightVal < 50 || heightVal > 290)) {
          if (userProfileStatusEl) userProfileStatusEl.textContent = 'Введите действительные данные';
          return;
        }
        if (sexVal !== null && sexVal !== 'male' && sexVal !== 'female') {
          if (userProfileStatusEl) userProfileStatusEl.textContent = 'Введите действительные данные';
          return;
        }
        const profile = await saveProfile(chatId, authToken, maxInitData, {
          weightKg: weightVal,
          age: ageVal,
          heightCm: heightVal,
          sex: sexVal
        });
        profileWeightKg = profile.weightKg ?? null;
        profileAge = profile.age ?? null;
        profileHeightCm = profile.heightCm ?? null;
        profileSex = profile.sex ?? null;
        const resolvedName = (profile.fullName || '').trim() || 'Пользователь';
        homeUserNameEl.textContent = resolvedName;
        if (userProfileStatusEl) userProfileStatusEl.textContent = 'Данные сохранены';
        renderAll();
      } catch (err) {
        if (userProfileStatusEl) userProfileStatusEl.textContent = 'Не удалось сохранить данные профиля';
      }
    });
  }

  if (updateLocationBtnEl) {
    const stopLocationRetry = () => {
      if (locationRetryTimerId !== null) {
        clearInterval(locationRetryTimerId);
        locationRetryTimerId = null;
      }
    };
    const resolveLocationErrorMessage = (err) => {
      const code = Number(err?.code);
      if (code === 1) return 'Доступ к геолокации запрещен. Разрешите доступ в настройках MAX.';
      if (code === 2) return 'Не удалось определить координаты. Попробуйте выйти на открытое место.';
      if (code === 3) return 'Превышено время ожидания геолокации. Проверьте интернет и попробуйте снова.';
      return 'Не удалось получить геолокацию. Попробуйте снова через несколько секунд.';
    };
    const shouldRetryLocation = (err) => {
      const code = Number(err?.code);
      return code !== 1;
    };
    const requestCurrentPosition = () => {
      return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos),
          () => {
            // Режим с менее строгими параметрами для слабого сигнала/помещений.
            navigator.geolocation.getCurrentPosition(
              (pos) => resolve(pos),
              (errLow) => reject(errLow),
              { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 }
            );
          },
          { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
        );
      });
    };
    const attemptLocationSave = async () => {
      if (!navigator.geolocation) {
        if (locationStatusEl) locationStatusEl.textContent = 'Геолокация недоступна на устройстве';
        stopLocationRetry();
        return;
      }
      try {
        const pos = await requestCurrentPosition();
        const profile = await saveLocation(chatId, authToken, maxInitData, pos.coords.latitude, pos.coords.longitude);
        if (locationStatusEl) {
          locationStatusEl.textContent = profile?.hasLocation
            ? 'Геолокация сохранена'
            : 'Геолокация не указана';
        }
        stopLocationRetry();
      } catch (err) {
        if (locationStatusEl) {
          locationStatusEl.textContent = resolveLocationErrorMessage(err);
        }
        if (!shouldRetryLocation(err)) {
          stopLocationRetry();
          return;
        }
        if (locationRetryTimerId === null) {
          locationRetryTimerId = setInterval(() => {
            attemptLocationSave();
          }, LOCATION_RETRY_MS);
        }
      }
    };
    updateLocationBtnEl.addEventListener('click', () => {
      if (!navigator.geolocation) {
        if (locationStatusEl) locationStatusEl.textContent = 'Геолокация недоступна на устройстве';
        return;
      }
      if (locationStatusEl) locationStatusEl.textContent = 'Определяю местоположение...';
      stopLocationRetry();
      attemptLocationSave();
    });
  }
}

init();
