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
    'Технически не смогла сделать',
    'Клиент пропал, не ответил',
    'Ушёл к другому кондитеру',
    'Слишком срочно',
    'Не подошёл состав',
    'Доставка не устроила',
    'Событие отменилось',
    'Сама отказалась, невыгодно',
    'Другое'
  ];

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

  function seed() {
    var ing = [
      { id: 'i_cream', name: 'Сливки 33%',    price: 850,  amount: 1, unit: 'л',  cat: 'Молочные', updated: '2026-08-28' },
      { id: 'i_masc',  name: 'Маскарпоне',     price: 1290, amount: 1, unit: 'кг', cat: 'Молочные', updated: '2026-08-25' },
      { id: 'i_choco', name: 'Шоколад тёмный', price: 1420, amount: 1, unit: 'кг', cat: 'Прочее',   updated: '2026-08-22' },
      { id: 'i_flour', name: 'Мука пшеничная', price: 70,   amount: 1, unit: 'кг', cat: 'Мука',     updated: '2026-08-20' },
      { id: 'i_sugar', name: 'Сахар',          price: 60,   amount: 1, unit: 'кг', cat: 'Прочее',   updated: '2026-08-18' },
      { id: 'i_eggs',  name: 'Яйца',           price: 120,  amount: 10, unit: 'шт', cat: 'Прочее',  updated: '2026-08-15' },
      { id: 'i_butter', name: 'Масло сливочное', price: 980, amount: 1, unit: 'кг', cat: 'Молочные', updated: '2026-08-19' },
      { id: 'i_berry', name: 'Клубника свежая', price: 650, amount: 1, unit: 'кг', cat: 'Ягоды',    updated: '2026-08-26' }
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
        yieldAmount: 1.5, yieldUnit: 'кг', splitRates: false, scaleLabor: true,
        items: [
          { ingredientId: 'i_cream', qty: 180, unit: 'мл' },
          { ingredientId: 'i_choco', qty: 120, unit: 'г' },
          { ingredientId: 'i_masc',  qty: 500, unit: 'г' },
          { ingredientId: 'i_flour', qty: 250, unit: 'г' },
          { ingredientId: 'i_berry', qty: 150, unit: 'г', decor: true }
        ],
        labor: [
          { name: 'Приготовление', minutes: 90 },
          { name: 'Декорирование', minutes: 60 },
          { name: 'Упаковка',      minutes: 15 },
          { name: 'Ягодный декор', minutes: 20, decor: true }
        ],
        overheads: defaultOverheads()
      },
      {
        id: 'r_medovik', name: 'Медовик', cat: 'Торты', rate: 500, margin: 55,
        yieldAmount: 2, yieldUnit: 'кг', splitRates: false, scaleLabor: true,
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
        yieldAmount: 1.2, yieldUnit: 'кг', splitRates: false, scaleLabor: true,
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

    var orders = [
      { id: uid('o'), recipeId: 'r_medovik', title: 'Торт «Медовик»', amount: 4500, qty: 2, withDecor: true,
        date: '2026-10-22', time: '14:00', fulfillment: 'pickup', address: '', deliveryFee: 0,
        status: 'done', client: 'Анна', archived: false, rating: 5, review: 'Все гости просили рецепт, спасибо!', reviewDate: '2026-10-22' },
      { id: uid('o'), recipeId: 'r_velvet', title: 'Красный бархат', amount: 6009, qty: 1.5, withDecor: true,
        date: '2026-10-24', time: '16:00', fulfillment: 'delivery', address: 'Москва, Ленинский пр-т, 45, кв. 112', deliveryFee: 500,
        status: 'work', client: 'Марина', archived: false },
      { id: uid('o'), recipeId: 'r_cheese', title: 'Чизкейк', amount: 3800, qty: 1.2, withDecor: true,
        date: '2026-10-26', time: '12:00', fulfillment: 'pickup', address: '', deliveryFee: 0,
        status: 'new', client: 'Ольга', archived: false },
      { id: uid('o'), recipeId: 'r_medovik', title: 'Медовик 3 кг', amount: 6200, qty: 3, withDecor: true,
        date: '2026-10-28', time: '11:30', fulfillment: 'delivery', address: 'Москва, ул. Гарибальди, 8', deliveryFee: 600,
        status: 'confirmed', client: 'Дарья', archived: false },

      { id: uid('o'), recipeId: 'r_velvet', title: 'Красный бархат на юбилей', amount: 9500, qty: 2.5, withDecor: true,
        date: '2026-09-14', time: '15:00', fulfillment: 'delivery', address: 'Москва, Профсоюзная, 104', deliveryFee: 500,
        status: 'done', client: 'Анна', archived: true, rating: 5, review: 'Второй раз заказываю, снова идеально', reviewDate: '2026-09-15' },
      { id: uid('o'), recipeId: 'r_cheese', title: 'Чизкейк с клубникой', amount: 3500, qty: 1.2, withDecor: true,
        date: '2026-09-21', time: '13:00', fulfillment: 'pickup', address: '', deliveryFee: 0,
        status: 'done', client: 'Пётр', archived: true, rating: 3, review: 'Вкусно, но ждал дольше обещанного', reviewDate: '2026-09-22' },
      { id: uid('o'), recipeId: 'r_medovik', title: 'Медовик классический', amount: 4200, qty: 2, withDecor: true,
        date: '2026-09-27', time: '17:00', fulfillment: 'pickup', address: '', deliveryFee: 0,
        status: 'done', client: 'Светлана', archived: true, rating: 4, review: '', reviewDate: '2026-09-28' },
      { id: uid('o'), recipeId: 'r_velvet', title: 'Бархат без декора', amount: 4600, qty: 1.5, withDecor: false,
        date: '2026-09-06', time: '10:00', fulfillment: 'pickup', address: '', deliveryFee: 0,
        status: 'done', client: 'Ирина', archived: true },
      { id: uid('o'), recipeId: '', title: 'Капкейки на заказ', amount: 2800, qty: null, withDecor: true,
        date: '2026-09-19', time: '12:00', fulfillment: 'pickup', address: '', deliveryFee: 0,
        status: 'done', client: 'Марина', archived: true, rating: 4, review: 'Детям понравилось', reviewDate: '2026-09-20' }
    ];

    var refusals = [
      { id: uid('f'), date: '2026-10-12', client: 'Елена',  title: 'Торт 3 кг',    amount: 5500, channel: 'Instagram', stage: 'После озвучивания цены', reason: 'Дорого, не устроила цена', comment: '' },
      { id: uid('f'), date: '2026-10-10', client: 'Ирина',  title: 'Чизкейк 2 кг', amount: 3200, channel: 'WhatsApp',  stage: 'После внесения предоплаты', reason: 'Событие отменилось', comment: '' },
      { id: uid('f'), date: '2026-10-08', client: 'Светлана', title: 'Медовик',    amount: 4500, channel: 'Telegram',  stage: 'До расчёта цены', reason: 'Ушёл к другому кондитеру', comment: '' },
      { id: uid('f'), date: '2026-10-05', client: 'Юлия',   title: 'Капкейки 24 шт', amount: 3600, channel: 'Instagram', stage: 'После озвучивания цены', reason: 'Дорого, не устроила цена', comment: '' },
      { id: uid('f'), date: '2026-10-03', client: 'Ксения', title: 'Свадебный ярус', amount: 12000, channel: 'Сарафан', stage: 'До расчёта цены', reason: 'Занята дата, нет слота', comment: '' },
      { id: uid('f'), date: '2026-09-29', client: 'Алина',  title: 'Бенто-торт',   amount: 1800, channel: 'Авито',     stage: 'До расчёта цены', reason: 'Клиент пропал, не ответил', comment: '' }
    ];

    return {
      version: 1,
      settings: { rate: 500, margin: 55, theme: 'auto', plan: 'free' },
      ingredients: ing,
      recipes: recipes,
      orders: orders,
      refusals: refusals
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1) return parsed;
      }
    } catch (e) { /* приватный режим или повреждённые данные */ }
    return seed();
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { /* молча: приложение работает и без сохранения */ }
  }

  function init() { if (!state) state = load(); return state; }

  var YIELD_UNITS = ['кг', 'г', 'шт', 'порций'];

  /* Рецепты, сохранённые прошлой версией, дополняем значениями по умолчанию */
  function normalizeRecipe(r) {
    if (r.yieldAmount == null) r.yieldAmount = 1;
    if (!r.yieldUnit) r.yieldUnit = 'шт';
    if (r.splitRates == null) r.splitRates = false;
    if (r.scaleLabor == null) r.scaleLabor = true;
    (r.items || []).forEach(function (i) { if (i.decor == null) i.decor = false; });
    (r.labor || []).forEach(function (l) { if (l.decor == null) l.decor = false; });
    return r;
  }

  function normalizeOrder(o) {
    if (o.withDecor == null) o.withDecor = true;
    if (o.archived == null) o.archived = false;
    if (o.fulfillment == null) o.fulfillment = 'pickup';
    if (o.address == null) o.address = '';
    if (o.time == null) o.time = '';
    if (o.deliveryFee == null) o.deliveryFee = 0;
    if (o.rating == null) o.rating = 0;
    if (o.review == null) o.review = '';
    return o;
  }

  function ingredientsById() {
    var map = {};
    init().ingredients.forEach(function (i) { map[i.id] = i; });
    return map;
  }

  /* opts: { scale, withDecor, margin } — для пересчёта под конкретный заказ */
  function computeRecipe(recipe, opts) {
    var o = opts || {};
    normalizeRecipe(recipe);
    return Calc.recipe({
      ingredientsById: ingredientsById(),
      items: recipe.items,
      labor: recipe.labor,
      overheads: recipe.overheads,
      rate: recipe.rate != null ? recipe.rate : init().settings.rate,
      splitRates: !!recipe.splitRates,
      scaleLabor: recipe.scaleLabor !== false,
      scale: o.scale,
      withDecor: o.withDecor,
      margin: o.margin != null ? o.margin
        : (recipe.margin != null ? recipe.margin : init().settings.margin)
    });
  }

  function getRecipe(id) {
    var r = init().recipes.filter(function (x) { return x.id === id; })[0];
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

  function removeRecipe(id) {
    var s = init();
    s.recipes = s.recipes.filter(function (r) { return r.id !== id; });
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

  function removeIngredient(id) {
    var s = init();
    s.ingredients = s.ingredients.filter(function (x) { return x.id !== id; });
    save();
  }

  function usedIn(ingredientId) {
    return init().recipes.filter(function (r) {
      return r.items.some(function (it) { return it.ingredientId === ingredientId; });
    });
  }

  function recipesById() {
    var map = {};
    init().recipes.forEach(function (r) { map[r.id] = r; });
    return map;
  }

  /* Активные заказы (не в архиве) и архив */
  function orders() {
    return init().orders.map(normalizeOrder).filter(function (o) { return !o.archived; });
  }
  function archived() {
    return init().orders.map(normalizeOrder).filter(function (o) { return o.archived; });
  }

  /* Разложение заказа на деньги. Доставка идёт в выручку,
     но не в себестоимость — это отдельная услуга. */
  function orderEconomics(o) {
    normalizeOrder(o);
    var revenue = (Number(o.amount) || 0);
    var r = o.recipeId ? getRecipe(o.recipeId) : null;
    if (!r) return Calc.orderEconomics(revenue, null);
    var scale = o.qty ? Calc.scaleFactor(o.qty, r.yieldAmount) : 1;
    var c = computeRecipe(r, { scale: scale, withDecor: o.withDecor !== false });
    return Calc.orderEconomics(revenue, {
      ingredients: c.ingredients, labor: c.labor, overhead: c.overhead, known: true
    });
  }

  /* Строки для сводки по месяцам: считаем только выполненные заказы */
  function moneyRows() {
    return init().orders.map(normalizeOrder)
      .filter(function (o) { return o.status === 'done'; })
      .map(function (o) {
        var e = orderEconomics(o);
        return { date: o.date, revenue: e.revenue, ingredients: e.ingredients,
                 labor: e.labor, overhead: e.overhead, known: e.known };
      });
  }

  function upsertOrder(o) {
    var s = init();
    if (!o.id) { o.id = uid('o'); s.orders.unshift(o); }
    else {
      var i = s.orders.findIndex(function (x) { return x.id === o.id; });
      if (i >= 0) s.orders[i] = o; else s.orders.unshift(o);
    }
    save();
    return o;
  }

  function removeOrder(id) {
    var s = init();
    s.orders = s.orders.filter(function (x) { return x.id !== id; });
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

  function removeRefusal(id) {
    var s = init();
    s.refusals = s.refusals.filter(function (x) { return x.id !== id; });
    save();
  }

  function setSetting(key, value) {
    init().settings[key] = value;
    save();
  }

  function reset() {
    state = seed();
    save();
  }

  function clearAll() {
    state = {
      version: 1,
      settings: { rate: 500, margin: 55, theme: init().settings.theme, plan: 'free' },
      ingredients: [], recipes: [], orders: [], refusals: []
    };
    save();
  }

  function exportJSON() { return JSON.stringify(init(), null, 2); }

  global.Store = {
    REASONS: REASONS, STAGES: STAGES, CHANNELS: CHANNELS, ORDER_STATUS: ORDER_STATUS,
    YIELD_UNITS: YIELD_UNITS, normalizeRecipe: normalizeRecipe, normalizeOrder: normalizeOrder,
    orders: orders, archived: archived, recipesById: recipesById,
    orderEconomics: orderEconomics, moneyRows: moneyRows,
    uid: uid,
    get state() { return init(); },
    ingredientsById: ingredientsById,
    computeRecipe: computeRecipe,
    getRecipe: getRecipe,
    upsertRecipe: upsertRecipe, removeRecipe: removeRecipe,
    upsertIngredient: upsertIngredient, removeIngredient: removeIngredient, usedIn: usedIn,
    upsertOrder: upsertOrder, removeOrder: removeOrder,
    upsertRefusal: upsertRefusal, removeRefusal: removeRefusal,
    setSetting: setSetting,
    save: save, reset: reset, clearAll: clearAll, exportJSON: exportJSON
  };
})(window);
