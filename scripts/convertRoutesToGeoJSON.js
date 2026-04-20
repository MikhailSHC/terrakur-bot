// scripts/convertRoutesToGeoJSON.js

const fs = require('fs');

const path = require('path');

const routes = require('../data/routesData');

function buildFallbackTrack(route) {
  const centerLat = route?.center?.lat;
  const centerLon = route?.center?.lon;
  if (typeof centerLat !== 'number' || typeof centerLon !== 'number') {
    return [];
  }

  // Approximate loop around center so each route has a start/finish geometry in MVP.
  const radiusM = Math.max(80, Math.min(250, (Number(route.distanceKm) || 1) * 120));
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos((centerLat * Math.PI) / 180));

  return [
    [centerLon, centerLat + dLat],
    [centerLon + dLon, centerLat],
    [centerLon, centerLat - dLat],
    [centerLon - dLon, centerLat],
    [centerLon, centerLat + dLat]
  ];
}



const geojsonRoutes = routes.map(route => {

  // Преобразуем трек в GeoJSON LineString, если есть точки

  let geojson = null;

  if (route.track && route.track.length > 0) {

    geojson = {

      type: "Feature",

      geometry: {

        type: "LineString",

        coordinates: route.track.map(point => [point[1], point[0]]) // [lon, lat]

      },

      properties: {

        id: route.id,

        name: route.name,

        description: route.description,

        distanceKm: route.distanceKm,

        duration: route.duration,

        difficulty: route.difficulty,

        locationId: route.locationId,

        activities: route.activities

      }

    };

  } else {
    // Если трека нет, создаём fallback LineString вокруг центра.
    const fallbackTrack = buildFallbackTrack(route);

    geojson = {

      type: "Feature",

      geometry: {

        type: "LineString",

        coordinates: fallbackTrack

      },

      properties: {

        id: route.id,

        name: route.name,

        noTrack: true,
        distanceKm: route.distanceKm,
        duration: route.duration,
        difficulty: route.difficulty,
        locationId: route.locationId,
        activities: route.activities

      }

    };

  }

  return geojson;

});



// Сохраняем в файл public/mini-app/routes.geojson

const outputPath = path.join(__dirname, '../public/mini-app/routes.geojson');

fs.writeFileSync(outputPath, JSON.stringify({ type: "FeatureCollection", features: geojsonRoutes }, null, 2));

console.log(`✅ Конвертировано ${geojsonRoutes.length} маршрутов в ${outputPath}`);