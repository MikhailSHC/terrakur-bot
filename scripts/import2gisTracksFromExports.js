#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const routes = require('../data/routesData');

const EXPORT_FILES = [
  'C:/Users/shchu/OneDrive/Desktop/Маршруты Кисловодска (обновлено)',
  'C:/Users/shchu/OneDrive/Desktop/Маршруты Пятигорска',
  'C:/Users/shchu/OneDrive/Desktop/Маршруты Ставрополь (обновленные)'
];

const SKIP_ROUTE_IDS = new Set(['kholodnye-rodniki']);

function extractAllJsonObjects(text) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, i + 1);
        try {
          objects.push(JSON.parse(candidate));
        } catch (err) {
          // пропускаем невалидные фрагменты
        }
        start = -1;
      }
    }
  }

  return objects;
}

function parseLineString(selection) {
  if (typeof selection !== 'string') return [];
  const match = selection.match(/^LINESTRING\s*\((.+)\)\s*$/i);
  if (!match) return [];

  const pairs = match[1].split(',');
  const points = [];
  for (const raw of pairs) {
    const [lonRaw, latRaw] = raw.trim().split(/\s+/);
    const lon = Number(lonRaw);
    const lat = Number(latRaw);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      points.push([lat, lon]);
    }
  }
  return points;
}

function dedupeSequential(points) {
  const out = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  return out;
}

function extractTrackFromPayload(payload) {
  const maneuvers = payload?.result?.[0]?.maneuvers;
  if (!Array.isArray(maneuvers)) return [];
  const points = [];
  for (const m of maneuvers) {
    const geometry = m?.outcoming_path?.geometry;
    if (!Array.isArray(geometry)) continue;
    for (const g of geometry) {
      points.push(...parseLineString(g?.selection));
    }
  }
  return dedupeSequential(points);
}

function getQueryEndpoints(payload) {
  const points = payload?.query?.points;
  if (!Array.isArray(points) || points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const a = [Number(first?.lat), Number(first?.lon)];
  const b = [Number(last?.lat), Number(last?.lon)];
  if (!Number.isFinite(a[0]) || !Number.isFinite(a[1]) || !Number.isFinite(b[0]) || !Number.isFinite(b[1])) {
    return null;
  }
  return { start: a, end: b };
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function routeEndpoints(route) {
  if (!Array.isArray(route.track) || route.track.length < 2) return null;
  return {
    start: route.track[0],
    end: route.track[route.track.length - 1]
  };
}

function findBestRouteMatch(payload) {
  const endpoints = getQueryEndpoints(payload);
  if (!endpoints) return null;

  let best = null;
  for (const route of routes) {
    if (SKIP_ROUTE_IDS.has(route.id)) continue;
    if (route.status !== 'active') continue;
    const ep = routeEndpoints(route);
    if (!ep) continue;

    const direct = dist(endpoints.start, ep.start) + dist(endpoints.end, ep.end);
    const reverse = dist(endpoints.start, ep.end) + dist(endpoints.end, ep.start);
    const score = Math.min(direct, reverse);

    if (!best || score < best.score) {
      best = { route, score };
    }
  }

  // Строгий порог: начало/конец должны быть рядом с текущим схематичным треком.
  if (!best || best.score > 0.02) return null;
  return best.route;
}

function buildTrackLiteral(track) {
  return `[\n${track.map((p) => `      [${p[0]}, ${p[1]}]`).join(',\n')}\n    ]`;
}

function replaceRouteTrackInFile(fileText, routeId, newTrack) {
  const pattern = new RegExp(
    `(id:\\s*'${routeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'[\\s\\S]*?track:\\s*)\\[[\\s\\S]*?\\](\\s*,\\s*\\n\\s*status\\s*:)`,
    'm'
  );
  if (!pattern.test(fileText)) return fileText;
  return fileText.replace(pattern, `$1${buildTrackLiteral(newTrack)}$2`);
}

function main() {
  let routesFile = fs.readFileSync(path.resolve(__dirname, '../data/routesData.js'), 'utf8');
  const updates = [];

  for (const file of EXPORT_FILES) {
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, 'utf8');
    const objects = extractAllJsonObjects(raw);
    const payloads = objects.filter((o) => Array.isArray(o?.result) && Array.isArray(o?.result?.[0]?.maneuvers));

    for (const payload of payloads) {
      const denseTrack = extractTrackFromPayload(payload);
      if (denseTrack.length < 8) continue;

      const route = findBestRouteMatch(payload);
      if (!route) continue;

      const oldCount = Array.isArray(route.track) ? route.track.length : 0;
      if (denseTrack.length <= oldCount) continue;

      routesFile = replaceRouteTrackInFile(routesFile, route.id, denseTrack);
      updates.push({
        id: route.id,
        name: route.name,
        oldCount,
        newCount: denseTrack.length
      });
    }
  }

  if (updates.length === 0) {
    console.log('No route tracks were updated.');
    return;
  }

  fs.writeFileSync(path.resolve(__dirname, '../data/routesData.js'), routesFile, 'utf8');
  console.log(`Updated ${updates.length} routes:`);
  for (const u of updates) {
    console.log(`- ${u.id} (${u.name}): ${u.oldCount} -> ${u.newCount} points`);
  }
}

main();
