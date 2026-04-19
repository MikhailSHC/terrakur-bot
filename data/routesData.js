// data/routesData.js

const routes = [
  // ===== STAVROPOL =====
  {
    id: 'tamanskiy-les',
    locationId: 'stavropol',

    name: 'Tamanskiy Les',
    description: 'Beautiful forest trail with diverse flora and fauna',

    activities: ['walking', 'running', 'nordic_walking'],

    difficulty: 1,
    duration: '1-2 hours',

    distanceKm: 4,             // условный mid-point из "3-5 km"
    distanceText: '3-5 km',

    poi: [
      'Forest entrance',
      'Observation deck',
      'Lake viewpoint'
    ],

    targetAudience: ['beginners', 'families', 'elderly'],

    center: {
      lat: 39.050000,
      lon: 41.980000
    },

    // TODO: заполнить реальными точками трека, когда будут
    track: [],

    status: 'active'
  },
  {
    id: 'tatarskoe-gorodische',
    locationId: 'stavropol',

    name: 'Tatarskoe Gorodische',
    description: 'Historical archaeological site with panoramic views',

    activities: ['walking', 'running', 'nordic_walking'],

    difficulty: 2,
    duration: '2-3 hours',

    distanceKm: 5,           // из "4-6 km"
    distanceText: '4-6 km',

    poi: [
      'Archaeological site',
      'Viewing platform',
      'Historical markers'
    ],

    targetAudience: ['intermediate', 'history_lovers'],

    center: {
      lat: 40.050000,
      lon: 41.980000
    },

    track: [],

    status: 'active'
  },
  {
    id: 'kholodnye-rodniki',
    locationId: 'stavropol',

    name: 'Kholodnye Rodniki',
    description: 'Cold springs area with pools and waterfalls',

    activities: ['walking', 'nordic_walking'],

    difficulty: 1,
    duration: '1-1.5 hours',

    distanceKm: 2.5,        // из "2-3 km"
    distanceText: '2-3 km',

    poi: [
      'Upper pools',
      'Rotonda',
      'Crystal streams waterfall'
    ],

    targetAudience: ['beginners', 'families', 'elderly'],

    center: {
      lat: 41.050000,
      lon: 41.980000
    },

    track: [],

    status: 'active'
  },

  // ===== KAVMINVODY =====
  {
    id: 'gora-strizhament',
    locationId: 'kavminvody',

    name: 'Gora Strizhament',
    description: 'Ecological trail on Strizhament mountain',

    activities: ['walking', 'running', 'nordic_walking'],

    difficulty: 3,
    duration: '3-4 hours',

    distanceKm: 10,          // из "8-12 km"
    distanceText: '8-12 km',

    poi: [
      'Mountain peak',
      'View points',
      'Ecological trail stops'
    ],

    targetAudience: ['advanced', 'experienced_hikers'],

    center: {
      lat: 42.050000,
      lon: 41.980000
    },

    track: [
  [44.1111, 43.1234],
  [44.1122, 43.1244]
],

    status: 'active'
  },
  {
    id: 'safonova-dacha',
    locationId: 'kavminvody',

    name: 'Safonova dacha',
    description: 'State nature reserve with protected trails',

    activities: ['walking', 'nordic_walking'],

    difficulty: 2,
    duration: '2-3 hours',

    distanceKm: 6,           // из "5-7 km"
    distanceText: '5-7 km',

    poi: [
      'Reserve entrance',
      'Protected forest areas',
      'Wildlife viewing points'
    ],

    targetAudience: ['intermediate', 'nature_lovers'],

    center: {
      lat: 43.050000,
      lon: 41.980000
    },

    track: [],

    status: 'active'
  },

  // ===== KISLOVODSK =====
  {
    id: 'kislovodsk-park-3',
    locationId: 'kislovodsk',

    name: 'Kislovodsk park terrenkur #3',
    description: 'Health trail in Kislovodsk park',

    activities: ['walking', 'nordic_walking'],

    difficulty: 1,
    duration: '1-2 hours',

    distanceKm: 3,           // из "2-4 km"
    distanceText: '2-4 km',

    poi: [
      'Park entrance',
      'Health trail markers',
      'Scenic viewpoints'
    ],

    targetAudience: ['beginners', 'health_focused', 'elderly'],

    center: {
      lat: 44.050000,
      lon: 41.980000
    },

    // Здесь уже есть тестовые точки в mini-app, можно позже перенести:
    // track: [
    //   [43.9071, 42.7165],
    //   [43.9080, 42.7180],
    //   [43.9092, 42.7203]
    // ],
    track: [
      [43.9071, 42.7165],
      [43.9080, 42.7180],
      [43.9092, 42.7203]
    ],

    status: 'active'
  },
  {
    id: 'olka-mountain',
    locationId: 'kislovodsk',

    name: 'Olka Mountain',
    description: 'Panoramic views from mountain peak',

    activities: ['walking', 'running'],

    difficulty: 2,
    duration: '2-3 hours',

    distanceKm: 6,           // из "5-7 km"
    distanceText: '5-7 km',

    poi: [
      'Mountain base',
      'Viewing platforms',
      'Summit area'
    ],

    targetAudience: ['intermediate', 'photography_lovers'],

    center: {
      lat: 46.050000,
      lon: 41.980000
    },

    track: [],

    status: 'active'
  },

  // ===== PYATIGORSK =====
  {
    id: 'proval-lake',
    locationId: 'pyatigorsk',

    name: 'Proval Lake and Mashuk Mountain',
    description: 'Scenic lake area with mountain views',

    activities: ['walking', 'running', 'nordic_walking'],

    difficulty: 2,
    duration: '2-3 hours',

    distanceKm: 5,           // из "4-6 km"
    distanceText: '4-6 km',

    poi: [
      'Lake shore',
      'Mountain trail access',
      'Viewing platforms'
    ],

    targetAudience: ['intermediate', 'nature_lovers'],

    center: {
      lat: 47.050000,
      lon: 41.980000
    },

    track: [],

    status: 'active'
  },
  {
    id: 'gorsky-park',
    locationId: 'pyatigorsk',

    name: 'Gorsky Park trails',
    description: 'Urban park with multiple walking paths',

    activities: ['walking', 'running', 'cycling'],

    difficulty: 1,
    duration: '1-2 hours',

    distanceKm: 4,           // из "3-5 km"
    distanceText: '3-5 km',

    poi: [
      'Park entrances',
      'Walking loops',
      'Recreation areas'
    ],

    targetAudience: ['beginners', 'families', 'urban_walkers'],

    center: {
      lat: 48.050000,
      lon: 41.980000
    },

    track: [],

    status: 'active'
  }
];

module.exports = routes;