// scripts/convertRoutesToGeoJSON.js
const fs = require('fs');
const path = require('path');

// Путь к исходному routesData.js
const routesPath = path.join(__dirname, '../data/routesData.js');
// Читаем файл как текст, чтобы извлечь массив
const routesContent = fs.readFileSync(routesPath, 'utf8');
// Extract routes array from the file
const match = routesContent.match(/const routes = (\[[\s\S]*\]);/);
if (!match) {
  throw new Error('Could not extract routes array from routesData.js');
}
const routes = eval(match[1]);

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
    // Если трека нет, создаём пустой Feature (только центр)
    geojson = {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [route.center.lon, route.center.lat]
      },
      properties: {
        id: route.id,
        name: route.name,
        noTrack: true
      }
    };
  }
  return geojson;
});

// Сохраняем в файл public/mini-app/routes.geojson
const outputPath = path.join(__dirname, '../public/mini-app/routes.geojson');
fs.writeFileSync(outputPath, JSON.stringify({ type: "FeatureCollection", features: geojsonRoutes }, null, 2));
console.log(`✅ Конвертировано ${geojsonRoutes.length} маршрутов в ${outputPath}`);