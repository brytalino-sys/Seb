/* ============================================================
   app.js — экраны и навигация.
   Деньги не считает: всё берёт из Calc через Store.computeRecipe.
   ============================================================ */
(function () {
  'use strict';

  var tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== undefined
    ? window.Telegram.WebApp : null;

  var viewEl = document.getElementById('view');
  var titleEl = document.getElementById('screenTitle');
  var backBtn = document.getElementById('btnBack');
  var themeBtn = document.getElementById('btnTheme');
  var topbar = document.querySelector('.topbar');
  var slot = document.getElementById('mainButtonSlot');
  var mainBtn = document.getElementById('mainButton');
  var sheet = document.getElementById('sheet');
  var sheetBody = document.getElementById('sheetBody');
  var toastEl = document.getElementById('toast');

  var stack = [{ name: 'recipes' }];
  var filters = { recipes: 'Все', ingredients: 'Все', orders: 'Все' };
  var search = { recipes: '', ingredients: '' };
  var draft = null;          // редактируемый рецепт
  var mainAction = null;
  var ordersMode = 'list';           // list | calendar
  var analyticsTab = 'money';        // money | refusals | reviews
  var refusalPeriod = 0;             // 0 = всё время, иначе дней
  var calCursor = null;              // {y, m}
  var calSelected = null;            // ISO выбранного дня

  /* ---------------- утилиты ---------------- */
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.hidden = true; }, 2200);
  }
  function haptic(type) {
    if (tg && tg.HapticFeedback) {
      try { tg.HapticFeedback.impactOccurred(type || 'light'); } catch (e) {}
    }
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length !== 3) return iso;
    var m = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return Number(p[2]) + ' ' + m[Number(p[1]) - 1] + ' ' + p[0];
  }
  function today() { return new Date().toISOString().slice(0, 10); }

  function switchRow(id, title, sub, checked) {
    return '<label class="switch-row" for="' + id + '">' +
      '<span class="sw-main"><span class="sw-title">' + esc(title) + '</span>' +
      (sub ? '<span class="sw-sub">' + esc(sub) + '</span>' : '') + '</span>' +
      '<span class="switch"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '>' +
      '<span class="switch-track"></span></span></label>';
  }

  function num(v) { return (Math.round((Number(v) || 0) * 100) / 100).toString().replace('.', ','); }

  function segmented(id, options, active) {
    return '<div class="segmented" id="' + id + '" style="grid-template-columns:repeat(' + options.length + ',1fr)">' +
      options.map(function (o) {
        return '<button data-seg="' + esc(o.key) + '"' + (o.key === active ? ' class="active"' : '') + '>' +
          esc(o.label) + '</button>';
      }).join('') + '</div>';
  }

  function bindSegmented(id, onPick) {
    var box = document.getElementById(id);
    if (!box) return;
    box.querySelectorAll('[data-seg]').forEach(function (b) {
      b.addEventListener('click', function () { haptic(); onPick(b.dataset.seg); });
    });
  }

  function stars(value) {
    var v = Math.round(Number(value) || 0);
    var out = '';
    for (var i = 1; i <= 5; i++) out += '<span class="star' + (i <= v ? ' on' : '') + '">★</span>';
    return '<span class="stars" aria-label="Оценка ' + v + ' из 5">' + out + '</span>';
  }

  function kpi(label, value, note, wide) {
    return '<div class="kpi-card' + (wide ? ' wide' : '') + '">' +
      '<div class="kpi-label">' + esc(label) + '</div>' +
      '<div class="kpi-value">' + value + '</div>' +
      (note ? '<div class="kpi-note">' + note + '</div>' : '') + '</div>';
  }

  function emptyState(icon, title, text) {
    return '<div class="empty"><div class="empty-icon">' + icon + '</div>' +
      '<div class="empty-title">' + esc(title) + '</div>' +
      '<div class="empty-text">' + esc(text) + '</div></div>';
  }

  /* ---------------- навигация ---------------- */
  function go(name, params) { stack.push({ name: name, params: params || {} }); render(); }
  function back() { if (stack.length > 1) { stack.pop(); render(); } }
  function switchTab(name) { stack = [{ name: name, params: {} }]; render(); }
  function current() { return stack[stack.length - 1]; }

  backBtn.addEventListener('click', function () { haptic(); back(); });

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { haptic(); switchTab(t.dataset.tab); });
  });

  /* ---------------- тема ---------------- */
  function prefersDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function effectiveTheme() {
    var t = Store.state.settings.theme;
    if (t === 'light' || t === 'dark') return t;
    return prefersDark() ? 'dark' : 'light';
  }
  function applyTheme(t) {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    Store.setSetting('theme', t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', effectiveTheme() === 'dark' ? '#17120F' : '#FDF9F7');
  }
  themeBtn.addEventListener('click', function () {
    haptic();
    applyTheme(effectiveTheme() === 'dark' ? 'light' : 'dark');
  });

  /* ---------------- главная кнопка ---------------- */
  function setMain(text, fn) {
    mainAction = fn;
    if (!text) {
      slot.hidden = true;
      if (tg) tg.MainButton.hide();
      return;
    }
    if (tg) {
      slot.hidden = true;
      tg.MainButton.setText(text);
      tg.MainButton.show();
    } else {
      slot.hidden = false;
      mainBtn.textContent = text;
    }
  }
  mainBtn.addEventListener('click', function () { haptic('medium'); if (mainAction) mainAction(); });
  if (tg) tg.MainButton.onClick(function () { if (mainAction) mainAction(); });

  /* ---------------- шторка ---------------- */
  function openSheet(title, bodyHtml, onMount) {
    sheetBody.innerHTML = '<div class="sheet-handle"></div><h2 class="sheet-title">' + esc(title) + '</h2>' + bodyHtml;
    sheet.hidden = false;
    if (onMount) onMount(sheetBody);
  }
  function closeSheet() { sheet.hidden = true; sheetBody.innerHTML = ''; }

  /* Своё подтверждение: нативный confirm() в части окружений просто не показывается */
  function askConfirm(title, text, label, onYes) {
    openSheet(title,
      '<p class="hint-text" style="margin-top:0">' + esc(text) + '</p>' +
      '<div class="divider"></div>' +
      '<button class="btn-primary" id="cYes" style="background:var(--negative)">' + esc(label) + '</button>' +
      '<div style="height:8px"></div><button class="btn-ghost" id="cNo">Отмена</button>',
      function (root) {
        root.querySelector('#cYes').addEventListener('click', function () { closeSheet(); onYes(); });
        root.querySelector('#cNo').addEventListener('click', closeSheet);
      });
  }
  sheet.addEventListener('click', function (e) { if (e.target.hasAttribute('data-close')) closeSheet(); });

  viewEl.addEventListener('scroll', function () {});
  window.addEventListener('scroll', function () {
    topbar.classList.toggle('scrolled', window.scrollY > 4);
  });


  /* ============================================================
     ГРАФИКИ
     Один масштаб на всю картинку, подписи — текстовыми токенами,
     между сегментами зазор 2px, верх столбца скруглён.
     ============================================================ */
  var SERIES = [
    { key: 'ingredients', label: 'Продукты',  color: 'var(--c-ing)' },
    { key: 'labor',       label: 'Труд',      color: 'var(--c-lab)' },
    { key: 'overhead',    label: 'Накладные', color: 'var(--c-ovh)' },
    { key: 'profit',      label: 'Прибыль',   color: 'var(--c-prof)' }
  ];

  function legend(items) {
    return '<div class="legend">' + items.map(function (s2) {
      return '<span class="legend-item"><span class="legend-swatch" style="background:' + s2.color + '"></span>' +
        esc(s2.label) + '</span>';
    }).join('') + '</div>';
  }

  function moneyChart(rows) {
    if (!rows.length) return '';
    var barW = 34, gap = 22, padL = 46, padR = 12, padT = 18, padB = 28;
    var plotH = 170;
    var W = padL + padR + rows.length * barW + (rows.length - 1) * gap;
    if (W < 320) { padR += 320 - W; W = 320; }
    var H = padT + plotH + padB;

    var max = 0;
    rows.forEach(function (r) { max = Math.max(max, r.revenue, r.cost); });
    if (max <= 0) max = 1;
    var step = Math.pow(10, Math.floor(Math.log10(max)));
    var top = Math.ceil(max / step) * step;
    var y = function (v) { return padT + plotH - (v / top) * plotH; };

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H +
      '" role="img" aria-label="Выручка и расходы по месяцам">';

    [0, 0.5, 1].forEach(function (f) {
      var v = top * f, yy = y(v);
      svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + yy + '" y2="' + yy +
        '" stroke="var(--grid)" stroke-width="1"/>';
      svg += '<text x="' + (padL - 7) + '" y="' + (yy + 4) + '" text-anchor="end" font-size="10" ' +
        'fill="var(--hint)" font-family="var(--mono)">' + Math.round(v / 1000) + 'к</text>';
    });

    rows.forEach(function (r, i) {
      var x = padL + i * (barW + gap);
      var clip = 'clip' + i;
      var barTop = y(Math.max(r.revenue, r.cost));
      var barH = padT + plotH - barTop;
      svg += '<clipPath id="' + clip + '"><rect x="' + x + '" y="' + barTop + '" width="' + barW +
        '" height="' + barH + '" rx="4"/></clipPath>';
      svg += '<g clip-path="url(#' + clip + ')">';

      var acc = 0;
      var parts = [
        { v: r.ingredients, c: 'var(--c-ing)' },
        { v: r.labor,       c: 'var(--c-lab)' },
        { v: r.overhead,    c: 'var(--c-ovh)' }
      ];
      if (r.profit > 0) parts.push({ v: r.profit, c: 'var(--c-prof)' });
      parts.forEach(function (p, idx) {
        if (p.v <= 0) return;
        var hh = (p.v / top) * plotH;
        var yy = padT + plotH - acc - hh;
        var drawH = Math.max(1, hh - (idx < parts.length - 1 ? 2 : 0));
        svg += '<rect x="' + x + '" y="' + (yy + (hh - drawH)) + '" width="' + barW +
          '" height="' + drawH + '" fill="' + p.c + '"/>';
        acc += hh;
      });
      svg += '</g>';

      if (r.profit < 0) {
        svg += '<line x1="' + (x - 3) + '" x2="' + (x + barW + 3) + '" y1="' + y(r.revenue) +
          '" y2="' + y(r.revenue) + '" stroke="var(--text)" stroke-width="2" stroke-dasharray="3 2"/>';
      }

      svg += '<text x="' + (x + barW / 2) + '" y="' + (H - 9) + '" text-anchor="middle" font-size="11" ' +
        'fill="var(--hint)">' + esc(r.label) + '</text>';
      if (rows.length <= 6) {
        svg += '<text x="' + (x + barW / 2) + '" y="' + (barTop - 6) + '" text-anchor="middle" font-size="10" ' +
          'fill="var(--text)" font-family="var(--mono)">' + Math.round(r.revenue / 1000) + 'к</text>';
      }
    });

    svg += '</svg>';
    return '<div class="chart-wrap">' + svg + '</div>' + legend(SERIES);
  }

  function conversionChart(rows) {
    if (rows.length < 2) return '';
    var padL = 40, padR = 12, padT = 14, padB = 26, plotH = 110;
    var stepX = 56;
    var W = Math.max(320, padL + padR + (rows.length - 1) * stepX);
    var H = padT + plotH + padB;
    var usable = W - padL - padR;
    var x = function (i) { return padL + (rows.length === 1 ? usable / 2 : (i / (rows.length - 1)) * usable); };
    var y = function (v) { return padT + plotH - (v / 100) * plotH; };

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H +
      '" role="img" aria-label="Конверсия в заказ по месяцам">';
    [0, 50, 100].forEach(function (v) {
      svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(v) + '" y2="' + y(v) +
        '" stroke="var(--grid)" stroke-width="1"/>' +
        '<text x="' + (padL - 7) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="10" ' +
        'fill="var(--hint)" font-family="var(--mono)">' + v + '%</text>';
    });
    var d = rows.map(function (r, i) { return (i ? 'L' : 'M') + x(i) + ' ' + y(r.conversion); }).join(' ');
    svg += '<path d="' + d + '" fill="none" stroke="var(--c-prof)" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"/>';
    rows.forEach(function (r, i) {
      svg += '<circle cx="' + x(i) + '" cy="' + y(r.conversion) + '" r="4.5" fill="var(--c-prof)" ' +
        'stroke="var(--bg)" stroke-width="2"/>';
      svg += '<text x="' + x(i) + '" y="' + (H - 9) + '" text-anchor="middle" font-size="11" ' +
        'fill="var(--hint)">' + esc(r.label) + '</text>';
    });
    svg += '</svg>';
    return '<div class="chart-wrap">' + svg + '</div>';
  }

  /* ============================================================
     ЭКРАН: РЕЦЕПТЫ
     ============================================================ */
  function viewRecipes() {
    titleEl.textContent = 'Рецепты';
    var s = Store.state;
    var cats = ['Все'].concat(Array.from(new Set(s.recipes.map(function (r) { return r.cat || 'Прочее'; }))));
    var q = search.recipes.toLowerCase();
    var list = s.recipes.filter(function (r) {
      var okCat = filters.recipes === 'Все' || (r.cat || 'Прочее') === filters.recipes;
      var okQ = !q || r.name.toLowerCase().indexOf(q) >= 0;
      return okCat && okQ;
    });

    var html = '<div class="search"><span class="muted">🔍</span><input id="qRecipes" placeholder="Поиск рецептов" value="' + esc(search.recipes) + '"></div>';
    html += '<div class="chips">' + cats.map(function (c) {
      return '<button class="chip' + (filters.recipes === c ? ' active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('') + '</div>';

    if (!list.length) {
      html += s.recipes.length
        ? '<div class="empty"><div class="empty-title">Ничего не найдено</div><div class="empty-text">Попробуй другой запрос или категорию.</div></div>'
        : '<div class="empty"><div class="empty-icon">🎂</div><div class="empty-title">Пока ни одного рецепта</div>' +
          '<div class="empty-text">Добавь первый расчёт: ингредиенты, время работы и накладные. Приложение само покажет себестоимость и цену.</div></div>';
    } else {
      html += '<div class="card">' + list.map(function (r) {
        var c = Store.computeRecipe(r);
        return '<div class="row" data-open="' + r.id + '">' +
          '<div class="thumb">' + esc(r.name.charAt(0)) + '</div>' +
          '<div class="row-main"><div class="row-title">' + esc(r.name) + '</div>' +
          '<div class="row-sub">Себестоимость <span class="num">' + Calc.money(c.cost) + '</span></div></div>' +
          '<div class="row-right"><div class="num num-md">' + Calc.money(c.price) + '</div>' +
          '<div class="row-sub">маржа ' + Calc.pct(c.marginFact, 0) + '</div></div>' +
          '<span class="chev">›</span></div>';
      }).join('') + '</div>';
    }

    var lost = Calc.funnel(s.orders, s.refusals);
    if (s.refusals.length) {
      html += '<div class="stat-card" data-goto="refusals" style="margin-top:14px;cursor:pointer">' +
        '<div class="stat-label">Упущено за период</div>' +
        '<div class="stat-value num num-lg">' + Calc.money(lost.lostRevenue) + '</div>' +
        '<div class="hint-text" style="margin-top:4px">' + lost.lost + ' несостоявшихся заказов →</div></div>';
    }

    viewEl.innerHTML = html;

    var input = document.getElementById('qRecipes');
    if (input) input.addEventListener('input', function () {
      search.recipes = this.value;
      var pos = this.selectionStart; render();
      var n = document.getElementById('qRecipes');
      if (n) { n.focus(); n.setSelectionRange(pos, pos); }
    });
    viewEl.querySelectorAll('[data-cat]').forEach(function (b) {
      b.addEventListener('click', function () { filters.recipes = b.dataset.cat; render(); });
    });
    viewEl.querySelectorAll('[data-open]').forEach(function (b) {
      b.addEventListener('click', function () { haptic(); go('recipe', { id: b.dataset.open }); });
    });
    var st = viewEl.querySelector('[data-goto="refusals"]');
    if (st) st.addEventListener('click', function () { go('refusals'); });

    setMain('+ Новый расчёт', function () { go('recipe', { id: null }); });
  }

  /* ============================================================
     ЭКРАН: РАСЧЁТ СЕБЕСТОИМОСТИ
     ============================================================ */
  function blankRecipe() {
    return {
      id: null, name: '', cat: 'Торты',
      yieldAmount: 1, yieldUnit: 'кг',
      splitRates: false, scaleLabor: true,
      rate: Store.state.settings.rate,
      margin: Store.state.settings.margin,
      items: [],
      labor: [{ name: 'Приготовление', minutes: 60 }],
      overheads: [
        { name: 'Электричество', percent: 5 },
        { name: 'Аренда', percent: 0 },
        { name: 'Упаковка', percent: 3 },
        { name: 'Амортизация', percent: 2 }
      ]
    };
  }

  function viewRecipe(params) {
    titleEl.textContent = 'Расчёт себестоимости';
    if (!draft || draft.__for !== (params.id || 'new')) {
      var src = params.id ? Store.getRecipe(params.id) : null;
      draft = src ? JSON.parse(JSON.stringify(src)) : blankRecipe();
      draft.__for = params.id || 'new';
    }
    var c = Store.computeRecipe(draft);
    var byId = Store.ingredientsById();

    var html = '';
    html += '<div class="field"><label class="label">Название рецепта</label>' +
      '<input class="input" id="fName" placeholder="Например, Красный бархат" value="' + esc(draft.name) + '"></div>';

    var yUnits = Store.YIELD_UNITS.map(function (u) {
      return '<option value="' + esc(u) + '"' + (u === draft.yieldUnit ? ' selected' : '') + '>' + esc(u) + '</option>';
    }).join('');
    html += '<div class="field-row"><div class="field"><label class="label">Базовый выход</label>' +
      '<input class="input num-input" id="fYield" type="number" inputmode="decimal" step="0.1" value="' + draft.yieldAmount + '"></div>' +
      '<div class="field narrow"><label class="label">Ед.</label><select class="input" id="fYieldUnit">' + yUnits + '</select></div></div>';
    html += '<div class="hint-text" style="margin-top:-6px;margin-bottom:14px">Сколько получается из этой закладки. В заказе можно будет указать другой объём, и всё пересчитается.</div>';

    /* Ингредиенты */
    html += '<div class="spread section-title"><span>Ингредиенты</span><button class="btn-link" id="addItem">+ Добавить</button></div>';
    if (!draft.items.length) {
      html += '<div class="card"><div class="row" style="cursor:default"><div class="row-main hint-text">Пока пусто. Добавь первый ингредиент.</div></div></div>';
    } else {
      html += '<div class="card">' + draft.items.map(function (it, i) {
        var ing = byId[it.ingredientId];
        var cost = Calc.lineCost(it, ing);
        return '<div class="row" data-item="' + i + '">' +
          '<div class="row-main"><div class="row-title">' + esc(ing ? ing.name : 'Удалённый ингредиент') +
          (it.decor ? '<span class="tag-decor">декор</span>' : '') + '</div>' +
          '<div class="row-sub num">' + it.qty + ' ' + esc(it.unit) +
          (ing ? ' × ' + Calc.money(ing.price) + '/' + esc(ing.unit) : '') + '</div></div>' +
          '<div class="row-right num num-md">' + Calc.money(cost) + '</div>' +
          '<span class="chev">›</span></div>';
      }).join('') + '</div>';
    }
    html += '<div class="spread" style="padding:8px 2px"><span class="hint-text">Ингредиенты итого</span>' +
      '<span class="num num-md">' + Calc.money(c.ingredients) + '</span></div>';

    /* Работа */
    html += '<div class="spread section-title"><span>Работа</span><button class="btn-link" id="addLabor">+ Добавить</button></div>';
    html += '<div class="card">' + draft.labor.map(function (l, i) {
      var r = Calc.stageRate(l, draft.rate, draft.splitRates);
      return '<div class="row" data-labor="' + i + '">' +
        '<div class="row-main"><div class="row-title">' + esc(l.name) +
        (l.decor ? '<span class="tag-decor">декор</span>' : '') + '</div>' +
        (draft.splitRates ? '<div class="row-sub num">' + Calc.money(r) + ' / ч</div>' : '') + '</div>' +
        '<div class="row-right"><div class="num num-md muted">' + Calc.duration(l.minutes) + '</div>' +
        (draft.splitRates ? '<div class="row-sub num">' + Calc.money(l.minutes / 60 * r) + '</div>' : '') + '</div>' +
        '<span class="chev">›</span></div>';
    }).join('') +
      (draft.splitRates ? '' :
        '<div class="row" id="editRate"><div class="row-main"><div class="row-title">Общая ставка</div>' +
        '<div class="row-sub">' + Calc.duration(c.laborMinutes) + ' работы</div></div>' +
        '<div class="row-right num num-md">' + Calc.money(draft.rate) + ' / ч</div><span class="chev">›</span></div>') +
      '</div>';
    html += '<div style="height:8px"></div>' +
      switchRow('swSplit', 'Разные ставки по этапам',
        draft.splitRates ? 'У каждого этапа своя цена часа' : 'Все этапы считаются по одной ставке',
        draft.splitRates);
    html += '<div class="spread" style="padding:8px 2px"><span class="hint-text">Работа итого</span>' +
      '<span class="num num-md">' + Calc.money(c.labor) + '</span></div>';

    /* Накладные */
    html += '<div class="spread section-title"><span>Накладные</span><button class="btn-link" id="addOh">+ Добавить</button></div>';
    var ohShown = c.overheadRows.filter(function (o) { return o.percent > 0; });
    var ohHidden = c.overheadRows.length - ohShown.length;
    html += '<div class="card">' + c.overheadRows.map(function (o, i) {
      if (o.percent <= 0 && !draft.__showAllOh) return '';
      return '<div class="row" data-oh="' + i + '">' +
        '<div class="row-main"><div class="row-title">' + esc(o.name) + '</div></div>' +
        '<div class="row-right"><span class="num muted">' + o.percent + '%</span> ' +
        '<span class="num num-md" style="margin-left:10px">' + Calc.money(o.value) + '</span></div>' +
        '<span class="chev">›</span></div>';
    }).join('') +
      (ohHidden && !draft.__showAllOh
        ? '<div class="row" id="showAllOh"><div class="row-main hint-text">Показать нулевые статьи (' + ohHidden + ')</div><span class="chev">›</span></div>'
        : '') + '</div>';
    html += '<div class="spread" style="padding:8px 2px"><span class="hint-text">Накладные итого, ' + c.overheadPercent + '% от ' + Calc.money(c.base) + '</span>' +
      '<span class="num num-md">' + Calc.money(c.overhead) + '</span></div>';

    /* Итог */
    html += '<div class="total-card">' +
      '<div class="total-row"><span>Ингредиенты + работа</span><span class="num">' + Calc.money(c.base) + '</span></div>' +
      '<div class="total-row"><span>Накладные ' + c.overheadPercent + '%</span><span class="num">' + Calc.money(c.overhead) + '</span></div>' +
      '<div class="total-row main"><span>Себестоимость</span><span class="num">' + Calc.money(c.cost) + '</span></div>' +
      '<div class="total-row main"><span>Рекомендуемая цена</span><span class="num">' + Calc.money(c.price) + '</span></div>' +
      '<div class="total-row"><span>Прибыль</span><span class="num">' + Calc.money(c.profit) + ' · ' + Calc.pct(c.marginFact) + '</span></div>' +
      '</div>';

    if (draft.yieldAmount > 0) {
      html += '<div class="spread" style="padding:2px 2px 10px"><span class="hint-text">За 1 ' + esc(draft.yieldUnit) + '</span>' +
        '<span class="num num-md">' + Calc.money(c.cost / draft.yieldAmount) + ' себестоимость · ' +
        Calc.money(c.price / draft.yieldAmount) + ' цена</span></div>';
    }

    html += switchRow('swScaleLabor', 'Работа растёт вместе с объёмом',
      draft.scaleLabor ? 'Торт вдвое больше — работы вдвое больше' : 'Работа одинаковая при любом объёме',
      draft.scaleLabor !== false);
    html += '<div style="height:14px"></div>';

    html += '<div class="field"><label class="label">Целевая маржа, %</label>' +
      '<input class="input num-input" id="fMargin" type="number" inputmode="decimal" min="0" max="95" value="' + draft.margin + '"></div>';
    html += '<div class="hint-text">Формула: себестоимость = (ингредиенты + работа) × (1 + накладные%). Цена = себестоимость ÷ (1 − маржа%).</div>';

    if (draft.id) {
      html += '<div class="divider"></div><button class="btn-ghost btn-danger" id="delRecipe">Удалить рецепт</button>';
    }

    viewEl.innerHTML = html;

    document.getElementById('fName').addEventListener('input', function () { draft.name = this.value; });
    document.getElementById('fYield').addEventListener('input', function () {
      draft.yieldAmount = Number(this.value) || 0; render();
    });
    document.getElementById('fYieldUnit').addEventListener('change', function () {
      draft.yieldUnit = this.value; render();
    });
    document.getElementById('swSplit').addEventListener('change', function () {
      draft.splitRates = this.checked; render();
    });
    document.getElementById('swScaleLabor').addEventListener('change', function () {
      draft.scaleLabor = this.checked; render();
    });
    var showOh = document.getElementById('showAllOh');
    if (showOh) showOh.addEventListener('click', function () { draft.__showAllOh = true; render(); });
    document.getElementById('fMargin').addEventListener('input', function () {
      draft.margin = Number(this.value) || 0; renderTotalsOnly();
    });
    document.getElementById('addItem').addEventListener('click', function () { itemSheet(null); });
    document.getElementById('addLabor').addEventListener('click', function () { laborSheet(null); });
    document.getElementById('addOh').addEventListener('click', function () { ohSheet(null); });
    var rateRow = document.getElementById('editRate');
    if (rateRow) rateRow.addEventListener('click', rateSheet);
    viewEl.querySelectorAll('[data-item]').forEach(function (b) {
      b.addEventListener('click', function () { itemSheet(Number(b.dataset.item)); });
    });
    viewEl.querySelectorAll('[data-labor]').forEach(function (b) {
      b.addEventListener('click', function () { laborSheet(Number(b.dataset.labor)); });
    });
    viewEl.querySelectorAll('[data-oh]').forEach(function (b) {
      b.addEventListener('click', function () { ohSheet(Number(b.dataset.oh)); });
    });
    var del = document.getElementById('delRecipe');
    if (del) del.addEventListener('click', function () {
      askConfirm('Удалить рецепт?', 'Рецепт «' + draft.name + '» будет удалён без возможности вернуть.',
        'Удалить', function () { Store.removeRecipe(draft.id); draft = null; back(); });
    });

    setMain('Сохранить рецепт', function () {
      if (!draft.name.trim()) { toast('Впиши название рецепта'); return; }
      if (!draft.items.length) { toast('Добавь хотя бы один ингредиент'); return; }
      var copy = JSON.parse(JSON.stringify(draft));
      delete copy.__for; delete copy.__showAllOh;
      Store.upsertRecipe(copy);
      draft = null;
      toast('Рецепт сохранён');
      back();
    });
  }

  function renderTotalsOnly() { render(); }

  /* --- шторки редактирования внутри расчёта --- */
  function itemSheet(index) {
    var isNew = index === null;
    var it = isNew ? { ingredientId: Store.state.ingredients[0] && Store.state.ingredients[0].id, qty: 100, unit: 'г' } : draft.items[index];
    if (!Store.state.ingredients.length) { toast('Сначала добавь ингредиенты в справочник'); return; }

    var opts = Store.state.ingredients.map(function (i) {
      return '<option value="' + i.id + '"' + (i.id === it.ingredientId ? ' selected' : '') + '>' + esc(i.name) + ' — ' + Calc.money(i.price) + '/' + esc(i.unit) + '</option>';
    }).join('');
    var units = ['г', 'кг', 'мл', 'л', 'шт'].map(function (u) {
      return '<option value="' + u + '"' + (u === it.unit ? ' selected' : '') + '>' + u + '</option>';
    }).join('');

    openSheet(isNew ? 'Добавить ингредиент' : 'Ингредиент в рецепте',
      '<div class="field"><label class="label">Ингредиент</label><select class="input" id="sIng">' + opts + '</select></div>' +
      '<div class="field-row"><div class="field"><label class="label">Количество</label>' +
      '<input class="input num-input" id="sQty" type="number" inputmode="decimal" value="' + it.qty + '"></div>' +
      '<div class="field narrow"><label class="label">Ед.</label><select class="input" id="sUnit">' + units + '</select></div></div>' +
      '<div class="hint-text" id="sPreview"></div>' +
      '<div style="height:14px"></div>' +
      switchRow('sDecor', 'Это декор', 'Необязательная часть: в заказе её можно отключить', !!it.decor) +
      '<div class="divider"></div>' +
      '<button class="btn-primary" id="sSave">Сохранить</button>' +
      (isNew ? '' : '<div style="height:8px"></div><button class="btn-ghost btn-danger" id="sDel">Убрать из рецепта</button>'),
      function (root) {
        function preview() {
          var ing = Store.ingredientsById()[root.querySelector('#sIng').value];
          var tmp = { ingredientId: ing && ing.id, qty: Number(root.querySelector('#sQty').value) || 0, unit: root.querySelector('#sUnit').value };
          try {
            root.querySelector('#sPreview').textContent = 'Стоимость позиции: ' + Calc.moneyPrecise(Calc.lineCost(tmp, ing));
          } catch (e) {
            root.querySelector('#sPreview').textContent = 'Единицы не совпадают с упаковкой ингредиента';
          }
        }
        root.querySelector('#sIng').addEventListener('change', preview);
        root.querySelector('#sQty').addEventListener('input', preview);
        root.querySelector('#sUnit').addEventListener('change', preview);
        preview();
        root.querySelector('#sSave').addEventListener('click', function () {
          var next = {
            ingredientId: root.querySelector('#sIng').value,
            qty: Number(root.querySelector('#sQty').value) || 0,
            unit: root.querySelector('#sUnit').value,
            decor: root.querySelector('#sDecor').checked
          };
          var ing = Store.ingredientsById()[next.ingredientId];
          if (Calc.BASE_UNIT[next.unit] !== Calc.BASE_UNIT[ing.unit]) {
            toast('Ингредиент продаётся в ' + ing.unit + ', переведи количество'); return;
          }
          if (isNew) draft.items.push(next); else draft.items[index] = next;
          closeSheet(); render();
        });
        var d = root.querySelector('#sDel');
        if (d) d.addEventListener('click', function () { draft.items.splice(index, 1); closeSheet(); render(); });
      });
  }

  function laborSheet(index) {
    var isNew = index === null;
    var l = isNew ? { name: '', minutes: 30 } : draft.labor[index];
    openSheet(isNew ? 'Этап работы' : 'Этап работы',
      '<div class="field"><label class="label">Что делаешь</label>' +
      '<input class="input" id="lName" placeholder="Например, декорирование" value="' + esc(l.name) + '"></div>' +
      '<div class="field"><label class="label">Минут</label>' +
      '<input class="input num-input" id="lMin" type="number" inputmode="numeric" value="' + l.minutes + '"></div>' +
      (draft.splitRates
        ? '<div class="field"><label class="label">Ставка этого этапа, ₽/ч</label>' +
          '<input class="input num-input" id="lRate" type="number" inputmode="numeric" placeholder="' + draft.rate + '" value="' +
          (l.rate == null ? '' : l.rate) + '"></div>' +
          '<div class="hint-text" style="margin-top:-8px;margin-bottom:14px">Пусто — считается по общей ставке ' + Calc.money(draft.rate) + ' / ч.</div>'
        : '') +
      switchRow('lDecor', 'Это декор', 'В заказе этап можно отключить', !!l.decor) +
      '<div class="divider"></div>' +
      '<button class="btn-primary" id="lSave">Сохранить</button>' +
      (isNew ? '' : '<div style="height:8px"></div><button class="btn-ghost btn-danger" id="lDel">Удалить этап</button>'),
      function (root) {
        root.querySelector('#lSave').addEventListener('click', function () {
          var next = {
            name: root.querySelector('#lName').value.trim() || 'Работа',
            minutes: Number(root.querySelector('#lMin').value) || 0,
            decor: root.querySelector('#lDecor').checked
          };
          var rateEl = root.querySelector('#lRate');
          if (rateEl) { var rv = rateEl.value.trim(); next.rate = rv === '' ? null : (Number(rv) || 0); }
          else if (l.rate != null) next.rate = l.rate;
          if (isNew) draft.labor.push(next); else draft.labor[index] = next;
          closeSheet(); render();
        });
        var d = root.querySelector('#lDel');
        if (d) d.addEventListener('click', function () { draft.labor.splice(index, 1); closeSheet(); render(); });
      });
  }

  function ohSheet(index) {
    var isNew = index === null;
    var o = isNew ? { name: '', percent: 0 } : draft.overheads[index];
    openSheet('Накладной расход',
      '<div class="field"><label class="label">Статья</label>' +
      '<input class="input" id="oName" placeholder="Например, доставка" value="' + esc(o.name) + '"></div>' +
      '<div class="field"><label class="label">Процент от ингредиентов и работы</label>' +
      '<input class="input num-input" id="oPct" type="number" inputmode="decimal" step="0.5" value="' + o.percent + '"></div>' +
      '<div class="hint-text">Сюда идёт всё, что не попало в состав: электричество, амортизация духовки, брак, расходники.</div>' +
      '<div class="divider"></div><button class="btn-primary" id="oSave">Сохранить</button>' +
      (isNew ? '' : '<div style="height:8px"></div><button class="btn-ghost btn-danger" id="oDel">Удалить статью</button>'),
      function (root) {
        root.querySelector('#oSave').addEventListener('click', function () {
          var next = { name: root.querySelector('#oName').value.trim() || 'Прочее', percent: Number(root.querySelector('#oPct').value) || 0 };
          if (isNew) draft.overheads.push(next); else draft.overheads[index] = next;
          closeSheet(); render();
        });
        var d = root.querySelector('#oDel');
        if (d) d.addEventListener('click', function () { draft.overheads.splice(index, 1); closeSheet(); render(); });
      });
  }

  function rateSheet() {
    openSheet('Ставка за час',
      '<div class="field"><label class="label">Сколько стоит твой час, ₽</label>' +
      '<input class="input num-input" id="rVal" type="number" inputmode="numeric" value="' + draft.rate + '"></div>' +
      '<div class="hint-text">Если не знаешь — возьми желаемый доход в месяц и раздели на количество рабочих часов.</div>' +
      '<div class="divider"></div><button class="btn-primary" id="rSave">Сохранить</button>',
      function (root) {
        root.querySelector('#rSave').addEventListener('click', function () {
          draft.rate = Number(root.querySelector('#rVal').value) || 0;
          Store.setSetting('rate', draft.rate);
          closeSheet(); render();
        });
      });
  }

  /* ============================================================
     ЭКРАН: ИНГРЕДИЕНТЫ
     ============================================================ */
  function viewIngredients() {
    titleEl.textContent = 'Ингредиенты';
    var s = Store.state;
    var cats = ['Все'].concat(Array.from(new Set(s.ingredients.map(function (i) { return i.cat || 'Прочее'; }))));
    var q = search.ingredients.toLowerCase();
    var list = s.ingredients.filter(function (i) {
      var okCat = filters.ingredients === 'Все' || (i.cat || 'Прочее') === filters.ingredients;
      return okCat && (!q || i.name.toLowerCase().indexOf(q) >= 0);
    });

    var html = '<div class="search"><span class="muted">🔍</span><input id="qIng" placeholder="Поиск ингредиентов" value="' + esc(search.ingredients) + '"></div>';
    html += '<div class="chips">' + cats.map(function (c) {
      return '<button class="chip' + (filters.ingredients === c ? ' active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('') + '</div>';

    if (!list.length) {
      html += s.ingredients.length
        ? '<div class="empty"><div class="empty-title">Ничего не найдено</div></div>'
        : '<div class="empty"><div class="empty-icon">🧺</div><div class="empty-title">Справочник пуст</div>' +
          '<div class="empty-text">Внеси продукты, которыми пользуешься. Цену указывай за упаковку — приложение само пересчитает на граммы.</div></div>';
    } else {
      html += '<div class="card">' + list.map(function (i) {
        return '<div class="row" data-ing="' + i.id + '">' +
          '<div class="thumb">' + esc(i.name.charAt(0)) + '</div>' +
          '<div class="row-main"><div class="row-title">' + esc(i.name) + '</div>' +
          '<div class="row-sub">Обновлено ' + fmtDate(i.updated) + '</div></div>' +
          '<div class="row-right"><div class="num num-md">' + Calc.money(i.price) + '</div>' +
          '<div class="row-sub">за ' + i.amount + ' ' + esc(i.unit) + '</div></div>' +
          '<span class="chev">›</span></div>';
      }).join('') + '</div>';
    }

    viewEl.innerHTML = html;
    var inp = document.getElementById('qIng');
    if (inp) inp.addEventListener('input', function () {
      search.ingredients = this.value; var p = this.selectionStart; render();
      var n = document.getElementById('qIng'); if (n) { n.focus(); n.setSelectionRange(p, p); }
    });
    viewEl.querySelectorAll('[data-cat]').forEach(function (b) {
      b.addEventListener('click', function () { filters.ingredients = b.dataset.cat; render(); });
    });
    viewEl.querySelectorAll('[data-ing]').forEach(function (b) {
      b.addEventListener('click', function () { ingredientSheet(b.dataset.ing); });
    });

    setMain('+ Новый ингредиент', function () { ingredientSheet(null); });
  }

  function ingredientSheet(id) {
    var isNew = !id;
    var i = isNew
      ? { name: '', price: '', amount: 1, unit: 'кг', cat: 'Прочее', updated: today() }
      : JSON.parse(JSON.stringify(Store.ingredientsById()[id]));
    var units = ['г', 'кг', 'мл', 'л', 'шт'].map(function (u) {
      return '<option value="' + u + '"' + (u === i.unit ? ' selected' : '') + '>' + u + '</option>';
    }).join('');

    openSheet(isNew ? 'Новый ингредиент' : i.name,
      '<div class="field"><label class="label">Название</label>' +
      '<input class="input" id="iName" placeholder="Например, сливки 33%" value="' + esc(i.name) + '"></div>' +
      '<div class="field-row"><div class="field"><label class="label">Цена покупки, ₽</label>' +
      '<input class="input num-input" id="iPrice" type="number" inputmode="decimal" value="' + i.price + '"></div>' +
      '<div class="field"><label class="label">Количество</label>' +
      '<input class="input num-input" id="iAmt" type="number" inputmode="decimal" value="' + i.amount + '"></div>' +
      '<div class="field narrow"><label class="label">Ед.</label><select class="input" id="iUnit">' + units + '</select></div></div>' +
      '<div class="field"><label class="label">Категория</label>' +
      '<input class="input" id="iCat" value="' + esc(i.cat || '') + '"></div>' +
      '<div class="field"><label class="label">Дата цены</label>' +
      '<input class="input" id="iDate" type="date" value="' + esc(i.updated || today()) + '"></div>' +
      '<div class="hint-text" id="iPreview"></div>' +
      '<div class="divider"></div><button class="btn-primary" id="iSave">Сохранить</button>' +
      (isNew ? '' : '<div style="height:8px"></div><button class="btn-ghost btn-danger" id="iDel">Удалить</button>'),
      function (root) {
        function prev() {
          var tmp = {
            price: Number(root.querySelector('#iPrice').value) || 0,
            amount: Number(root.querySelector('#iAmt').value) || 0,
            unit: root.querySelector('#iUnit').value
          };
          var per = Calc.pricePerBase(tmp);
          var base = Calc.BASE_UNIT[tmp.unit];
          root.querySelector('#iPreview').textContent =
            per ? 'Получается ' + Calc.moneyPrecise(per) + ' за 1 ' + base : '';
        }
        ['#iPrice', '#iAmt'].forEach(function (s) { root.querySelector(s).addEventListener('input', prev); });
        root.querySelector('#iUnit').addEventListener('change', prev);
        prev();

        root.querySelector('#iSave').addEventListener('click', function () {
          var next = {
            id: i.id,
            name: root.querySelector('#iName').value.trim(),
            price: Number(root.querySelector('#iPrice').value) || 0,
            amount: Number(root.querySelector('#iAmt').value) || 0,
            unit: root.querySelector('#iUnit').value,
            cat: root.querySelector('#iCat').value.trim() || 'Прочее',
            updated: root.querySelector('#iDate').value || today()
          };
          if (!next.name) { toast('Впиши название'); return; }
          if (!next.amount) { toast('Количество в упаковке не может быть нулём'); return; }
          Store.upsertIngredient(next);
          closeSheet(); render(); toast('Сохранено');
        });
        var d = root.querySelector('#iDel');
        if (d) d.addEventListener('click', function () {
          var used = Store.usedIn(i.id);
          if (used.length) { toast('Используется в рецептах: ' + used.length + '. Сначала убери оттуда.'); return; }
          Store.removeIngredient(i.id); closeSheet(); render();
        });
      });
  }

  /* ============================================================
     ЭКРАН: ЗАКАЗЫ
     ============================================================ */
  function orderCard(o) {
    var st = Store.ORDER_STATUS.filter(function (x) { return x.key === o.status; })[0] || Store.ORDER_STATUS[0];
    var rec = o.recipeId ? Store.getRecipe(o.recipeId) : null;
    var volume = (rec && o.qty) ? num(o.qty) + ' ' + rec.yieldUnit : '';
    var when = fmtDate(o.date) + (o.time ? ', ' + esc(o.time) : '');
    var where = o.fulfillment === 'delivery' ? 'доставка' : 'самовывоз';
    return '<div class="row" data-ord="' + o.id + '">' +
      '<div class="row-main"><div class="row-title">' + esc(o.title) +
      (rec && Calc.hasDecor(rec) && o.withDecor === false ? '<span class="tag-decor">без декора</span>' : '') + '</div>' +
      '<div class="row-sub">' + (volume ? esc(volume) + ' · ' : '') +
      esc(o.client || '') + (o.client ? ' · ' : '') + when + '</div>' +
      '<div class="row-sub">' + where + (o.address ? ' · ' + esc(o.address) : '') + '</div>' +
      '<div style="margin-top:6px"><span class="badge ' + st.tone + '">' + st.label + '</span>' +
      (Number(o.rating) > 0 ? ' ' + stars(o.rating) : '') + '</div></div>' +
      '<div class="row-right num num-md">' + Calc.money(o.amount) + '</div>' +
      '<span class="chev">›</span></div>';
  }

  function viewOrders() {
    titleEl.textContent = 'Заказы';
    var list = Store.orders();
    var archivedCount = Store.archived().length;

    var html = segmented('ordSeg', [
      { key: 'list', label: 'Список' },
      { key: 'calendar', label: 'Календарь' }
    ], ordersMode);

    if (ordersMode === 'calendar') {
      html += calendarBlock(list);
    } else {
      var tabs = ['Все'].concat(Store.ORDER_STATUS.map(function (x) { return x.label; }));
      html += '<div class="chips">' + tabs.map(function (t) {
        return '<button class="chip' + (filters.orders === t ? ' active' : '') + '" data-ost="' + esc(t) + '">' + esc(t) + '</button>';
      }).join('') + '</div>';

      var shown = list.filter(function (o) {
        if (filters.orders === 'Все') return true;
        var st = Store.ORDER_STATUS.filter(function (x) { return x.key === o.status; })[0];
        return st && st.label === filters.orders;
      }).sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });

      if (!shown.length) {
        html += list.length
          ? '<div class="empty"><div class="empty-title">В этом статусе пусто</div></div>'
          : emptyState('📋', 'Заказов пока нет',
              'Добавляй каждый подтверждённый заказ. Вместе с журналом отказов это даст реальную конверсию, а выполненные заказы наполнят дашборд.');
      } else {
        html += '<div class="card">' + shown.map(orderCard).join('') + '</div>';
      }

      var doneActive = list.filter(function (o) { return o.status === 'done'; });
      if (doneActive.length) {
        html += '<div style="height:12px"></div>' +
          '<button class="btn-ghost" id="toArchive">Убрать выданные в архив (' + doneActive.length + ')</button>';
      }
    }

    if (archivedCount) {
      html += '<div style="height:8px"></div><button class="btn-ghost" id="openArchive">Архив (' + archivedCount + ')</button>';
    }

    viewEl.innerHTML = html;

    bindSegmented('ordSeg', function (k) { ordersMode = k; calSelected = null; render(); });
    viewEl.querySelectorAll('[data-ost]').forEach(function (b) {
      b.addEventListener('click', function () { filters.orders = b.dataset.ost; render(); });
    });
    viewEl.querySelectorAll('[data-ord]').forEach(function (b) {
      b.addEventListener('click', function () { orderSheet(b.dataset.ord); });
    });
    bindCalendar();

    var arch = document.getElementById('toArchive');
    if (arch) arch.addEventListener('click', function () {
      var done = Store.orders().filter(function (o) { return o.status === 'done'; });
      askConfirm('Убрать в архив?', done.length + ' выданных заказов уедут в архив. Из аналитики они никуда не денутся.',
        'Убрать', function () {
          done.forEach(function (o) { o.archived = true; Store.upsertOrder(o); });
          render(); toast('В архиве');
        });
    });
    var opn = document.getElementById('openArchive');
    if (opn) opn.addEventListener('click', function () { go('archive'); });

    setMain('+ Новый заказ', function () { orderSheet(null); });
  }

  /* ---------------- Календарь ---------------- */
  function calendarBlock(list) {
    var now = new Date();
    if (!calCursor) calCursor = { y: now.getFullYear(), m: now.getMonth() };
    var byDay = {};
    list.forEach(function (o) {
      if (!o.date) return;
      (byDay[o.date] = byDay[o.date] || []).push(o);
    });

    var grid = Calc.monthGrid(calCursor.y, calCursor.m);
    var todayIso = today();
    var html = '<div class="cal-head">' +
      '<button class="icon-btn" id="calPrev" aria-label="Предыдущий месяц">‹</button>' +
      '<span class="cal-title">' + Calc.MONTHS_SHORT[calCursor.m] + ' ' + calCursor.y + '</span>' +
      '<button class="icon-btn" id="calNext" aria-label="Следующий месяц">›</button></div>';

    html += '<div class="cal-week">' + ['пн','вт','ср','чт','пт','сб','вс'].map(function (d) {
      return '<div class="cal-dow">' + d + '</div>';
    }).join('') + '</div>';

    html += grid.map(function (week) {
      return '<div class="cal-week" style="margin-bottom:4px">' + week.map(function (d) {
        var orders = byDay[d.iso] || [];
        var cls = 'cal-day' + (d.inMonth ? '' : ' out') +
          (d.iso === todayIso ? ' today' : '') +
          (orders.length ? ' has' : '') +
          (d.iso === calSelected ? ' sel' : '');
        var dots = orders.slice(0, 3).map(function () { return '<span class="cal-dot"></span>'; }).join('');
        return '<button class="' + cls + '" data-day="' + d.iso + '">' +
          '<span>' + d.day + '</span>' +
          '<span class="cal-dots">' + dots + '</span>' +
          (orders.length > 3 ? '<span class="cal-load num">+' + (orders.length - 3) + '</span>' : '') +
          '</button>';
      }).join('') + '</div>';
    }).join('');

    var sel = calSelected ? (byDay[calSelected] || []) : [];
    if (calSelected) {
      html += '<div class="section-title">' + fmtDate(calSelected) + '</div>';
      html += sel.length
        ? '<div class="card">' + sel.sort(function (a, b) {
            return (a.time || '').localeCompare(b.time || '');
          }).map(orderCard).join('') + '</div>'
        : '<div class="card"><div class="row" style="cursor:default">' +
          '<div class="row-main hint-text">В этот день заказов нет. Хороший день, чтобы взять ещё один.</div></div></div>';
    } else {
      html += '<div class="hint-text" style="margin-top:12px">Выбери день, чтобы увидеть заказы. Точки под числом — количество заказов на дату выдачи.</div>';
    }
    return html;
  }

  function bindCalendar() {
    var prev = document.getElementById('calPrev');
    var next = document.getElementById('calNext');
    if (prev) prev.addEventListener('click', function () {
      calCursor.m -= 1;
      if (calCursor.m < 0) { calCursor.m = 11; calCursor.y -= 1; }
      render();
    });
    if (next) next.addEventListener('click', function () {
      calCursor.m += 1;
      if (calCursor.m > 11) { calCursor.m = 0; calCursor.y += 1; }
      render();
    });
    viewEl.querySelectorAll('[data-day]').forEach(function (b) {
      b.addEventListener('click', function () {
        haptic();
        calSelected = (calSelected === b.dataset.day) ? null : b.dataset.day;
        render();
      });
    });
  }

  /* ---------------- Архив ---------------- */
  function viewArchive() {
    titleEl.textContent = 'Архив заказов';
    var list = Store.archived().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var html = '';
    if (!list.length) {
      html += emptyState('🗄', 'Архив пуст',
        'Сюда уезжают выданные заказы, чтобы не мешались в рабочем списке. В аналитике они по-прежнему учитываются.');
    } else {
      var sum = list.reduce(function (s2, o) { return s2 + (Number(o.amount) || 0); }, 0);
      html += '<div class="stat-card"><div class="stat-label">В архиве</div>' +
        '<div class="stat-value num num-lg">' + Calc.money(sum) + '</div>' +
        '<div class="hint-text" style="margin-top:4px">' + list.length + ' заказов</div></div>';
      html += '<div class="card">' + list.map(orderCard).join('') + '</div>';
    }
    viewEl.innerHTML = html;
    viewEl.querySelectorAll('[data-ord]').forEach(function (b) {
      b.addEventListener('click', function () { orderSheet(b.dataset.ord); });
    });
    setMain('', null);
  }

  function orderSheet(id) {
    var isNew = !id;
    var o = isNew
      ? { title: '', client: '', amount: '', date: today(), time: '', status: 'new', recipeId: '',
          qty: '', withDecor: true, fulfillment: 'pickup', address: '', deliveryFee: 0,
          archived: false, rating: 0, review: '' }
      : JSON.parse(JSON.stringify(Store.state.orders.filter(function (x) { return x.id === id; })[0]));
    Store.normalizeOrder(o);

    var recipeOpts = '<option value="">— без привязки —</option>' + Store.state.recipes.map(function (r) {
      return '<option value="' + r.id + '"' + (r.id === o.recipeId ? ' selected' : '') + '>' + esc(r.name) + '</option>';
    }).join('');
    var statusOpts = Store.ORDER_STATUS.map(function (x) {
      return '<option value="' + x.key + '"' + (x.key === o.status ? ' selected' : '') + '>' + x.label + '</option>';
    }).join('');

    openSheet(isNew ? 'Новый заказ' : o.title,
      '<div class="field"><label class="label">Рецепт</label><select class="input" id="oRecipe">' + recipeOpts + '</select></div>' +
      '<div id="oScaleBox"></div>' +
      '<div class="field"><label class="label">Что заказали</label>' +
      '<input class="input" id="oTitle" placeholder="Например, торт «Медовик» 2 кг" value="' + esc(o.title) + '"></div>' +
      '<div class="field"><label class="label">Сумма, ₽</label>' +
      '<input class="input num-input" id="oAmount" type="number" inputmode="decimal" value="' + o.amount + '"></div>' +
      '<div class="field-row"><div class="field"><label class="label">Дата выдачи</label>' +
      '<input class="input" id="oDate" type="date" value="' + esc(o.date) + '"></div>' +
      '<div class="field"><label class="label">Время</label>' +
      '<input class="input" id="oTime" type="time" value="' + esc(o.time || '') + '"></div></div>' +
      '<div class="field"><label class="label">Клиент</label>' +
      '<input class="input" id="oClient" value="' + esc(o.client || '') + '"></div>' +

      switchRow('oDelivery', 'Доставка', 'Выключено — клиент забирает сам', o.fulfillment === 'delivery') +
      '<div style="height:12px"></div>' +
      '<div id="oDeliveryBox"></div>' +

      '<div class="field"><label class="label">Статус</label><select class="input" id="oStatus">' + statusOpts + '</select></div>' +
      '<div id="oReviewBox"></div>' +
      '<div class="divider"></div><button class="btn-primary" id="oSave">Сохранить</button>' +
      (isNew ? '' : '<div style="height:8px"></div><button class="btn-ghost" id="oArch">' +
        (o.archived ? 'Вернуть из архива' : 'Убрать в архив') + '</button>' +
        '<div style="height:8px"></div><button class="btn-ghost btn-danger" id="oDel">Удалить заказ</button>'),
      function (root) {
        var box = root.querySelector('#oScaleBox');

        function recipe() { var v = root.querySelector('#oRecipe').value; return v ? Store.getRecipe(v) : null; }
        function qtyVal() {
          var f = root.querySelector('#oQty');
          return f ? Number(f.value) || 0 : Number(o.qty) || 0;
        }
        function decorOn() {
          var f = root.querySelector('#oDecor');
          return f ? f.checked : o.withDecor !== false;
        }

        /* Блок масштаба перерисовывается при смене рецепта */
        function drawScale() {
          var r = recipe();
          if (!r) { box.innerHTML = ''; return; }
          var q = qtyVal() || r.yieldAmount;
          box.innerHTML =
            '<div class="field-row"><div class="field"><label class="label">Сколько нужно</label>' +
            '<input class="input num-input" id="oQty" type="number" inputmode="decimal" step="0.1" value="' + q + '"></div>' +
            '<div class="field narrow"><label class="label">Ед.</label>' +
            '<input class="input" id="oQtyUnit" value="' + esc(r.yieldUnit) + '" readonly></div></div>' +
            '<div class="hint-text" style="margin-top:-6px;margin-bottom:12px">Базовый выход рецепта — ' +
            num(r.yieldAmount) + ' ' + esc(r.yieldUnit) + '.</div>' +
            (Calc.hasDecor(r)
              ? switchRow('oDecor', 'С декором', 'В рецепте есть отключаемая декоративная часть', decorOn()) +
                '<div style="height:12px"></div>'
              : '') +
            '<div id="oCalc" class="total-card"></div>';
          var qf = root.querySelector('#oQty');
          if (qf) qf.addEventListener('input', recalc);
          var df = root.querySelector('#oDecor');
          if (df) df.addEventListener('change', recalc);
          recalc();
        }

        function recalc() {
          var r = recipe();
          var panel = root.querySelector('#oCalc');
          if (!r || !panel) return;
          var scale = Calc.scaleFactor(qtyVal(), r.yieldAmount);
          var c = Store.computeRecipe(r, { scale: scale, withDecor: decorOn() });
          var amount = Number(root.querySelector('#oAmount').value) || 0;
          var m = amount ? Calc.marginFromPrice(c.cost, amount) : c.marginFact;
          var low = amount && m < 0;
          panel.innerHTML =
            '<div class="total-row"><span>Множитель</span><span class="num">×' + num(scale) + '</span></div>' +
            '<div class="total-row"><span>Себестоимость</span><span class="num">' + Calc.money(c.cost) + '</span></div>' +
            '<div class="total-row main"><span>Рекомендуемая цена</span><span class="num">' + Calc.money(c.price) + '</span></div>' +
            (amount
              ? '<div class="total-row"><span>' + (low ? 'Работа в убыток' : 'При сумме заказа') + '</span>' +
                '<span class="num">' + Calc.money(amount - c.cost) + ' · ' + Calc.pct(m) + '</span></div>'
              : '');
          panel.dataset.price = Math.round(c.price);
        }

        root.querySelector('#oRecipe').addEventListener('change', function () {
          var r = recipe();
          o.qty = '';
          drawScale();
          if (r && !root.querySelector('#oTitle').value) root.querySelector('#oTitle').value = r.name;
          if (r && !root.querySelector('#oAmount').value) {
            var panel = root.querySelector('#oCalc');
            if (panel && panel.dataset.price) root.querySelector('#oAmount').value = panel.dataset.price;
          }
          recalc();
        });
        /* Блок доставки */
        function drawDelivery() {
          var on = root.querySelector('#oDelivery').checked;
          var box = root.querySelector('#oDeliveryBox');
          box.innerHTML = on
            ? '<div class="field"><label class="label">Адрес доставки</label>' +
              '<input class="input" id="oAddress" placeholder="Город, улица, дом, квартира" value="' + esc(o.address || '') + '"></div>' +
              '<div class="field"><label class="label">Стоимость доставки, ₽</label>' +
              '<input class="input num-input" id="oFee" type="number" inputmode="decimal" value="' + (o.deliveryFee || 0) + '"></div>' +
              '<div class="hint-text" style="margin-top:-8px;margin-bottom:14px">Доставка входит в сумму заказа, но не в себестоимость торта.</div>'
            : '';
        }
        root.querySelector('#oDelivery').addEventListener('change', function () {
          var a = root.querySelector('#oAddress');
          var f = root.querySelector('#oFee');
          if (a) o.address = a.value;
          if (f) o.deliveryFee = Number(f.value) || 0;
          drawDelivery();
        });
        drawDelivery();

        /* Отзыв — только у выданных заказов */
        function drawReview() {
          var done = root.querySelector('#oStatus').value === 'done';
          var box = root.querySelector('#oReviewBox');
          if (!done) { box.innerHTML = ''; return; }
          box.innerHTML =
            '<div class="section-title">Отзыв клиента</div>' +
            '<div class="rate-pick" id="oRate">' +
            [1, 2, 3, 4, 5].map(function (n) {
              return '<button type="button" data-rate="' + n + '"' +
                (Number(o.rating) >= n ? ' class="on"' : '') + '>★</button>';
            }).join('') + '</div>' +
            '<div style="height:10px"></div>' +
            '<div class="field"><label class="label">Что сказали</label>' +
            '<textarea class="input" id="oReview" rows="2" placeholder="Своими словами">' + esc(o.review || '') + '</textarea></div>' +
            (Number(o.rating) ? '<button class="btn-link" id="oRateClear">Убрать оценку</button>' : '');
          box.querySelectorAll('[data-rate]').forEach(function (b) {
            b.addEventListener('click', function () {
              o.rating = Number(b.dataset.rate);
              var t = root.querySelector('#oReview');
              if (t) o.review = t.value;
              haptic(); drawReview();
            });
          });
          var clr = box.querySelector('#oRateClear');
          if (clr) clr.addEventListener('click', function () {
            o.rating = 0;
            var t = root.querySelector('#oReview');
            if (t) o.review = t.value;
            drawReview();
          });
        }
        root.querySelector('#oStatus').addEventListener('change', drawReview);
        drawReview();

        root.querySelector('#oAmount').addEventListener('input', recalc);
        drawScale();

        root.querySelector('#oSave').addEventListener('click', function () {
          var delivery = root.querySelector('#oDelivery').checked;
          var addrEl = root.querySelector('#oAddress');
          var feeEl = root.querySelector('#oFee');
          var revEl = root.querySelector('#oReview');
          var next = {
            id: o.id,
            title: root.querySelector('#oTitle').value.trim(),
            recipeId: root.querySelector('#oRecipe').value,
            qty: qtyVal() || null,
            withDecor: decorOn(),
            amount: Number(root.querySelector('#oAmount').value) || 0,
            date: root.querySelector('#oDate').value,
            time: root.querySelector('#oTime').value,
            client: root.querySelector('#oClient').value.trim(),
            status: root.querySelector('#oStatus').value,
            fulfillment: delivery ? 'delivery' : 'pickup',
            address: delivery ? (addrEl ? addrEl.value.trim() : o.address) : '',
            deliveryFee: delivery ? (feeEl ? Number(feeEl.value) || 0 : o.deliveryFee) : 0,
            archived: !!o.archived,
            rating: Number(o.rating) || 0,
            review: revEl ? revEl.value.trim() : (o.review || ''),
            reviewDate: o.reviewDate
          };
          if (!next.title) { toast('Впиши, что заказали'); return; }
          if (next.status !== 'done') { next.rating = 0; next.review = ''; }
          if (next.rating && !next.reviewDate) next.reviewDate = today();
          Store.upsertOrder(next); closeSheet(); render(); toast('Сохранено');
        });
        var arch = root.querySelector('#oArch');
        if (arch) arch.addEventListener('click', function () {
          o.archived = !o.archived;
          Store.upsertOrder(o);
          closeSheet(); render();
          toast(o.archived ? 'Убрано в архив' : 'Возвращено в список');
        });
        var d = root.querySelector('#oDel');
        if (d) d.addEventListener('click', function () {
          askConfirm('Удалить заказ?', 'Заказ «' + (o.title || 'без названия') + '» исчезнет и из аналитики тоже.',
            'Удалить', function () { Store.removeOrder(o.id); closeSheet(); render(); });
        });
      });
  }

  /* ============================================================
     ЭКРАН: АНАЛИТИКА
     ============================================================ */
  function viewAnalytics() {
    titleEl.textContent = 'Аналитика';
    var html = segmented('anSeg', [
      { key: 'money', label: 'Деньги' },
      { key: 'refusals', label: 'Отказы' },
      { key: 'reviews', label: 'Отзывы' }
    ], analyticsTab);

    if (analyticsTab === 'money') html += moneySection();
    else if (analyticsTab === 'refusals') html += refusalSection();
    else html += reviewSection();

    viewEl.innerHTML = html;
    bindSegmented('anSeg', function (k) { analyticsTab = k; render(); });

    viewEl.querySelectorAll('[data-period]').forEach(function (b) {
      b.addEventListener('click', function () { refusalPeriod = Number(b.dataset.period); render(); });
    });
    var toRef = document.getElementById('toRef');
    if (toRef) toRef.addEventListener('click', function () { go('refusals'); });
    var toSet = document.getElementById('toSettings');
    if (toSet) toSet.addEventListener('click', function () { go('settings'); });
    viewEl.querySelectorAll('[data-ord]').forEach(function (b) {
      b.addEventListener('click', function () { orderSheet(b.dataset.ord); });
    });

    if (analyticsTab === 'refusals') setMain('+ Добавить отказ', function () { refusalSheet(null); });
    else setMain('', null);
  }

  /* ---------------- Деньги ---------------- */
  function moneySection() {
    var rows = Store.moneyRows();
    if (!rows.length) {
      return emptyState('💰', 'Выполненных заказов нет',
        'Дашборд считается по заказам со статусом «Выдан». Отметь первый выполненный заказ, и здесь появятся выручка, расходы и прибыль.');
    }

    var months = Calc.monthlyRollup(rows);
    var all = months.reduce(function (a, m) {
      a.revenue += m.revenue; a.ingredients += m.ingredients;
      a.labor += m.labor; a.overhead += m.overhead;
      a.orders += m.orders; a.withRecipe += m.withRecipe;
      return a;
    }, { revenue: 0, ingredients: 0, labor: 0, overhead: 0, orders: 0, withRecipe: 0 });
    all.cost = all.ingredients + all.labor + all.overhead;
    all.profit = all.revenue - all.cost;
    all.margin = all.revenue ? (all.profit / all.revenue) * 100 : 0;
    all.cash = all.revenue - all.ingredients;

    var html = '<div class="kpi">' +
      kpi('Выручка', Calc.money(all.revenue), all.orders + ' выполненных заказов') +
      kpi('Прибыль', Calc.money(all.profit), 'маржа ' + Calc.pct(all.margin)) +
      kpi('Деньги за вычетом продуктов', Calc.money(all.cash),
          'сколько реально прибавилось: труд и накладные из кармана не уходят', true) +
      '</div>';

    html += '<div class="section-title">Куда уходит выручка</div>';
    html += moneyChart(months);

    html += '<div class="section-title">По месяцам</div>';
    html += '<div class="table-scroll"><table class="data-table"><thead><tr>' +
      '<th>Месяц</th><th class="num">Выручка</th><th class="num">Продукты</th>' +
      '<th class="num">Труд</th><th class="num">Накладные</th><th class="num">Прибыль</th><th class="num">Маржа</th>' +
      '</tr></thead><tbody>' +
      months.slice().reverse().map(function (m) {
        return '<tr><td>' + esc(m.label) + '</td>' +
          '<td class="num">' + Calc.money(m.revenue) + '</td>' +
          '<td class="num">' + Calc.money(m.ingredients) + '</td>' +
          '<td class="num">' + Calc.money(m.labor) + '</td>' +
          '<td class="num">' + Calc.money(m.overhead) + '</td>' +
          '<td class="num' + (m.profit < 0 ? ' neg' : '') + '">' + Calc.money(m.profit) + '</td>' +
          '<td class="num">' + Calc.pct(m.margin, 0) + '</td></tr>';
      }).join('') + '</tbody></table></div>';

    html += '<div class="hint-text" style="margin-top:10px">Расходы считаются от себестоимости выполненных заказов. ' +
      'Продукты — настоящие траты, труд — твой собственный доход, накладные — расчётная величина.</div>';

    if (all.orders > all.withRecipe) {
      html += '<div class="hint-text neg" style="margin-top:8px">' + (all.orders - all.withRecipe) +
        ' заказов без привязки к рецепту: их выручка посчитана, а расходы нет. Привяжи рецепт, чтобы прибыль не завышалась.</div>';
    }
    return html;
  }

  /* ---------------- Отказы ---------------- */
  function refusalSection() {
    var s2 = Store.state;
    var periods = [{ d: 30, l: '30 дней' }, { d: 90, l: '90 дней' }, { d: 0, l: 'Всё время' }];
    var inPeriod = function (x) { return !refusalPeriod || Calc.withinDays(x.date, refusalPeriod); };
    var refusals = s2.refusals.filter(inPeriod);
    var orders = s2.orders.filter(inPeriod);
    var f = Calc.funnel(orders, refusals);

    var html = '<div class="chips">' + periods.map(function (p) {
      return '<button class="chip' + (refusalPeriod === p.d ? ' active' : '') + '" data-period="' + p.d + '">' + p.l + '</button>';
    }).join('') + '</div>';

    if (!refusals.length && !orders.length) {
      return html + emptyState('📉', 'За этот период пусто',
        'Выбери другой период или запиши первый несостоявшийся заказ — самая ценная часть аналитики собирается именно оттуда.');
    }

    html += '<div class="kpi">' +
      kpi('Конверсия в заказ', Calc.pct(f.conversion), f.done + ' из ' + f.total + ' обращений') +
      kpi('Упущено', Calc.money(f.lostRevenue), f.lost + ' отказов') +
      kpi('Средний чек', Calc.money(f.avgCheckWon), 'упущенный ' + Calc.money(f.avgCheckLost)) +
      kpi('Разрыв чека', Calc.money(f.avgCheckLost - f.avgCheckWon),
          f.avgCheckLost > f.avgCheckWon ? 'отказываются от заказов дороже среднего' : 'отказываются от мелких заказов') +
      '</div>';

    function barBlock(title, rows, note) {
      if (!rows.length) return '';
      var max = Math.max.apply(null, rows.map(function (r) { return r.count; }));
      return '<div class="section-title">' + title + '</div><div class="card" style="padding:12px 14px">' +
        rows.map(function (r) {
          return '<div class="bar-row"><span>' + esc(r.key) + '</span>' +
            '<span class="bar-track"><span class="bar-fill" style="width:' + (max ? (r.count / max * 100) : 0) + '%"></span></span>' +
            '<span class="num muted" style="text-align:right">' + Calc.pct(r.share, 0) + '</span></div>' +
            '<div class="hint-text" style="margin:-4px 0 6px">' + r.count + ' шт · упущено ' + Calc.money(r.amount) + '</div>';
        }).join('') +
        (note ? '<div class="hint-text" style="margin-top:8px">' + note + '</div>' : '') + '</div>';
    }

    var byReason = Calc.groupBy(refusals, 'reason');
    html += barBlock('Почему не купили', byReason);
    html += barBlock('На каком этапе срывалось', Calc.groupBy(refusals, 'stage'));
    html += barBlock('Откуда приходили', Calc.groupBy(refusals, 'channel'));

    var cross = Calc.crossTab(refusals, 'reason', 'channel');
    if (cross.length) {
      html += '<div class="section-title">Причина и канал</div>' +
        '<div class="table-scroll"><table class="data-table"><thead><tr><th>Причина</th>' +
        Store.CHANNELS.map(function (c) { return '<th class="num">' + esc(c.slice(0, 4)) + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        cross.map(function (r) {
          return '<tr><td>' + esc(r.key) + '</td>' +
            Store.CHANNELS.map(function (c) {
              var v = r.cols[c] || 0;
              return '<td class="num' + (v ? '' : ' muted') + '">' + (v || '·') + '</td>';
            }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="hint-text" style="margin-top:8px">Если одна причина скапливается в одном канале — проблема в канале, а не в тебе.</div>';
    }

    var conv = Calc.conversionByMonth(s2.orders, s2.refusals);
    if (conv.length >= 2) {
      html += '<div class="section-title">Конверсия по месяцам</div>' + conversionChart(conv);
    }

    if (byReason.length) {
      var top = byReason[0];
      var advice = {
        'Дорого, не устроила цена': 'Проверь, не слишком ли широкая аудитория. Если половина отказов по цене — проблема в сегменте, а не в прайсе.',
        'Занята дата, нет слота': 'Спрос выше пропускной способности. Это сигнал поднимать цену, а не брать больше смен.',
        'Клиент пропал, не ответил': 'Скорее всего, долгий ответ или непонятная цена в переписке.',
        'Ушёл к другому кондитеру': 'Посмотри, что у конкурентов отличается кроме цены: сроки, подача, фото.',
        'Слишком срочно': 'Можно ввести наценку за срочность вместо отказа.'
      }[top.key];
      if (advice) {
        html += '<div class="section-title">Что с этим делать</div><div class="card" style="padding:14px">' +
          '<div class="row-title">' + esc(top.key) + ' — ' + Calc.pct(top.share, 0) + ' отказов</div>' +
          '<div class="hint-text" style="margin-top:6px">' + advice + '</div></div>';
      }
    }

    html += '<div class="divider"></div><button class="btn-ghost" id="toRef">Журнал отказов (' + s2.refusals.length + ')</button>';
    html += '<div style="height:8px"></div><button class="btn-ghost" id="toSettings">Данные и настройки</button>';
    return html;
  }

  /* ---------------- Отзывы ---------------- */
  function reviewSection() {
    var done = Store.state.orders.map(Store.normalizeOrder)
      .filter(function (o) { return o.status === 'done'; });
    var rs = Calc.reviewStats(done);

    if (!done.length) {
      return emptyState('⭐️', 'Отзывов пока нет',
        'Оценка и отзыв заполняются в карточке выданного заказа. Когда их наберётся десяток, станет видно, какие рецепты держат марку.');
    }

    var html = '<div class="kpi">' +
      kpi('Средняя оценка', rs.count ? stars(rs.average) + ' <span class="num">' + num(rs.average) + '</span>' : '—',
          rs.count + ' из ' + done.length + ' заказов с оценкой') +
      kpi('Собрано отзывов', Calc.pct(rs.coverage, 0), rs.withText + ' с текстом') +
      '</div>';

    if (rs.count) {
      var maxD = Math.max.apply(null, rs.distribution);
      html += '<div class="section-title">Распределение оценок</div><div class="card" style="padding:12px 14px">' +
        [5, 4, 3, 2, 1].map(function (n) {
          var c = rs.distribution[n - 1];
          return '<div class="bar-row"><span>' + stars(n) + '</span>' +
            '<span class="bar-track"><span class="bar-fill" style="width:' + (maxD ? c / maxD * 100 : 0) + '%"></span></span>' +
            '<span class="num muted" style="text-align:right">' + c + '</span></div>';
        }).join('') + '</div>';

      if (rs.avgAmountHigh && rs.avgAmountLow) {
        var diff = rs.avgAmountHigh - rs.avgAmountLow;
        html += '<div class="card" style="padding:14px;margin-top:12px">' +
          '<div class="row-title">Оценка и цена</div>' +
          '<div class="hint-text" style="margin-top:6px">Средний чек при оценке 4–5: <span class="num">' +
          Calc.money(rs.avgAmountHigh) + '</span>. При 1–3: <span class="num">' + Calc.money(rs.avgAmountLow) + '</span>. ' +
          (diff > 0
            ? 'Дорогие заказы оценивают выше — цена не отпугивает тех, кто уже купил.'
            : 'Дешёвые заказы оценивают выше. Стоит посмотреть, оправдываешь ли ты ожидания на верхнем сегменте.') +
          '</div></div>';
      }

      var byRecipe = Calc.ratingByRecipe(done, Store.recipesById());
      if (byRecipe.length) {
        html += '<div class="section-title">Оценки по рецептам</div><div class="card">' +
          byRecipe.map(function (r) {
            return '<div class="row" style="cursor:default"><div class="row-main">' +
              '<div class="row-title">' + esc(r.name) + '</div>' +
              '<div class="row-sub">' + r.count + ' ' + (r.count === 1 ? 'оценка' : 'оценок') + '</div></div>' +
              '<div class="row-right">' + stars(r.average) + '<div class="row-sub num">' + num(r.average) + '</div></div></div>';
          }).join('') + '</div>';
      }
    }

    var rc = Calc.repeatClients(done);
    html += '<div class="kpi" style="margin-top:12px">' +
      kpi('Повторные клиенты', Calc.pct(rc.share, 0), rc.repeat + ' из ' + rc.clients + ' вернулись') +
      kpi('Всего клиентов', String(rc.clients), 'по выполненным заказам') +
      '</div>';

    var texts = done.filter(function (o) { return (o.review || '').trim(); })
      .sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    if (texts.length) {
      html += '<div class="section-title">Что пишут</div><div class="card">' +
        texts.map(function (o) {
          return '<div class="row" data-ord="' + o.id + '"><div class="row-main">' +
            '<div>' + stars(o.rating) + '</div>' +
            '<div class="row-sub" style="margin-top:4px">' + esc(o.review) + '</div>' +
            '<div class="row-sub">' + esc(o.client || 'Без имени') + ' · ' + esc(o.title) + ' · ' + fmtDate(o.date) + '</div>' +
            '</div><span class="chev">›</span></div>';
        }).join('') + '</div>';
    }

    html += '<div class="hint-text" style="margin-top:12px">Отзыв заполняется в карточке заказа со статусом «Выдан».</div>';
    return html;
  }

  /* ============================================================
     ЭКРАН: ЖУРНАЛ ОТКАЗОВ
     ============================================================ */
  function viewRefusals() {
    titleEl.textContent = 'Журнал отказов';
    var s = Store.state;
    var f = Calc.funnel(s.orders, s.refusals);
    var html = '';

    if (s.refusals.length) {
      html += '<div class="stat-card"><div class="stat-label">Упущено за период</div>' +
        '<div class="stat-value num num-lg">' + Calc.money(f.lostRevenue) + '</div>' +
        '<div class="hint-text" style="margin-top:4px">' + f.lost + ' записей</div></div>';
      html += '<div class="card">' + s.refusals.slice().sort(function (a, b) {
        return (b.date || '').localeCompare(a.date || '');
      }).map(function (r) {
        return '<div class="row" data-ref="' + r.id + '">' +
          '<div class="row-main"><div class="row-title">' + esc(r.title || 'Без названия') + '</div>' +
          '<div class="row-sub">' + esc(r.client || '') + (r.client ? ' · ' : '') + esc(r.channel || '') + ' · ' + fmtDate(r.date) + '</div>' +
          '<div class="row-sub" style="margin-top:4px">Этап: ' + esc(r.stage || '—') + '</div>' +
          '<div class="row-sub">Причина: ' + esc(r.reason || '—') + '</div></div>' +
          '<div class="row-right num num-md">' + Calc.money(r.amount) + '</div>' +
          '<span class="chev">›</span></div>';
      }).join('') + '</div>';
    } else {
      html += '<div class="empty"><div class="empty-icon">📉</div>' +
        '<div class="empty-title">Журнал пуст</div>' +
        '<div class="empty-text">Записывай каждое обращение, которое не стало заказом. Через месяц увидишь, где именно теряешь деньги.</div></div>';
    }

    viewEl.innerHTML = html;
    viewEl.querySelectorAll('[data-ref]').forEach(function (b) {
      b.addEventListener('click', function () { refusalSheet(b.dataset.ref); });
    });
    setMain('+ Добавить отказ', function () { refusalSheet(null); });
  }

  function refusalSheet(id) {
    var isNew = !id;
    var r = isNew
      ? { title: '', client: '', amount: '', date: today(), channel: 'Instagram', stage: Store.STAGES[1], reason: Store.REASONS[0], comment: '' }
      : JSON.parse(JSON.stringify(Store.state.refusals.filter(function (x) { return x.id === id; })[0]));

    function opts(arr, cur) {
      return arr.map(function (v) {
        return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>';
      }).join('');
    }

    openSheet(isNew ? 'Несостоявшийся заказ' : (r.title || 'Отказ'),
      '<div class="field"><label class="label">Что просили</label>' +
      '<input class="input" id="rTitle" placeholder="Например, торт 3 кг" value="' + esc(r.title) + '"></div>' +
      '<div class="field-row"><div class="field"><label class="label">Сумма, ₽</label>' +
      '<input class="input num-input" id="rAmount" type="number" inputmode="decimal" value="' + r.amount + '"></div>' +
      '<div class="field"><label class="label">Дата</label>' +
      '<input class="input" id="rDate" type="date" value="' + esc(r.date) + '"></div></div>' +
      '<div class="field"><label class="label">Клиент</label>' +
      '<input class="input" id="rClient" value="' + esc(r.client || '') + '"></div>' +
      '<div class="field"><label class="label">Откуда пришёл</label><select class="input" id="rChannel">' + opts(Store.CHANNELS, r.channel) + '</select></div>' +
      '<div class="field"><label class="label">На каком этапе сорвалось</label><select class="input" id="rStage">' + opts(Store.STAGES, r.stage) + '</select></div>' +
      '<div class="field"><label class="label">Причина</label><select class="input" id="rReason">' + opts(Store.REASONS, r.reason) + '</select></div>' +
      '<div class="field"><label class="label">Комментарий</label>' +
      '<textarea class="input" id="rComment" rows="2">' + esc(r.comment || '') + '</textarea></div>' +
      '<div class="hint-text">Сумма — та, на которую заказ мог бы состояться. Без неё аналитика покажет количество, но не деньги.</div>' +
      '<div class="divider"></div><button class="btn-primary" id="rSave">Сохранить</button>' +
      (isNew ? '' : '<div style="height:8px"></div><button class="btn-ghost btn-danger" id="rDel">Удалить запись</button>'),
      function (root) {
        root.querySelector('#rSave').addEventListener('click', function () {
          var next = {
            id: r.id,
            title: root.querySelector('#rTitle').value.trim(),
            client: root.querySelector('#rClient').value.trim(),
            amount: Number(root.querySelector('#rAmount').value) || 0,
            date: root.querySelector('#rDate').value,
            channel: root.querySelector('#rChannel').value,
            stage: root.querySelector('#rStage').value,
            reason: root.querySelector('#rReason').value,
            comment: root.querySelector('#rComment').value.trim()
          };
          if (!next.title) { toast('Впиши, что просили'); return; }
          Store.upsertRefusal(next); closeSheet(); render(); toast('Записано');
        });
        var d = root.querySelector('#rDel');
        if (d) d.addEventListener('click', function () { Store.removeRefusal(r.id); closeSheet(); render(); });
      });
  }

  /* ============================================================
     ЭКРАН: НАСТРОЙКИ
     ============================================================ */
  function viewSettings() {
    titleEl.textContent = 'Данные и настройки';
    var s = Store.state;
    viewEl.innerHTML =
      '<div class="section-title">По умолчанию</div>' +
      '<div class="field"><label class="label">Ставка за час, ₽</label>' +
      '<input class="input num-input" id="setRate" type="number" value="' + s.settings.rate + '"></div>' +
      '<div class="field"><label class="label">Целевая маржа, %</label>' +
      '<input class="input num-input" id="setMargin" type="number" value="' + s.settings.margin + '"></div>' +
      '<div class="hint-text">Подставляются в каждый новый расчёт. В самом рецепте их можно переопределить.</div>' +
      '<div class="divider"></div>' +
      '<div class="section-title">Данные</div>' +
      '<div class="hint-text">Всё хранится только в этом браузере. Очистка истории сайта удалит записи безвозвратно — выгружай копию.</div>' +
      '<div style="height:10px"></div>' +
      '<button class="btn-ghost" id="btnExport">Выгрузить копию (JSON)</button>' +
      '<div style="height:8px"></div><button class="btn-ghost" id="btnDemo">Вернуть демо-данные</button>' +
      '<div style="height:8px"></div><button class="btn-ghost btn-danger" id="btnClear">Удалить всё и начать с нуля</button>' +
      '<div class="divider"></div>' +
      '<div class="hint-text">Рецептов: ' + s.recipes.length + ' · ингредиентов: ' + s.ingredients.length +
      ' · заказов: ' + Store.orders().length + ' (в архиве ' + Store.archived().length + ')' +
      ' · отказов: ' + s.refusals.length + '<br>Версия прототипа 0.3</div>';

    document.getElementById('setRate').addEventListener('change', function () {
      Store.setSetting('rate', Number(this.value) || 0); toast('Сохранено');
    });
    document.getElementById('setMargin').addEventListener('change', function () {
      Store.setSetting('margin', Number(this.value) || 0); toast('Сохранено');
    });
    document.getElementById('btnExport').addEventListener('click', exportSheet);
    document.getElementById('btnDemo').addEventListener('click', function () {
      askConfirm('Вернуть демо-данные?', 'Текущие рецепты, заказы и отказы будут заменены примерами.',
        'Заменить', function () { Store.reset(); render(); toast('Демо-данные загружены'); });
    });
    document.getElementById('btnClear').addEventListener('click', function () {
      askConfirm('Удалить всё?', 'Все рецепты, ингредиенты, заказы и отказы будут стёрты. Вернуть их будет нельзя.',
        'Удалить всё', function () { Store.clearAll(); render(); toast('Очищено'); });
    });
    setMain('', null);
  }

  function exportSheet() {
    var json = Store.exportJSON();
    openSheet('Копия данных',
      '<p class="hint-text" style="margin-top:0">Скопируй текст и сохрани в заметки или файл. Чтобы восстановить — вставь обратно.</p>' +
      '<textarea class="input" id="exText" readonly rows="8"></textarea>' +
      '<div style="height:10px"></div><button class="btn-primary" id="exCopy">Скопировать</button>' +
      '<div style="height:8px"></div><button class="btn-ghost" id="exFile">Сохранить файлом</button>' +
      '<div style="height:8px"></div><button class="btn-ghost" id="exImport">Восстановить из копии</button>',
      function (root) {
        root.querySelector('#exText').value = json;
        root.querySelector('#exCopy').addEventListener('click', function () {
          var ta = root.querySelector('#exText');
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(json).then(function () { toast('Скопировано'); },
              function () { ta.select(); toast('Выдели текст и скопируй вручную'); });
          } else { ta.select(); toast('Выдели текст и скопируй вручную'); }
        });
        root.querySelector('#exFile').addEventListener('click', function () {
          try {
            var blob = new Blob([json], { type: 'application/json' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'sebes-' + today() + '.json';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
          } catch (e) { toast('Сохранение файлом здесь недоступно, скопируй текст'); }
        });
        root.querySelector('#exImport').addEventListener('click', function () { importSheet(); });
      });
  }

  function importSheet() {
    openSheet('Восстановить из копии',
      '<p class="hint-text" style="margin-top:0">Вставь ранее сохранённый текст. Текущие данные будут заменены.</p>' +
      '<textarea class="input" id="imText" rows="8" placeholder=\'{"version":1, ...}\'></textarea>' +
      '<div class="divider"></div><button class="btn-primary" id="imGo">Восстановить</button>',
      function (root) {
        root.querySelector('#imGo').addEventListener('click', function () {
          var raw = root.querySelector('#imText').value.trim();
          if (!raw) { toast('Вставь текст копии'); return; }
          try {
            var data = JSON.parse(raw);
            if (!data || data.version !== 1 || !Array.isArray(data.recipes)) throw new Error('bad');
            localStorage.setItem('sebes.v1', JSON.stringify(data));
            location.reload();
          } catch (e) { toast('Это не похоже на копию данных'); }
        });
      });
  }

  /* ============================================================
     РОУТЕР
     ============================================================ */
  var SCREENS = {
    recipes: viewRecipes,
    recipe: viewRecipe,
    ingredients: viewIngredients,
    orders: viewOrders,
    analytics: viewAnalytics,
    refusals: viewRefusals,
    archive: viewArchive,
    settings: viewSettings
  };
  var TAB_OF = { recipes: 'recipes', recipe: 'recipes', ingredients: 'ingredients',
                 orders: 'orders', archive: 'orders',
                 analytics: 'analytics', refusals: 'analytics', settings: 'analytics' };

  function render() {
    var cur = current();
    backBtn.hidden = stack.length <= 1;
    if (tg) { if (stack.length > 1) tg.BackButton.show(); else tg.BackButton.hide(); }
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.tab === TAB_OF[cur.name]);
    });
    window.scrollTo(0, 0);
    (SCREENS[cur.name] || viewRecipes)(cur.params || {});
  }

  /* ---------------- старт ---------------- */
  applyTheme(Store.state.settings.theme || 'auto');

  if (tg) {
    document.body.classList.add('tg');
    try {
      tg.ready(); tg.expand();
      tg.BackButton.onClick(back);
      if (tg.colorScheme) applyTheme(tg.colorScheme);
    } catch (e) {}
  }

  render();
  window.__app = { go: go, render: render, Store: Store, Calc: Calc, effectiveTheme: effectiveTheme };
})();
