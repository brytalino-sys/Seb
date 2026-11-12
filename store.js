/* ============================================================
   store.js — хранение. Пока localStorage, потом заменится на API.
   Весь остальной код обращается только к Store, не к localStorage.
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'sebes.v1';
  var state = null;

  function uid(prefix) {
    return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9);
  }

  var REASONS = [
    'Дорого, не устроила цена',
    'Занята дата, нет слота',
    'Технически не получилось сделать',
    'Клиент пропал, не ответил',
    'Ушёл к другому кондитеру',
    'Слишком срочно',
    'Не подошёл состав',
    'Доставка не устроила',
    'Событие отменилось',
    'Отказ с моей стороны, невыгодно',
    'Другое'
  ];

  /* Старые формулировки причин (до 0.5) приводим к нейтральным */
  var OLD_REASON = {
    'Технически не смогла сделать': 'Технически не получилось сделать',
    'Сама отказалась, невыгодно': 'Отказ с моей стороны, невыгодно'
  };

  /* pickup — самовывоз; delivery — везу сам, плата за доставку остаётся мне;
     courier — служба доставки, плата клиента уходит курьеру */
  var FULFILLMENT = ['pickup', 'delivery', 'courier'];

  var STAGES = [
    'До расчёта цены',
    'После озвучивания цены',
    'После внесения предоплаты',
    'Отмена уже в работе'
  ];

  var CHANNELS = ['Instagram', 'Telegram', 'WhatsApp', 'ВКонтакте', 'Сарафан', 'Авито', 'Другое'];

  var ORDER_STATUS = [
    { key: 'new',       label: 'Новый',      tone: 'blue'   },
    { key: 'confirmed', label: 'Подтверждён', tone: 'violet' },
    { key: 'work',      label: 'В работе',   tone: 'amber'  },
    { key: 'done',      label: 'Выдан',      tone: 'green'  }
  ];

  function today() { return Calc.localISO(); }
  function D(n) { return Calc.addDays(today(), n); }

  /* Демо-данные. Даты считаются от сегодняшнего дня, чтобы календарь
     и периоды аналитики всегда выглядели живыми. Выход рецептов —
     вес готового изделия, он меньше массы закладки. */
  function seed() {
    var ing = [
      { id: 'i_cream', name: 'Сливки 33%',    price: 850,  amount: 1, unit: 'л', cat: 'Молочные', updated: D(-6) },
      { id: 'i_masc',  name: 'Маскарпоне',     price: 1290, amount: 1, unit: 'кг', cat: 'Молочные', updated: D(-9) },
      { id: 'i_choco', name: 'Шоколад тёмный', price: 1420, amount: 1, unit: 'кг',   cat: 'Прочее',   updated: D(-12) },
      { id: 'i_flour', name: 'Мука пшеничная', price: 140,  amount: 2, unit: 'кг',   cat: 'Мука',     updated: D(-14) },
      { id: 'i_sugar', name: 'Сахар',          price: 85,   amount: 1, unit: 'кг',   cat: 'Прочее',   updated: D(-14) },
      { id: 'i_eggs',  name: 'Яйца',           price: 130,  amount: 10, unit: 'шт',  cat: 'Прочее',   updated: D(-4), pieceMass: 55 },
      { id: 'i_butter', name: 'Масло сливочное', price: 210, amount: 180, unit: 'г', cat: 'Молочные', updated: D(-5) },
      { id: 'i_berry', name: 'Клубника свежая', price: 450, amount: 500, unit: 'г',  cat: 'Ягоды',    updated: D(-3) },
      { id: 'i_box',   name: 'Коробка для торта', price: 1200, amount: 10, unit: 'шт', cat: 'Упаковка', updated: D(-20) }
    ];

    var defaultOverheads = function () {
      return [
        { name: 'Электричество', percent: 5 },
        { name: 'Аренда',        percent: 0 },
        { name: 'Упаковка',      percent: 3 },
        { name: 'Амортизация',   percent: 2 }
      ];
    };

    var recipes = [
      {
        id: 'r_velvet', name: 'Красный бархат', cat: 'Торты', rate: 500, margin: 55,
        yieldAmount: 1.1, yieldUnit: 'кг', splitRates: false, scaleLabor: true,
        items: [
          { ingredientId: 'i_cream', qty: 180, unit: 'мл' },
          { ingredientId: 'i_choco', qty: 120, unit: 'г' },
          { ingredientId: 'i_masc',  qty: 500, unit: 'г' },
          { ingredientId: 'i_flour', qty: 250, unit: 'г' },
          { ingredientId: 'i_berry', qty: 150, unit: 'г' },
          { ingredientId: 'i_box',   qty: 1,   unit: 'шт', fixed: true }
        ],
        labor: [
          { name: 'Приготовление', minutes: 90 },
          { name: 'Декорирование', minutes: 60 },
          { name: 'Упаковка',      minutes: 15, fixed: true }
        ],
        overheads: defaultOverheads()
      },
      {
        id: 'r_medovik', name: 'Медовик', cat: 'Торты', rate: 500, margin: 55,
        yieldAmount: 1.5, yieldUnit: 'кг', splitRates: false, scaleLabor: true,
        items: [
          { ingredientId: 'i_flour',  qty: 400, unit: 'г' },
          { ingredientId: 'i_sugar',  qty: 300, unit: 'г' },
          { ingredientId: 'i_eggs',   qty: 4,   unit: 'шт' },
          { ingredientId: 'i_butter', qty: 200, unit: 'г' },
          { ingredientId: 'i_cream',  qty: 500, unit: 'мл' }
        ],
        labor: [
          { name: 'Приготовление', minutes: 120 },
          { name: 'Сборка',        minutes: 45 },
          { name: 'Упаковка',      minutes: 15 }
        ],
        overheads: defaultOverheads()
      },
      {
        id: 'r_cheese', name: 'Чизкейк', cat: 'Торты', rate: 500, margin: 55,
        yieldAmount: 1.1, yieldUnit: 'кг', splitRates: false, scaleLabor: true,
        items: [
          { ingredientId: 'i_masc',   qty: 600, unit: 'г' },
          { ingredientId: 'i_sugar',  qty: 150, unit: 'г' },
          { ingredientId: 'i_eggs',   qty: 3,   unit: 'шт' },
          { ingredientId: 'i_butter', qty: 100, unit: 'г' },
          { ingredientId: 'i_berry',  qty: 200, unit: 'г' }
        ],
        labor: [
          { name: 'Приготовление', minutes: 75 },
          { name: 'Выпечка и охлаждение', minutes: 30 },
          { name: 'Упаковка',      minutes: 15 }
        ],
        overheads: defaultOverheads()
      }
    ];

    function order(o) {
      return Object.assign({ id: uid('o'), fulfillment: 'pickup', address: '',
        deliveryFee: 0, archived: false, legal: false, rating: 0, review: '', time: '12:00' }, o);
    }

    var orders = [
      order({ recipeId: 'r_velvet', title: 'Красный бархат', amount: 7000, qty: 1, date: D(0), time: '16:00',
        fulfillment: 'delivery', address: 'Москва, Ленинский пр-т, 45, кв. 112', deliveryFee: 500, status: 'work', client: 'Марина' }),
      order({ recipeId: 'r_cheese', title: 'Чизкейк', amount: 5200, qty: 1.1, date: D(2), status: 'new', client: 'Ольга' }),
      order({ recipeId: 'r_medovik', title: 'Медовик 3 кг', amount: 12000, qty: 3, date: D(5), time: '11:30',
        fulfillment: 'delivery', address: 'Москва, ул. Гарибальди, 8', deliveryFee: 600, status: 'confirmed', client: 'Дарья' }),
      order({ recipeId: 'r_medovik', title: 'Торт «Медовик»', amount: 6200, qty: 1.5, date: D(-3), time: '14:00',
        status: 'done', client: 'Анна', rating: 5, review: 'Все гости просили рецепт, спасибо!', reviewDate: D(-3) }),

      order({ recipeId: 'r_velvet', title: 'Красный бархат на юбилей', amount: 13500, qty: 2, date: D(-40), time: '15:00',
        fulfillment: 'courier', address: 'Москва, Профсоюзная, 104', deliveryFee: 500, status: 'done', client: 'Анна',
        archived: true, rating: 5, review: 'Второй раз заказываю, снова идеально', reviewDate: D(-39) }),
      order({ recipeId: 'r_cheese', title: 'Чизкейк с клубникой', amount: 4800, qty: 1.1, date: D(-33), time: '13:00',
        status: 'done', client: 'Пётр', archived: true, rating: 3, review: 'Вкусно, но ждал дольше обещанного', reviewDate: D(-32) }),
      order({ recipeId: 'r_medovik', title: 'Медовик классический', amount: 6000, qty: 1.5, date: D(-27), time: '17:00',
        status: 'done', client: 'Светлана', archived: true, rating: 4, reviewDate: D(-26) }),
      order({ recipeId: 'r_velvet', title: 'Красный бархат', amount: 5600, qty: 1, date: D(-48), time: '10:00',
        status: 'done', client: 'Ирина', archived: true }),
      order({ recipeId: '', title: 'Капкейки на заказ', amount: 2800, qty: null, date: D(-35),
        status: 'done', client: 'Марина', archived: true, rating: 4, review: 'Детям понравилось', reviewDate: D(-34) })
    ];

    var refusals = [
      { id: uid('f'), date: D(-6),  client: 'Елена',    title: 'Торт 3 кг',      amount: 9500,  channel: 'Instagram', stage: 'После озвучивания цены',   reason: 'Дорого, не устроила цена', comment: '' },
      { id: uid('f'), date: D(-9),  client: 'Ирина',    title: 'Чизкейк 2 кг',   amount: 8500,  channel: 'WhatsApp',  stage: 'После внесения предоплаты', reason: 'Событие отменилось', comment: '' },
      { id: uid('f'), date: D(-12), client: 'Светлана', title: 'Медовик',        amount: 6000,  channel: 'Telegram',  stage: 'До расчёта цены',          reason: 'Ушёл к другому кондитеру', comment: '' },
      { id: uid('f'), date: D(-16), client: 'Юлия',     title: 'Капкейки 24 шт', amount: 3600,  channel: 'Instagram', stage: 'После озвучивания цены',   reason: 'Дорого, не устроила цена', comment: '' },
      { id: uid('f'), date: D(-21), client: 'Ксения',   title: 'Свадебный ярус', amount: 18000, channel: 'Сарафан',   stage: 'До расчёта цены',          reason: 'Занята дата, нет слота', comment: '' },
      { id: uid('f'), date: D(-37), client: 'Алина',    title: 'Бенто-торт',     amount: 1800,  channel: 'Авито',     stage: 'До расчёта цены',          reason: 'Клиент пропал, не ответил', comment: '' }
    ];

    return {
      version: 1,
      settings: Object.assign(defaultSettings(), { demo: true }),
      ingredients: ing,
      recipes: recipes,
      orders: orders,
      refusals: refusals,
      purchases: [
        { id: uid('p'), date: D(0),   amount: 3400, note: 'Сливки, маскарпоне, клубника' },
        { id: uid('p'), date: D(-4),  amount: 2150, note: 'Мука, сахар, яйца' },
        { id: uid('p'), date: D(-11), amount: 5800, note: 'Шоколад, масло, коробки' },
        { id: uid('p'), date: D(-19), amount: 3900, note: 'Молочка на неделю' },
        { id: uid('p'), date: D(-36), amount: 6100, note: 'Закупка на юбилейный заказ' }
      ]
    };
  }

  function defaultSettings() {
    return { rate: 500, margin: 55, theme: 'auto', plan: 'free', taxOn: true, taxPerson: 4, taxLegal: 6, lastExport: '' };
  }

  /* ------------------------------------------------------------
     Очистка данных. Через неё проходит всё, что читается из
     хранилища и из импорта: id, даты и числа приводятся к
     безопасному виду, чтобы в разметку не попал чужой код,
     а приложение не падало на неполной или чужой копии.
     ------------------------------------------------------------ */
  var UNITS = ['г', 'кг', 'мл', 'л', 'шт'];
  var YIELD_UNITS = ['кг', 'г', 'шт', 'порций'];
  var ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var TIME_RE = /^\d{2}:\d{2}$/;

  function arr(v) { return Array.isArray(v) ? v.filter(function (x) { return x && typeof x === 'object'; }) : []; }
  function str(v, max) { return v == null ? '' : String(v).slice(0, max || 200); }
  function num(v, lo, hi, dflt) {
    var n = Number(v);
    if (!isFinite(n)) return dflt;
    if (lo != null && n < lo) n = lo;
    if (hi != null && n > hi) n = hi;
    return n;
  }
  function id(v, prefix) { return ID_RE.test(String(v || '')) ? String(v) : uid(prefix); }
  function refId(v) { return ID_RE.test(String(v || '')) ? String(v) : ''; }
  function date(v) { return DATE_RE.test(String(v || '')) ? String(v) : ''; }
  function oneOf(v, list, dflt) { return list.indexOf(v) >= 0 ? v : dflt; }

  function sanitize(data) {
    var d = data && typeof data === 'object' ? data : {};
    var set = Object.assign(defaultSettings(), d.settings && typeof d.settings === 'object' ? d.settings : {});
    var settings = {
      rate: num(set.rate, 0, 100000, 500),
      margin: num(set.margin, 0, 95, 55),
      theme: oneOf(set.theme, ['auto', 'light', 'dark'], 'auto'),
      plan: str(set.plan, 20) || 'free',
      taxOn: set.taxOn !== false,
      taxPerson: num(set.taxPerson, 0, 50, 4),
      taxLegal: num(set.taxLegal, 0, 50, 6),
      demo: !!set.demo,
      lastExport: date(set.lastExport)
    };

    var ingredients = arr(d.ingredients).filter(function (i) { return UNITS.indexOf(i.unit) >= 0; }).map(function (i) {
      var out = {
        id: id(i.id, 'i'), name: str(i.name, 120) || 'Без названия',
        price: num(i.price, 0, 1e9, 0), amount: num(i.amount, 0, 1e9, 1) || 1,
        unit: i.unit, cat: str(i.cat, 60) || 'Прочее', updated: date(i.updated)
      };
      var pm = num(i.pieceMass, 0, 100000, 0);
      if (pm) out.pieceMass = pm;
      return out;
    });

    var recipes = arr(d.recipes).map(function (r) {
      return {
        id: id(r.id, 'r'), name: str(r.name, 120) || 'Без названия', cat: str(r.cat, 60) || 'Прочее',
        yieldAmount: num(r.yieldAmount, 0, 1e6, 1) || 1,
        yieldUnit: oneOf(r.yieldUnit, YIELD_UNITS, 'шт'),
        rate: num(r.rate, 0, 100000, settings.rate),
        margin: num(r.margin, 0, 95, settings.margin),
        splitRates: !!r.splitRates, scaleLabor: r.scaleLabor !== false,
        items: arr(r.items).filter(function (it) { return UNITS.indexOf(it.unit) >= 0; }).map(function (it) {
          return { ingredientId: refId(it.ingredientId), qty: num(it.qty, 0, 1e7, 0), unit: it.unit, fixed: !!it.fixed };
        }),
        labor: arr(r.labor).map(function (l) {
          var rate = l.rate == null || l.rate === '' ? null : num(l.rate, 0, 100000, null);
          return { name: str(l.name, 80) || 'Работа', minutes: num(l.minutes, 0, 100000, 0), rate: rate, fixed: !!l.fixed };
        }),
        overheads: arr(r.overheads).map(function (o) {
          return { name: str(o.name, 80) || 'Прочее', percent: num(o.percent, 0, 100, 0) };
        })
      };
    });

    var statuses = ORDER_STATUS.map(function (x) { return x.key; });
    var orders = arr(d.orders).map(function (o) {
      var out = {
        id: id(o.id, 'o'), recipeId: refId(o.recipeId), title: str(o.title, 160) || 'Заказ',
        amount: num(o.amount, 0, 1e9, 0), qty: num(o.qty, 0, 1e6, 0) || null,
        date: date(o.date),
        time: TIME_RE.test(String(o.time || '')) ? String(o.time) : '',
        fulfillment: FULFILLMENT.indexOf(o.fulfillment) >= 0 ? o.fulfillment : 'pickup',
        address: str(o.address, 300), deliveryFee: num(o.deliveryFee, 0, 1e7, 0),
        status: oneOf(o.status, statuses, 'new'), client: str(o.client, 120),
        archived: !!o.archived, legal: !!o.legal,
        rating: Math.round(num(o.rating, 0, 5, 0)), review: str(o.review, 2000), reviewDate: date(o.reviewDate)
      };
      if (o.snapshot && typeof o.snapshot === 'object') {
        out.snapshot = {
          ingredients: num(o.snapshot.ingredients, 0, 1e9, 0), labor: num(o.snapshot.labor, 0, 1e9, 0),
          overhead: num(o.snapshot.overhead, 0, 1e9, 0), minutes: num(o.snapshot.minutes, 0, 1e7, 0),
          taxRate: num(o.snapshot.taxRate, 0, 50, 0), at: date(o.snapshot.at)
        };
      }
      return out;
    });

    var refusals = arr(d.refusals).map(function (f) {
      return {
        id: id(f.id, 'f'), date: date(f.date), client: str(f.client, 120), title: str(f.title, 160),
        amount: num(f.amount, 0, 1e9, 0), channel: str(f.channel, 60), stage: str(f.stage, 80),
        reason: OLD_REASON[f.reason] || str(f.reason, 80), comment: str(f.comment, 1000)
      };
    });

    var purchases = arr(d.purchases).map(function (p) {
      return { id: id(p.id, 'p'), date: date(p.date) || today(), amount: num(p.amount, 0, 1e9, 0), note: str(p.note, 200) };
    }).filter(function (p) { return p.amount > 0; });

    return { version: 1, settings: settings, ingredients: ingredients, recipes: recipes, orders: orders,
             refusals: refusals, purchases: purchases };
  }

  /* ------------------------------------------------------------
     Загрузка и сохранение
     ------------------------------------------------------------ */
  var notice = null;          // сообщение для пользователя после загрузки
  var saveError = false;
  var onSaveError = null;

  function backupRaw(raw) {
    try { localStorage.setItem('sebes.backup.' + Date.now(), raw); return true; } catch (e) { return false; }
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { return seed(); }
    if (!raw) return seed();
    try {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1) return sanitize(parsed);
    } catch (e) { /* ниже */ }
    /* Данные есть, но прочитать их нельзя: не затираем, откладываем копию */
    var kept = backupRaw(raw);
    notice = kept
      ? 'Сохранённые данные не удалось прочитать. Их копия отложена в браузере, показаны примеры.'
      : 'Сохранённые данные не удалось прочитать, показаны примеры.';
    return seed();
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      saveError = false;
      return true;
    } catch (e) {
      saveError = true;
      if (onSaveError) onSaveError();
      return false;
    }
  }

  /* Автокопии: раз в день при запуске кладём копию данных рядом,
     храним последние 5. Спасают от неудачного импорта и случайных правок.
     От смены телефона не спасают — для этого есть файл копии. */
  var AUTO = 'sebes.auto.';
  function autoKeys() {
    var keys = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(AUTO) === 0) keys.push(k);
      }
    } catch (e) {}
    return keys.sort();
  }
  function hasOwnData(st) {
    return !st.settings.demo && (st.recipes.length || st.orders.length || st.refusals.length || (st.purchases || []).length);
  }
  function autoSnapshot() {
    if (!hasOwnData(state)) return;
    var k = AUTO + today();
    try {
      if (localStorage.getItem(k)) return;
      localStorage.setItem(k, JSON.stringify(state));
    } catch (e) { return; }
    var keys = autoKeys();
    while (keys.length > 5) { try { localStorage.removeItem(keys.shift()); } catch (e) { break; } }
  }
  function autoSnapshots() {
    return autoKeys().reverse().map(function (k) {
      var info = { date: k.slice(AUTO.length), recipes: 0, orders: 0 };
      try {
        var d = JSON.parse(localStorage.getItem(k));
        info.recipes = (d.recipes || []).length; info.orders = (d.orders || []).length;
      } catch (e) { info.broken = true; }
      return info;
    });
  }
  function restoreSnapshot(day) {
    var raw = null;
    try { raw = localStorage.getItem(AUTO + day); } catch (e) {}
    if (!raw) return { ok: false, error: 'Автокопия не найдена.' };
    return importJSON(raw);
  }

  /* Просим браузер не стирать данные при нехватке места */
  function requestPersist() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        return navigator.storage.persisted().then(function (yes) { return yes || navigator.storage.persist(); })
          .catch(function () { return false; });
      }
    } catch (e) {}
    return Promise.resolve(false);
  }

  function taxRateFor(o) {
    var st = init().settings;
    if (!st.taxOn) return 0;
    return o && o.legal ? st.taxLegal : st.taxPerson;
  }

  /* Снимок себестоимости на момент выдачи: прошлые месяцы
     не пересчитываются, когда меняются цены или рецепты. */
  function snapshotFor(o) {
    var r = o.recipeId ? getRecipe(o.recipeId) : null;
    if (!r) return null;
    var scale = o.qty ? Calc.scaleFactor(o.qty, r.yieldAmount) : 1;
    var c = computeRecipe(r, { scale: scale, taxRate: 0 });
    return {
      ingredients: c.ingredients, labor: c.labor, overhead: c.overhead,
      minutes: c.laborMinutes, taxRate: taxRateFor(o), at: today()
    };
  }

  function init() {
    if (!state) {
      state = load();
      autoSnapshot();
      /* Выданные заказы прошлых версий фиксируем по текущим ценам один раз */
      state.orders.forEach(function (o) {
        if (o.status === 'done' && !o.snapshot) {
          var snap = snapshotFor(o);
          if (snap) o.snapshot = snap;
        }
      });
    }
    return state;
  }

  /* ------------------------------------------------------------ */

  function normalizeRecipe(r) {
    if (r.yieldAmount == null) r.yieldAmount = 1;
    if (!r.yieldUnit) r.yieldUnit = 'шт';
    if (r.splitRates == null) r.splitRates = false;
    if (r.scaleLabor == null) r.scaleLabor = true;
    if (!r.items) r.items = [];
    if (!r.labor) r.labor = [];
    if (!r.overheads) r.overheads = [];
    r.items.forEach(function (i) { delete i.decor; if (i.fixed == null) i.fixed = false; });
    r.labor.forEach(function (l) { delete l.decor; if (l.fixed == null) l.fixed = false; });
    return r;
  }

  function normalizeOrder(o) {
    delete o.withDecor;
    if (o.archived == null) o.archived = false;
    if (o.fulfillment == null) o.fulfillment = 'pickup';
    if (o.address == null) o.address = '';
    if (o.time == null) o.time = '';
    if (o.deliveryFee == null) o.deliveryFee = 0;
    if (o.rating == null) o.rating = 0;
    if (o.review == null) o.review = '';
    if (o.legal == null) o.legal = false;
    return o;
  }

  function ingredientsById() {
    var map = {};
    init().ingredients.forEach(function (i) { map[i.id] = i; });
    return map;
  }

  /* opts: { scale, margin, taxRate } — для пересчёта под конкретный заказ */
  function computeRecipe(recipe, opts) {
    var o = opts || {};
    var st = init().settings;
    normalizeRecipe(recipe);
    return Calc.recipe({
      ingredientsById: ingredientsById(),
      items: recipe.items,
      labor: recipe.labor,
      overheads: recipe.overheads,
      rate: recipe.rate != null ? recipe.rate : st.rate,
      splitRates: !!recipe.splitRates,
      scaleLabor: recipe.scaleLabor !== false,
      scale: o.scale,
      margin: o.margin != null ? o.margin : (recipe.margin != null ? recipe.margin : st.margin),
      taxRate: o.taxRate != null ? o.taxRate : (st.taxOn ? st.taxPerson : 0)
    });
  }

  function recipeMass(recipe) {
    normalizeRecipe(recipe);
    return Calc.recipeMass(recipe.items, ingredientsById());
  }

  function getRecipe(rid) {
    var r = init().recipes.filter(function (x) { return x.id === rid; })[0];
    return r ? normalizeRecipe(r) : null;
  }

  function upsertRecipe(recipe) {
    var s = init();
    if (!recipe.id) { recipe.id = uid('r'); s.recipes.unshift(recipe); }
    else {
      var i = s.recipes.findIndex(function (r) { return r.id === recipe.id; });
      if (i >= 0) s.recipes[i] = recipe; else s.recipes.unshift(recipe);
    }
    save();
    return recipe;
  }

  function ordersUsingRecipe(rid) {
    return init().orders.filter(function (o) { return o.recipeId === rid; });
  }

  function removeRecipe(rid) {
    var s = init();
    s.recipes = s.recipes.filter(function (r) { return r.id !== rid; });
    save();
  }

  function upsertIngredient(ing) {
    var s = init();
    if (!ing.id) { ing.id = uid('i'); s.ingredients.unshift(ing); }
    else {
      var i = s.ingredients.findIndex(function (x) { return x.id === ing.id; });
      if (i >= 0) s.ingredients[i] = ing; else s.ingredients.unshift(ing);
    }
    save();
    return ing;
  }

  function removeIngredient(iid) {
    var s = init();
    s.ingredients = s.ingredients.filter(function (x) { return x.id !== iid; });
    save();
  }

  function usedIn(ingredientId) {
    return init().recipes.filter(function (r) {
      return (r.items || []).some(function (it) { return it.ingredientId === ingredientId; });
    });
  }

  function recipesById() {
    var map = {};
    init().recipes.forEach(function (r) { map[r.id] = r; });
    return map;
  }

  function orders() {
    return init().orders.map(normalizeOrder).filter(function (o) { return !o.archived; });
  }
  function archived() {
    return init().orders.map(normalizeOrder).filter(function (o) { return o.archived; });
  }

  /* Разложение заказа на деньги. Выданный заказ считается по снимку,
     остальные — по текущему рецепту. Доставка в выручке, но не в себестоимости. */
  function orderEconomics(o) {
    normalizeOrder(o);
    var revenue = Number(o.amount) || 0;
    var snap = o.status === 'done' && o.snapshot ? o.snapshot : snapshotFor(o);
    var courier = o.fulfillment === 'courier' ? Number(o.deliveryFee) || 0 : 0;
    if (!snap) return Calc.orderEconomics(revenue, { taxRate: taxRateFor(o), courier: courier, known: false });
    var e = Calc.orderEconomics(revenue, {
      ingredients: snap.ingredients, labor: snap.labor, overhead: snap.overhead,
      taxRate: snap.taxRate, courier: courier, known: true
    });
    e.minutes = snap.minutes || 0;
    return e;
  }

  /* Строки для сводки по месяцам: только выданные заказы, включая архив */
  function moneyRows() {
    return init().orders.map(normalizeOrder)
      .filter(function (o) { return o.status === 'done'; })
      .map(function (o) {
        var e = orderEconomics(o);
        return { date: o.date, revenue: e.revenue, ingredients: e.ingredients, labor: e.labor,
                 overhead: e.overhead, tax: e.tax, courier: e.courier, minutes: e.minutes || 0, known: e.known };
      });
  }

  function upsertOrder(o) {
    var s = init();
    var prev = o.id ? s.orders.filter(function (x) { return x.id === o.id; })[0] : null;
    if (o.status === 'done') {
      /* Себестоимость выданного заказа заморожена. Пересчитываем её по текущим
         ценам, только если поменялись рецепт или объём. Смена плательщика
         (человек или компания) меняет лишь ставку налога. */
      var frozen = prev && prev.status === 'done' && prev.snapshot ? prev.snapshot : null;
      var sameBasis = frozen && prev.recipeId === o.recipeId &&
        (Number(prev.qty) || 0) === (Number(o.qty) || 0);
      if (sameBasis) {
        o.snapshot = !!prev.legal === !!o.legal ? frozen
          : Object.assign({}, frozen, { taxRate: taxRateFor(o) });
      } else {
        var snap = snapshotFor(o);
        if (snap) o.snapshot = snap; else delete o.snapshot;
      }
    } else {
      delete o.snapshot;
    }
    if (!o.id) { o.id = uid('o'); s.orders.unshift(o); }
    else {
      var i = s.orders.findIndex(function (x) { return x.id === o.id; });
      if (i >= 0) s.orders[i] = o; else s.orders.unshift(o);
    }
    save();
    return o;
  }

  function removeOrder(oid) {
    var s = init();
    s.orders = s.orders.filter(function (x) { return x.id !== oid; });
    save();
  }

  function upsertRefusal(f) {
    var s = init();
    if (!f.id) { f.id = uid('f'); s.refusals.unshift(f); }
    else {
      var i = s.refusals.findIndex(function (x) { return x.id === f.id; });
      if (i >= 0) s.refusals[i] = f; else s.refusals.unshift(f);
    }
    save();
    return f;
  }

  function removeRefusal(fid) {
    var s = init();
    s.refusals = s.refusals.filter(function (x) { return x.id !== fid; });
    save();
  }

  function purchases() {
    var s = init();
    if (!s.purchases) s.purchases = [];
    return s.purchases;
  }
  function upsertPurchase(p) {
    var list = purchases();
    if (!p.id) { p.id = uid('p'); list.unshift(p); }
    else {
      var i = list.findIndex(function (x) { return x.id === p.id; });
      if (i >= 0) list[i] = p; else list.unshift(p);
    }
    save();
    return p;
  }
  function removePurchase(pid) {
    var s = init();
    s.purchases = purchases().filter(function (x) { return x.id !== pid; });
    save();
  }

  function setSetting(key, value) {
    init().settings[key] = value;
    save();
  }

  function reset() {
    state = seed();
    init();
    save();
  }

  function clearAll() {
    var theme = init().settings.theme;
    state = { version: 1, settings: defaultSettings(), ingredients: [], recipes: [], orders: [], refusals: [], purchases: [] };
    state.settings.theme = theme;
    save();
  }

  function exportJSON() { return JSON.stringify(init(), null, 2); }

  /* Восстановление из копии: проверка, очистка и резервная копия текущих данных */
  function importJSON(text) {
    var parsed;
    try { parsed = JSON.parse(text); } catch (e) { return { ok: false, error: 'Это не похоже на копию данных: текст повреждён.' }; }
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) {
      return { ok: false, error: 'Это не копия Себеса или копия от другой версии.' };
    }
    var clean = sanitize(parsed);
    if (!clean.recipes.length && !clean.ingredients.length && !clean.orders.length && !clean.refusals.length && !clean.purchases.length) {
      return { ok: false, error: 'В копии нет ни одной записи.' };
    }
    try { backupRaw(JSON.stringify(init())); } catch (e) {}
    state = clean;
    state.orders.forEach(function (o) {
      if (o.status === 'done' && !o.snapshot) { var sn = snapshotFor(o); if (sn) o.snapshot = sn; }
    });
    if (!save()) return { ok: false, error: 'Не хватает места в браузере, данные не записались.' };
    return { ok: true, counts: { recipes: clean.recipes.length, orders: clean.orders.length } };
  }

  global.Store = {
    REASONS: REASONS, STAGES: STAGES, CHANNELS: CHANNELS, ORDER_STATUS: ORDER_STATUS,
    UNITS: UNITS, YIELD_UNITS: YIELD_UNITS, normalizeRecipe: normalizeRecipe, normalizeOrder: normalizeOrder,
    orders: orders, archived: archived, recipesById: recipesById,
    orderEconomics: orderEconomics, moneyRows: moneyRows, taxRateFor: taxRateFor,
    recipeMass: recipeMass, ordersUsingRecipe: ordersUsingRecipe,
    importJSON: importJSON, sanitize: sanitize, today: today,
    get notice() { return notice; }, clearNotice: function () { notice = null; },
    get saveError() { return saveError; },
    set onSaveError(fn) { onSaveError = fn; },
    uid: uid,
    get state() { return init(); },
    ingredientsById: ingredientsById,
    computeRecipe: computeRecipe,
    getRecipe: getRecipe,
    upsertRecipe: upsertRecipe, removeRecipe: removeRecipe,
    upsertIngredient: upsertIngredient, removeIngredient: removeIngredient, usedIn: usedIn,
    upsertOrder: upsertOrder, removeOrder: removeOrder,
    upsertRefusal: upsertRefusal, removeRefusal: removeRefusal,
    purchases: purchases, upsertPurchase: upsertPurchase, removePurchase: removePurchase,
    autoSnapshots: autoSnapshots, restoreSnapshot: restoreSnapshot, requestPersist: requestPersist,
    setSetting: setSetting,
    save: save, reset: reset, clearAll: clearAll, exportJSON: exportJSON
  };
})(window);
