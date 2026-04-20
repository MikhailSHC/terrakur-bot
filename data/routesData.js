// data/routesData.js



const routes = [

  // ===== STAVROPOL =====

  {

    id: 'tamanskiy-les',

    locationId: 'stavropol',



    name: 'Таманский лес',

    description: 'Красивая лесная тропа с разнообразной флорой и фауной',



    activities: ['walking', 'running', 'nordic_walking'],



    difficulty: 1,

    duration: '1-2 часа',



    distanceKm: 4,             // условный mid-point из "3-5 км"

    distanceText: '3-5 км',



    poi: [

      'Вход в лес',

      'Смотровая площадка',

      'Вид на озеро'

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



    name: 'Татарское городище',

    description: 'Исторический археологический памятник с панорамными видами',



    activities: ['walking', 'running', 'nordic_walking'],



    difficulty: 2,

    duration: '2-3 часа',



    distanceKm: 5,           // из "4-6 км"

    distanceText: '4-6 км',



    poi: [

      'Археологический памятник',

      'Смотровая площадка',

      'Исторические маркеры',

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



    name: 'Холодные родники',

    description: 'Зона холодных родников с бассейнами и водопадами',



    activities: ['walking', 'nordic_walking'],



    difficulty: 1,

    duration: '1-1.5 часа',



    distanceKm: 2.5,        // из "2-3 км"

    distanceText: '2-3 км',



    poi: [

      'Верхние бассейны',

      'Ротонда',

      'Водопад Хрустальные ручьи'

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



    name: 'Гора Стрижамент',

    description: 'Экологическая тропа на горе Стрижамент',



    activities: ['walking', 'running', 'nordic_walking'],



    difficulty: 3,

    duration: '3-4 часа',



    distanceKm: 10,          // из "8-12 км"

    distanceText: '8-12 км',



    poi: [

      'Горная вершина',

      'Смотровые площадки',

      'Остановки на экологической тропе'

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



    name: 'Сафонова дача',

    description: 'Государственный природный заповедник с охраняемыми тропами',



    activities: ['walking', 'nordic_walking'],



    difficulty: 2,

    duration: '2-3 часа',



    distanceKm: 6,           // из "5-7 км"

    distanceText: '5-7 км',



    poi: [

      'Вход в заповедник',

      'Охраняемые лесные зоны',

      'Точки наблюдения за дикой природой'

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



    name: 'Кисловодский парк Терренкур #3',

    description: 'Оздоровительная тропа в Кисловодском парке',



    activities: ['walking', 'nordic_walking'],



    difficulty: 1,

    duration: '1-2 часа',



    distanceKm: 3,           // из "2-4 км"

    distanceText: '2-4 км',



    poi: [

      'Вход в парк',

      'Маркеры оздоровительной тропы',

      'Смотровые площадки'

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



    name: 'Гора Олка',

    description: 'Панорамные виды с горной вершины',



    activities: ['walking', 'running'],



    difficulty: 2,

    duration: '2-3 часа',



    distanceKm: 6,           // из "5-7 км"

    distanceText: '5-7 км',



    poi: [

      'Подножие горы',

      'Смотровые площадки',

      'Вершина'

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



    name: 'Озеро Провал и гора Машук',

    description: 'Живописная озёрная местность с горными видами',



    activities: ['walking', 'running', 'nordic_walking'],



    difficulty: 2,

    duration: '2-3 часа',



    distanceKm: 5,           // из "4-6 км"

    distanceText: '4-6 км',



    poi: [

      'Берег озера',

      'Подход к горной тропе',

      'Смотровые площадки'

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



    name: 'Горский парк тропы',

    description: 'Городской парк с множеством пешеходных дорожек',



    activities: ['walking', 'running', 'cycling'],



    difficulty: 1,

    duration: '1-2 часа',



    distanceKm: 4,           // из "3-5 км"

    distanceText: '3-5 км',



    poi: [

      'Входы в парк',

      'Пешеходные петли',

      'Зоны отдыха'

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