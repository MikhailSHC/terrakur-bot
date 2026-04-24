#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function printUsage() {
  console.log(
    [
      'Usage:',
      '  node scripts/convert2gisRouteToTrack.js "<input-file>" [--output "<output-json>"]',
      '',
      'What it does:',
      '  - Reads raw 2GIS export text (with JSON blocks)',
      '  - Extracts route geometry from maneuvers[].outcoming_path.geometry[].selection (LINESTRING)',
      '  - Converts points to route.track format: [[lat, lon], ...]',
      '  - Prints a ready-to-paste snippet for data/routesData.js',
      '',
      'Examples:',
      '  node scripts/convert2gisRouteToTrack.js "C:/Users/me/Desktop/Маршрут.txt"',
      '  node scripts/convert2gisRouteToTrack.js "C:/Users/me/Desktop/Маршрут.txt" --output "./tmp/route-track.json"'
    ].join('\n')
  );
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    return { help: true };
  }

  const inputFile = args[0];
  let outputFile = null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) {
      outputFile = args[i + 1];
      i++;
    }
  }

  return { help: false, inputFile, outputFile };
}

function extractAllJsonObjects(text) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
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
          // Пропускаем невалидные JSON-фрагменты.
        }
        start = -1;
      }
    }
  }

  return objects;
}

function findBestRoutePayload(jsonObjects) {
  const withResult = jsonObjects.find(
    (obj) =>
      obj &&
      Array.isArray(obj.result) &&
      obj.result[0] &&
      Array.isArray(obj.result[0].maneuvers)
  );
  if (withResult) return withResult;

  return jsonObjects.find(
    (obj) => obj && obj.query && Array.isArray(obj.query.points)
  ) || null;
}

function parseLineString(selection) {
  if (typeof selection !== 'string') return [];
  const match = selection.match(/^LINESTRING\s*\((.+)\)\s*$/i);
  if (!match) return [];

  const pointsRaw = match[1].split(',');
  const points = [];

  for (const pointRaw of pointsRaw) {
    const pair = pointRaw.trim().split(/\s+/);
    if (pair.length < 2) continue;
    const lon = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    points.push([lat, lon]);
  }

  return points;
}

function dedupeSequential(points) {
  const out = [];
  for (const point of points) {
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== point[0] || prev[1] !== point[1]) {
      out.push(point);
    }
  }
  return out;
}

function extractTrackFromPayload(payload) {
  const maneuvers = payload?.result?.[0]?.maneuvers;
  if (!Array.isArray(maneuvers)) return [];

  const points = [];
  for (const m of maneuvers) {
    const geometries = m?.outcoming_path?.geometry;
    if (!Array.isArray(geometries)) continue;
    for (const g of geometries) {
      const chunk = parseLineString(g?.selection);
      if (chunk.length > 0) points.push(...chunk);
    }
  }

  return dedupeSequential(points);
}

function extractFallbackPoints(payload) {
  const queryPoints = payload?.query?.points;
  if (!Array.isArray(queryPoints)) return [];
  return queryPoints
    .map((p) => [Number(p?.lat), Number(p?.lon)])
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

function toSnippet(track) {
  const body = track.map((p) => `      [${p[0]}, ${p[1]}],`).join('\n');
  return `track: [\n${body}\n    ],`;
}

function main() {
  const { help, inputFile, outputFile } = parseArgs(process.argv);
  if (help) {
    printUsage();
    process.exit(0);
  }

  if (!inputFile) {
    console.error('❌ Input file is required.');
    printUsage();
    process.exit(1);
  }

  const resolvedInput = path.resolve(process.cwd(), inputFile);
  if (!fs.existsSync(resolvedInput)) {
    console.error(`❌ File not found: ${resolvedInput}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(resolvedInput, 'utf8');
  const jsonObjects = extractAllJsonObjects(raw);
  if (jsonObjects.length === 0) {
    console.error('❌ No JSON objects found in input file.');
    process.exit(1);
  }

  const payload = findBestRoutePayload(jsonObjects);
  if (!payload) {
    console.error('❌ Could not find 2GIS route payload with result/query data.');
    process.exit(1);
  }

  let track = extractTrackFromPayload(payload);
  let source = 'maneuvers.geometry.selection';
  if (track.length === 0) {
    track = extractFallbackPoints(payload);
    source = 'query.points (fallback)';
  }

  if (track.length === 0) {
    console.error('❌ Could not extract route points from payload.');
    process.exit(1);
  }

  const result = {
    pointsCount: track.length,
    source,
    track
  };

  console.log(`✅ Extracted ${track.length} points from ${source}`);
  console.log('');
  console.log('Paste this into routesData.js route object:');
  console.log(toSnippet(track));

  if (outputFile) {
    const resolvedOutput = path.resolve(process.cwd(), outputFile);
    fs.writeFileSync(resolvedOutput, JSON.stringify(result, null, 2), 'utf8');
    console.log('');
    console.log(`💾 Saved JSON output: ${resolvedOutput}`);
  }
}

main();
