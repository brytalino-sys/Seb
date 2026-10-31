/* ============================================================
   calc.js — единственное место, где считаются деньги.
   Ничего не рисует, ничего не хранит. Чистые функции.
   Любое число на экране должно приходить отсюда.
   ============================================================ */
(function (global) {
  'use strict';

  /* Приведение к базовой единице: г, мл, шт */
  var UNIT_FACTOR = {
    'г': 1, 'кг': 1000,
    'мл': 1, 'л': 1000,
    'шт': 1
  };

  var BASE_UNIT = {
    'г': 'г', 'кг': 'г',
    'мл': 'мл', 'л': 'мл',
    'шт': 'шт'
  };

  function toBase(qty, unit) {
    var f = UNIT_FACTOR[unit];
    if (!f) throw new Error('Неизвестная единица: ' + unit);
    return qty * f;
  }

  /* Цена за одну базовую единицу.
     Пример: 850 ₽ за 1 л  ->  850 / 1000 = 0.85 ₽/мл */
  function pricePerBase(ingredient) {
    var baseAmount = toBase(ingredient.amount, ingredient.unit);
    if (!baseAmount) return 0;
    return ingredient.price / baseAmount;
  }

  /* Стоимость позиции рецепта.
     item: { ingredientId, qty, unit }  — qty в своих единицах */
  function lineCost(item, ingredient) {
    if (!ingredient) return 0;
    var qtyBase = toBase(item.qty, item.unit);
    return pricePerBase(ingredient) * qtyBase;
  }

  function ingredientsTotal(items, ingredientsById) {
    return items.reduce(function (sum, it) {
      return sum + lineCost(it, ingredientsById[it.ingredientId]);
    }, 0);
  }

  /* Работа: минуты -> часы -> рубли.
     Ставка берётся своя у этапа, если включены раздельные ставки. */
  function laborMinutes(labor) {
    return labor.reduce(function (s, l) { return s + (Number(l.minutes) || 0); }, 0);
  }

  function stageRate(stage, commonRate, split) {
    if (split && stage.rate != null && stage.rate !== '') return Number(stage.rate) || 0;
    return Number(commonRate) || 0;
  }

  function laborTotal(labor, ratePerHour, split) {
    return labor.reduce(function (s, l) {
      return s + (Number(l.minutes) || 0) / 60 * stageRate(l, ratePerHour, split);
    }, 0);
  }

  /* Накладные — проценты от (ингредиенты + работа) */
  function overheadPercentTotal(overheads) {
    return overheads.reduce(function (s, o) { return s + (Number(o.percent) || 0); }, 0);
  }

  function overheadBreakdown(overheads, base) {
    return overheads.map(function (o) {
      var p = Number(o.percent) || 0;
      return { name: o.name, percent: p, value: base * p / 100 };
    });
  }

  /* ----------------------------------------------------------
     ГЛАВНАЯ ФОРМУЛА

     base  = ингредиенты + работа
     cost  = base * (1 + накладные% / 100)
     price = cost / (1 - маржа% / 100)
     profit = price - cost
     ---------------------------------------------------------- */
  function recipe(input) {
    var ingredientsById = input.ingredientsById || {};
    var overheads = input.overheads || [];

    /* Декор — необязательная часть рецепта. Выключается тумблером в заказе. */
    var withDecor = input.withDecor !== false;
    function live(x) { return withDecor || !x.decor; }

    var items = (input.items || []).filter(live);
    var labor = (input.labor || []).filter(live);

    /* Масштаб: во сколько раз заказ больше базового выхода рецепта.
       Ингредиенты растут всегда, работа — только если так задано. */
    var scale = Number(input.scale);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    var laborScale = input.scaleLabor === false ? 1 : scale;

    var ing = ingredientsTotal(items, ingredientsById) * scale;
    var lab = laborTotal(labor, input.rate, input.splitRates) * laborScale;
    var base = ing + lab;

    var ohPct = overheadPercentTotal(overheads);
    var ohRows = overheadBreakdown(overheads, base);
    var oh = base * ohPct / 100;

    var cost = base + oh;

    var margin = Number(input.margin) || 0;
    if (margin >= 100) margin = 99;          // защита от деления на ноль
    if (margin < 0) margin = 0;

    var price = cost / (1 - margin / 100);
    var profit = price - cost;

    return {
      scale: scale,
      withDecor: withDecor,
      lines: items.map(function (it) {
        var ingr = ingredientsById[it.ingredientId];
        return {
          item: it,
          ingredient: ingr,
          cost: lineCost(it, ingr) * scale
        };
      }),
      laborRows: labor.map(function (l) {
        var r = stageRate(l, input.rate, input.splitRates);
        return {
          stage: l,
          rate: r,
          minutes: (Number(l.minutes) || 0) * laborScale,
          cost: (Number(l.minutes) || 0) / 60 * r * laborScale
        };
      }),
      ingredients: ing,
      laborMinutes: laborMinutes(labor) * laborScale,
      labor: lab,
      base: base,
      overheadPercent: ohPct,
      overheadRows: ohRows,
      overhead: oh,
      cost: cost,
      margin: margin,
      price: price,
      profit: profit,
      /* фактическая маржа от цены — должна совпасть с margin */
      marginFact: price ? (profit / price) * 100 : 0
    };
  }

  /* Обратная задача: кондитер назвал цену, какая маржа получится */
  function marginFromPrice(cost, price) {
    if (!price) return 0;
    return ((price - cost) / price) * 100;
  }

  /* Во сколько раз заказ больше базового выхода рецепта */
  function scaleFactor(needAmount, yieldAmount) {
    var need = Number(needAmount), base = Number(yieldAmount);
    if (!isFinite(need) || need <= 0) return 1;
    if (!isFinite(base) || base <= 0) return 1;
    return need / base;
  }

  function hasDecor(recipeObj) {
    var all = (recipeObj.items || []).concat(recipeObj.labor || []);
    return all.some(function (x) { return !!x.decor; });
  }

  /* ---------------- Аналитика отказов ---------------- */
  function funnel(orders, refusals) {
    var done = orders.length;
    var lost = refusals.length;
    var total = done + lost;
    var lostRevenue = refusals.reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0);
    var wonRevenue = orders.reduce(function (s, o) { return s + (Number(o.amount) || 0); }, 0);
    return {
      done: done,
      lost: lost,
      total: total,
      conversion: total ? (done / total) * 100 : 0,
      lostRevenue: lostRevenue,
      wonRevenue: wonRevenue,
      avgCheckWon: done ? wonRevenue / done : 0,
      avgCheckLost: lost ? lostRevenue / lost : 0
    };
  }

  function groupBy(refusals, field) {
    var map = {};
    refusals.forEach(function (r) {
      var k = r[field] || 'Не указано';
      if (!map[k]) map[k] = { key: k, count: 0, amount: 0 };
      map[k].count += 1;
      map[k].amount += Number(r.amount) || 0;
    });
    var rows = Object.keys(map).map(function (k) { return map[k]; });
    var total = refusals.length;
    rows.forEach(function (r) { r.share = total ? (r.count / total) * 100 : 0; });
    rows.sort(function (a, b) { return b.count - a.count; });
    return rows;
  }

  /* ---------------- Деньги по заказу ----------------
     Расходы делим на три части: продукты — реальные траты,
     труд — доход самой кондитерши, накладные — расчётная величина.
     cash = выручка минус только продукты: ближе всего к тому,
     сколько денег реально прибавилось. */
  function orderEconomics(revenue, parts) {
    var rev = Number(revenue) || 0;
    var ing = Number(parts && parts.ingredients) || 0;
    var lab = Number(parts && parts.labor) || 0;
    var ovh = Number(parts && parts.overhead) || 0;
    var cost = ing + lab + ovh;
    var profit = rev - cost;
    return {
      revenue: rev,
      ingredients: ing,
      labor: lab,
      overhead: ovh,
      cost: cost,
      profit: profit,
      margin: rev ? (profit / rev) * 100 : 0,
      cash: rev - ing,
      known: !!(parts && parts.known)
    };
  }

  function monthKey(iso) { return String(iso || '').slice(0, 7); }

  var MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн',
                      'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  function monthLabel(key) {
    var p = String(key).split('-');
    if (p.length < 2) return key;
    return MONTHS_SHORT[Number(p[1]) - 1] + ' ' + p[0].slice(2);
  }

  /* rows: [{ date, revenue, ingredients, labor, overhead, known }] */
  function monthlyRollup(rows) {
    var map = {};
    rows.forEach(function (r) {
      var k = monthKey(r.date);
      if (!k) return;
      if (!map[k]) {
        map[k] = { key: k, label: monthLabel(k), orders: 0, withRecipe: 0,
                   revenue: 0, ingredients: 0, labor: 0, overhead: 0 };
      }
      var m = map[k];
      m.orders += 1;
      if (r.known) m.withRecipe += 1;
      m.revenue += Number(r.revenue) || 0;
      m.ingredients += Number(r.ingredients) || 0;
      m.labor += Number(r.labor) || 0;
      m.overhead += Number(r.overhead) || 0;
    });
    return Object.keys(map).sort().map(function (k) {
      var m = map[k];
      m.cost = m.ingredients + m.labor + m.overhead;
      m.profit = m.revenue - m.cost;
      m.margin = m.revenue ? (m.profit / m.revenue) * 100 : 0;
      m.cash = m.revenue - m.ingredients;
      return m;
    });
  }

  function conversionByMonth(orders, refusals) {
    var map = {};
    function touch(k) {
      if (!map[k]) map[k] = { key: k, label: monthLabel(k), done: 0, lost: 0 };
      return map[k];
    }
    orders.forEach(function (o) { var k = monthKey(o.date); if (k) touch(k).done += 1; });
    refusals.forEach(function (r) { var k = monthKey(r.date); if (k) touch(k).lost += 1; });
    return Object.keys(map).sort().map(function (k) {
      var m = map[k];
      m.total = m.done + m.lost;
      m.conversion = m.total ? (m.done / m.total) * 100 : 0;
      return m;
    });
  }

  /* Пересечение двух признаков: какая причина из какого канала */
  function crossTab(rows, rowField, colField) {
    var map = {};
    rows.forEach(function (r) {
      var a = r[rowField] || 'Не указано';
      var b = r[colField] || 'Не указано';
      if (!map[a]) map[a] = { key: a, total: 0, cols: {} };
      map[a].total += 1;
      map[a].cols[b] = (map[a].cols[b] || 0) + 1;
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (x, y) { return y.total - x.total; });
  }

  /* ---------------- Отзывы ---------------- */
  function reviewStats(orders) {
    var rated = orders.filter(function (o) { return Number(o.rating) > 0; });
    var sum = rated.reduce(function (s, o) { return s + Number(o.rating); }, 0);
    var dist = [0, 0, 0, 0, 0];
    rated.forEach(function (o) {
      var i = Math.min(5, Math.max(1, Math.round(Number(o.rating)))) - 1;
      dist[i] += 1;
    });
    var high = rated.filter(function (o) { return Number(o.rating) >= 4; });
    var low = rated.filter(function (o) { return Number(o.rating) <= 3; });
    function avgAmount(list) {
      if (!list.length) return 0;
      return list.reduce(function (s, o) { return s + (Number(o.amount) || 0); }, 0) / list.length;
    }
    return {
      count: rated.length,
      coverage: orders.length ? (rated.length / orders.length) * 100 : 0,
      average: rated.length ? sum / rated.length : 0,
      distribution: dist,
      avgAmountHigh: avgAmount(high),
      avgAmountLow: avgAmount(low),
      withText: rated.filter(function (o) { return (o.review || '').trim(); }).length
    };
  }

  function ratingByRecipe(orders, recipesById) {
    var map = {};
    orders.forEach(function (o) {
      if (!(Number(o.rating) > 0) || !o.recipeId) return;
      if (!map[o.recipeId]) map[o.recipeId] = { id: o.recipeId, count: 0, sum: 0 };
      map[o.recipeId].count += 1;
      map[o.recipeId].sum += Number(o.rating);
    });
    return Object.keys(map).map(function (id) {
      var r = map[id];
      return {
        id: id,
        name: recipesById[id] ? recipesById[id].name : 'Удалённый рецепт',
        count: r.count,
        average: r.sum / r.count
      };
    }).sort(function (a, b) { return b.average - a.average; });
  }

  function repeatClients(orders) {
    var map = {};
    orders.forEach(function (o) {
      var c = (o.client || '').trim().toLowerCase();
      if (!c) return;
      map[c] = (map[c] || 0) + 1;
    });
    var names = Object.keys(map);
    var repeat = names.filter(function (n) { return map[n] > 1; });
    return {
      clients: names.length,
      repeat: repeat.length,
      share: names.length ? (repeat.length / names.length) * 100 : 0
    };
  }

  /* ---------------- Календарь ---------------- */
  /* Сетка месяца с понедельника, всегда целые недели */
  function monthGrid(year, month) {
    var first = new Date(Date.UTC(year, month, 1));
    var shift = (first.getUTCDay() + 6) % 7;      // понедельник = 0
    var start = new Date(Date.UTC(year, month, 1 - shift));
    var weeks = [];
    var cursor = new Date(start);
    for (var w = 0; w < 6; w++) {
      var week = [];
      for (var d = 0; d < 7; d++) {
        week.push({
          iso: cursor.toISOString().slice(0, 10),
          day: cursor.getUTCDate(),
          inMonth: cursor.getUTCMonth() === month
        });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      weeks.push(week);
      if (cursor.getUTCMonth() !== month && w >= 3) break;
    }
    return weeks;
  }

  function withinDays(iso, days, fromIso) {
    if (!iso) return false;
    if (!days) return true;
    var from = fromIso ? new Date(fromIso + 'T00:00:00Z') : new Date();
    var d = new Date(iso + 'T00:00:00Z');
    var diff = (from - d) / 86400000;
    return diff >= -1 && diff <= days;
  }

  /* ---------------- Форматирование ---------------- */
  function money(v) {
    var n = Math.round(Number(v) || 0);
    return n.toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₽';
  }

  function moneyPrecise(v) {
    var n = Number(v) || 0;
    return (Math.round(n * 100) / 100).toLocaleString('ru-RU', {
      minimumFractionDigits: 0, maximumFractionDigits: 2
    }) + ' ₽';
  }

  function pct(v, digits) {
    var d = digits === undefined ? 1 : digits;
    return (Number(v) || 0).toFixed(d).replace('.', ',') + '%';
  }

  function duration(minutes) {
    var m = Math.round(Number(minutes) || 0);
    var h = Math.floor(m / 60);
    var r = m % 60;
    if (h && r) return h + ' ч ' + r + ' мин';
    if (h) return h + ' ч';
    return r + ' мин';
  }

  global.Calc = {
    UNIT_FACTOR: UNIT_FACTOR,
    BASE_UNIT: BASE_UNIT,
    toBase: toBase,
    pricePerBase: pricePerBase,
    lineCost: lineCost,
    ingredientsTotal: ingredientsTotal,
    laborMinutes: laborMinutes,
    laborTotal: laborTotal,
    stageRate: stageRate,
    recipe: recipe,
    marginFromPrice: marginFromPrice,
    scaleFactor: scaleFactor,
    hasDecor: hasDecor,
    funnel: funnel,
    groupBy: groupBy,
    orderEconomics: orderEconomics,
    monthKey: monthKey,
    monthLabel: monthLabel,
    monthlyRollup: monthlyRollup,
    conversionByMonth: conversionByMonth,
    crossTab: crossTab,
    reviewStats: reviewStats,
    ratingByRecipe: ratingByRecipe,
    repeatClients: repeatClients,
    monthGrid: monthGrid,
    withinDays: withinDays,
    MONTHS_SHORT: MONTHS_SHORT,
    money: money,
    moneyPrecise: moneyPrecise,
    pct: pct,
    duration: duration
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).Calc;
}
