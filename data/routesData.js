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



    name: 'Холодные родники и Комсомольский пруд',

    description: 'Маршрут через Холодные родники и Комсомольский пруд',



    activities: ['running', 'cycling'],



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

      lat: 45.0495,

      lon: 41.9422

    },



    track: [
      [45.039884, 41.93537],
      [45.03994, 41.935234],
      [45.040164, 41.93506],
      [45.040475, 41.934597],
      [45.04293, 41.934554],
      [45.043049, 41.934782],
      [45.043284, 41.9349141],
      [45.043544, 41.934824],
      [45.045694, 41.934819],
      [45.046046, 41.932381],
      [45.046306, 41.93183],
      [45.046374, 41.931392],
      [45.046441, 41.925496],
      [45.051302, 41.925536],
      [45.051288, 41.929605],
      [45.051245, 41.930493],
      [45.051243, 41.932808],
      [45.051234, 41.933874],
      [45.05104, 41.934814],
      [45.05104, 41.934814],
      [45.050677, 41.93589],
      [45.050592, 41.936258],
      [45.050578, 41.936695],
      [45.050543, 41.936998],
      [45.050482, 41.937194],
      [45.050287, 41.937521],
      [45.049893, 41.93803],
      [45.049812, 41.938259],
      [45.049689, 41.938954],
      [45.049541, 41.940399],
      [45.049533, 41.941396],
      [45.049843, 41.943544],
      [45.049841, 41.943759],
      [45.049801, 41.94395],
      [45.049618, 41.944405],
      [45.049572, 41.944688],
      [45.04955, 41.944966],
      [45.049642, 41.946492],
      [45.049525, 41.947168],
      [45.049527, 41.947427],
      [45.04964, 41.948033],
      [45.049641, 41.948194],
      [45.049598, 41.948415],
      [45.049606, 41.948601],
      [45.049699, 41.949117],
      [45.049671, 41.949804],
      [45.049727, 41.950274],
      [45.049847, 41.950475],
      [45.050229, 41.951806],
      [45.05041, 41.953201],
      [45.050506, 41.953699],
      [45.050796, 41.954521],
      [45.050796, 41.954521],
      [45.051286, 41.957107]
    ],



    status: 'active'

  },

  {

    id: 'park-pobedy-botanicheskiy-sad',

    locationId: 'stavropol',



    name: 'Парк Победы → Ботанический сад',

    description: 'Веломаршрут из Парка Победы до Ботанического сада',



    activities: ['cycling'],



    difficulty: 2,

    duration: '1-1.5 часа',



    distanceKm: 7.8,

    distanceText: '7-9 км',



    poi: [

      'Парк Победы',

      'Городские велодорожки',

      'Ботанический сад'

    ],



    targetAudience: ['intermediate', 'cycling_lovers'],



    center: {

      lat: 45.0299,

      lon: 41.9134

    },



    track: [
      [45.036521, 41.921742],
      [45.035463, 41.921216],
      [45.035169, 41.921306],
      [45.033482, 41.92046],
      [45.032633, 41.920451],
      [45.03234, 41.920447],
      [45.030954, 41.920414],
      [45.030989, 41.917904],
      [45.028204, 41.917859],
      [45.028221, 41.917264],
      [45.028337, 41.916867],
      [45.027735, 41.915293],
      [45.02645, 41.913398],
      [45.02645, 41.913398],
      [45.024058, 41.914283],
      [45.024031, 41.914152],
      [45.023989, 41.914085],
      [45.0234, 41.913288],
      [45.022941, 41.913626],
      [45.022916, 41.913554],
      [45.023093, 41.913235],
      [45.023449, 41.913076],
      [45.023558, 41.912883],
      [45.023862, 41.912012],
      [45.023917, 41.911932],
      [45.025833, 41.911246],
      [45.026998, 41.910413],
      [45.028293, 41.909874],
      [45.028504, 41.909646],
      [45.028626, 41.909187],
      [45.028768, 41.907705],
      [45.02874, 41.906265],
      [45.028424, 41.905018],
      [45.028108, 41.904549],
      [45.027883, 41.904699]
    ],



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