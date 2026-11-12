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

  /* Отрицательных количеств, минут и процентов не бывает: всё, что не число
     или меньше нуля, считаем нулём, чтобы опечатка не уводила цену в минус. */
  function pos(v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function toBase(qty, unit) {
    var f = UNIT_FACTOR[unit];
    if (!f) throw new Error('Неизвестная единица: ' + unit);
    return qty * f;
  }

  /* Цена за одну базовую единицу.
     Пример: 850 ₽ за 1 л  ->  850 / 1000 = 0.85 ₽/мл */
  function pricePerBase(ingredient) {
    var baseAmount = toBase(pos(ingredient.amount), ingredient.unit);
    if (!baseAmount) return 0;
    return pos(ingredient.price) / baseAmount;
  }

  /* Стоимость позиции рецепта.
     item: { ingredientId, qty, unit }  — qty в своих единицах */
  function unitsMatch(item, ingredient) {
    return !!ingredient && !!BASE_UNIT[item.unit] && BASE_UNIT[item.unit] === BASE_UNIT[ingredient.unit];
  }

  /* Несовместимые единицы (500 г ингредиента, который продаётся штуками)
     дают 0 и попадают в список проблем рецепта, а не раздувают сумму. */
  function lineCost(item, ingredient) {
    if (!ingredient || !UNIT_FACTOR[item.unit] || !UNIT_FACTOR[ingredient.unit]) return 0;
    if (!unitsMatch(item, ingredient)) return 0;
    var qtyBase = toBase(pos(item.qty), item.unit);
    return pricePerBase(ingredient) * qtyBase;
  }

  /* Цена в понятной кондитеру единице: ₽/кг, ₽/л или ₽/шт */
  function unitPrice(ingredient) {
    if (!ingredient || !UNIT_FACTOR[ingredient.unit]) return { value: 0, unit: '' };
    var base = BASE_UNIT[ingredient.unit];
    var per = pricePerBase(ingredient);
    if (base === 'г') return { value: per * 1000, unit: 'кг' };
    if (base === 'мл') return { value: per * 1000, unit: 'л' };
    return { value: per, unit: 'шт' };
  }

  /* Масса закладки в граммах. Миллилитры считаем как граммы,
     штуки — по массе одной штуки, если она указана у ингредиента.
     Позиции «не растёт с весом» (коробка, топпер) в закладку не входят:
     их не пекут, и упёк от них не зависит. */
  function recipeMass(items, ingredientsById) {
    var grams = 0, unknown = [];
    (items || []).forEach(function (it) {
      var ing = ingredientsById[it.ingredientId];
      if (!ing || !UNIT_FACTOR[it.unit] || it.fixed) return;
      var base = BASE_UNIT[it.unit];
      var q = toBase(pos(it.qty), it.unit);
      if (base === 'г' || base === 'мл') grams += q;
      else if (Number(ing.pieceMass) > 0) grams += q * Number(ing.pieceMass);
      else unknown.push(ing.name);
    });
    return { grams: grams, unknown: unknown };
  }

  /* Выход в граммах, если он задан массой */
  function yieldGrams(amount, unit) {
    var a = Number(amount) || 0;
    if (unit === 'кг') return a * 1000;
    if (unit === 'г') return a;
    return 0;
  }

  /* Упёк и потери: доля массы, которая ушла от закладки до готового изделия */
  function bakeLoss(massGrams, yieldG) {
    if (!(massGrams > 0) || !(yieldG > 0)) return null;
    return {
      percent: (1 - yieldG / massGrams) * 100,
      impossible: yieldG > massGrams
    };
  }

  function ingredientsTotal(items, ingredientsById) {
    return items.reduce(function (sum, it) {
      return sum + lineCost(it, ingredientsById[it.ingredientId]);
    }, 0);
  }

  /* Работа: минуты -> часы -> рубли.
     Ставка берётся своя у этапа, если включены раздельные ставки. */
  function laborMinutes(labor) {
    return labor.reduce(function (s, l) { return s + pos(l.minutes); }, 0);
  }

  function stageRate(stage, commonRate, split) {
    if (split && stage.rate != null && stage.rate !== '') return pos(stage.rate);
    return pos(commonRate);
  }

  function laborTotal(labor, ratePerHour, split) {
    return labor.reduce(function (s, l) {
      return s + pos(l.minutes) / 60 * stageRate(l, ratePerHour, split);
    }, 0);
  }

  /* Накладные — проценты от (ингредиенты + работа) */
  function overheadPercentTotal(overheads) {
    return overheads.reduce(function (s, o) { return s + pos(o.percent); }, 0);
  }

  function overheadBreakdown(overheads, base) {
    return overheads.map(function (o) {
      var p = pos(o.percent);
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

    /* Позиции с признаком fixed не растут с весом заказа:
       фигурка, топпер, коробка стоят одинаково на 1 и на 3 кг. */
    var items = input.items || [];
    var labor = input.labor || [];
    function isFixed(x) { return !!x.fixed; }
    function notFixed(x) { return !x.fixed; }

    /* Масштаб: во сколько раз заказ больше базового выхода рецепта.
       Ингредиенты растут всегда, работа — только если так задано. */
    var scale = Number(input.scale);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    var laborScale = input.scaleLabor === false ? 1 : scale;
    function itemScale(x) { return x.fixed ? 1 : scale; }
    function stageScale(x) { return x.fixed ? 1 : laborScale; }

    var ing = ingredientsTotal(items.filter(notFixed), ingredientsById) * scale +
              ingredientsTotal(items.filter(isFixed), ingredientsById);
    var lab = laborTotal(labor.filter(notFixed), input.rate, input.splitRates) * laborScale +
              laborTotal(labor.filter(isFixed), input.rate, input.splitRates);
    var base = ing + lab;

    var ohPct = overheadPercentTotal(overheads);
    var ohRows = overheadBreakdown(overheads, base);
    var oh = base * ohPct / 100;

    var cost = base + oh;

    var margin = Number(input.margin) || 0;
    if (margin >= 100) margin = 99;          // защита от деления на ноль
    if (margin < 0) margin = 0;

    /* Налог самозанятого берётся со всей полученной суммы.
       Цена до налога даёт заданную маржу, итоговая цена поднята так,
       чтобы после налога на руках осталось столько же. */
    var taxRate = Number(input.taxRate) || 0;
    if (taxRate < 0) taxRate = 0;
    if (taxRate > 50) taxRate = 50;
    var priceNet = cost / (1 - margin / 100);
    var price = priceNet / (1 - taxRate / 100);
    var tax = price - priceNet;
    var profit = priceNet - cost;

    var problems = [];
    items.forEach(function (it) {
      var ingr = ingredientsById[it.ingredientId];
      if (!ingr) problems.push({ item: it, kind: 'missing' });
      else if (!unitsMatch(it, ingr)) problems.push({ item: it, ingredient: ingr, kind: 'unit' });
    });

    return {
      scale: scale,
      lines: items.map(function (it) {
        var ingr = ingredientsById[it.ingredientId];
        return {
          item: it,
          ingredient: ingr,
          cost: lineCost(it, ingr) * itemScale(it)
        };
      }),
      laborRows: labor.map(function (l) {
        var r = stageRate(l, input.rate, input.splitRates);
        return {
          stage: l,
          rate: r,
          minutes: pos(l.minutes) * stageScale(l),
          cost: pos(l.minutes) / 60 * r * stageScale(l)
        };
      }),
      ingredients: ing,
      laborMinutes: laborMinutes(labor.filter(notFixed)) * laborScale + laborMinutes(labor.filter(isFixed)),
      labor: lab,
      base: base,
      overheadPercent: ohPct,
      overheadRows: ohRows,
      overhead: oh,
      cost: cost,
      margin: margin,
      taxRate: taxRate,
      tax: tax,
      priceNet: priceNet,
      price: price,
      profit: profit,
      problems: problems,
      /* фактическая маржа от цены до налога — должна совпасть с margin */
      marginFact: priceNet ? (profit / priceNet) * 100 : 0,
      /* наценка: на сколько процентов цена до налога выше себестоимости */
      markup: cost ? (profit / cost) * 100 : 0
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

  function hasFixed(recipeObj) {
    var all = (recipeObj.items || []).concat(recipeObj.labor || []);
    return all.some(function (x) { return !!x.fixed; });
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
    /* paid — всё, что заплатил клиент. Деньги курьеру (parts.courier) проходят
       транзитом: в выручку не входят, но налог берётся со всей суммы. */
    var paid = Number(revenue) || 0;
    var courier = Math.min(paid, pos(parts && parts.courier));
    var rev = paid - courier;
    var ing = Number(parts && parts.ingredients) || 0;
    var lab = Number(parts && parts.labor) || 0;
    var ovh = Number(parts && parts.overhead) || 0;
    var tax = paid * (Number(parts && parts.taxRate) || 0) / 100;
    var cost = ing + lab + ovh;
    var profit = rev - cost - tax;
    return {
      paid: paid,
      courier: courier,
      revenue: rev,
      ingredients: ing,
      labor: lab,
      overhead: ovh,
      tax: tax,
      cost: cost,
      profit: profit,
      margin: rev ? (profit / rev) * 100 : 0,
      /* сколько реально прибавилось: минус продукты и налог,
         свой труд и расчётные накладные из кармана не уходят */
      cash: rev - ing - tax,
      /* заработок кондитера: ставка за работу плюс всё, что сверху */
      earned: rev - ing - ovh - tax,
      known: !!(parts && parts.known)
    };
  }

  function monthKey(iso) { return String(iso || '').slice(0, 7); }

  var MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн',
                      'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  function monthLabel(key) {
    var p = String(key).split('-');
    var name = MONTHS_SHORT[Number(p[1]) - 1];
    if (p.length < 2 || !name) return String(key);
    return name + ' ' + p[0].slice(2);
  }


  /* Сводка месяца для главного экрана.
     Пришло: выручка выданных заказов. Ушло: закупки (живые деньги) и налог.
     Себестоимость выданных — отдельное число: часть закупок лежит в запасах,
     а часть заказов сделана из купленного раньше, поэтому они не совпадают. */
  function monthSummary(rows, purchases, key) {
    var m = { key: key, label: monthLabel(key), orders: 0, revenue: 0, tax: 0,
              ingredients: 0, labor: 0, overhead: 0, courier: 0, purchases: 0, purchaseCount: 0 };
    (rows || []).forEach(function (r) {
      if (monthKey(r.date) !== key) return;
      m.orders += 1;
      m.revenue += Number(r.revenue) || 0;
      m.tax += Number(r.tax) || 0;
      m.ingredients += Number(r.ingredients) || 0;
      m.labor += Number(r.labor) || 0;
      m.overhead += Number(r.overhead) || 0;
      m.courier += Number(r.courier) || 0;
    });
    (purchases || []).forEach(function (p) {
      if (monthKey(p.date) !== key) return;
      m.purchases += Number(p.amount) || 0;
      m.purchaseCount += 1;
    });
    m.cost = m.ingredients + m.labor + m.overhead;
    m.left = m.revenue - m.purchases - m.tax;
    return m;
  }

  /* rows: [{ date, revenue, ingredients, labor, overhead, known }] */
  function monthlyRollup(rows) {
    var map = {};
    rows.forEach(function (r) {
      var k = monthKey(r.date);
      if (!k) return;
      if (!map[k]) {
        map[k] = { key: k, label: monthLabel(k), orders: 0, withRecipe: 0,
                   revenue: 0, ingredients: 0, labor: 0, overhead: 0, tax: 0, minutes: 0 };
      }
      var m = map[k];
      m.orders += 1;
      if (r.known) m.withRecipe += 1;
      m.revenue += Number(r.revenue) || 0;
      m.ingredients += Number(r.ingredients) || 0;
      m.labor += Number(r.labor) || 0;
      m.overhead += Number(r.overhead) || 0;
      m.tax += Number(r.tax) || 0;
      m.minutes += Number(r.minutes) || 0;
    });
    return Object.keys(map).sort().map(function (k) {
      var m = map[k];
      m.cost = m.ingredients + m.labor + m.overhead;
      m.profit = m.revenue - m.cost - m.tax;
      m.margin = m.revenue ? (m.profit / m.revenue) * 100 : 0;
      m.cash = m.revenue - m.ingredients - m.tax;
      m.earned = m.revenue - m.ingredients - m.overhead - m.tax;
      m.perHour = m.minutes ? m.earned / (m.minutes / 60) : 0;
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

  /* Дата ГГГГ-ММ-ДД по местному времени пользователя */
  function localISO(date) {
    var d = date || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function addDays(iso, n) {
    var p = String(iso).split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }

  function daysBetween(fromIso, toIso) {
    var a = String(fromIso).split('-').map(Number), b = String(toIso).split('-').map(Number);
    return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
  }

  /* Попадает ли дата в последние N дней, считая сегодняшний день целиком.
     Будущие даты тоже попадают: заказ на следующую неделю принят в этом периоде. */
  function withinDays(iso, days, fromIso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return false;
    if (!days) return true;
    return daysBetween(iso, fromIso || localISO()) <= days;
  }

  /* ---------------- Форматирование ---------------- */
  function money(v) {
    var x = Number(v);
    var n = isFinite(x) ? Math.round(x) : 0;
    var digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
    return (n < 0 ? '−' : '') + digits + '\u00A0₽';
  }

  function moneyPrecise(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    var r = Math.round(n * 100) / 100;
    var whole = Math.trunc(Math.abs(r));
    var frac = Math.round((Math.abs(r) - whole) * 100);
    var digits = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
    var f = frac ? ',' + String(frac).padStart(2, '0').replace(/0$/, '') : '';
    return (r < 0 ? '−' : '') + digits + f + '\u00A0₽';
  }

  function pct(v, digits) {
    var d = digits === undefined ? 1 : digits;
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    var t = n.toFixed(d);
    if (Number(t) === 0) t = (0).toFixed(d);            // без «-0%»
    return t.replace('.', ',').replace('-', '−') + '%';
  }

  /* plural(5, 'заказ', 'заказа', 'заказов') -> 'заказов' */
  function plural(n, one, few, many) {
    var a = Math.abs(Number(n) || 0) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b >= 2 && b <= 4) return few;
    return many;
  }

  function duration(minutes) {
    var m = Math.max(0, Math.round(Number(minutes) || 0));
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
    unitsMatch: unitsMatch,
    unitPrice: unitPrice,
    recipeMass: recipeMass,
    yieldGrams: yieldGrams,
    bakeLoss: bakeLoss,
    localISO: localISO,
    addDays: addDays,
    daysBetween: daysBetween,
    plural: plural,
    recipe: recipe,
    marginFromPrice: marginFromPrice,
    scaleFactor: scaleFactor,
    hasFixed: hasFixed,
    monthSummary: monthSummary,
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
