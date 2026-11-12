/* ============================================================
   app.js — экраны и навигация.
   Деньги не считает: всё берёт из Calc через Store.computeRecipe.
   ============================================================ */
(function () {
  'use strict';

  /* Telegram подключается, только если приложение реально открыто внутри него.
     В обычном браузере SDK тоже создаёт window.Telegram.WebApp (с пустым initData),
     поэтому проверять сам объект нельзя — смотрим на параметры запуска. */
  var tg = null;

  function launchedFromTelegram() {
    try {
      if (/tgWebApp(Data|Platform|Version)=/.test(location.hash)) return true;
      if (sessionStorage.getItem('__telegram__initParams')) return true;
    } catch (e) {}
    return !!window.TelegramWebviewProxy;
  }

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

  var stack = [{ name: 'home' }];
  var filters = { recipes: 'Все', ingredients: 'Все', orders: 'Все' };
  var search = { recipes: '', ingredients: '' };
  var draft = null;          // редактируемый рецепт
  var mainAction = null;
  var scrollToList = false;          // с главной «Все заказы» ведёт сразу к списку под календарём
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
  /* Пока висит предупреждение об ошибке сохранения, сообщения
     вроде «Сохранено» не показываются: иначе они бы врали. */
  var toastLockUntil = 0;
  function toast(msg, opts) {
    var o = opts || {};
    if (!o.force && Date.now() < toastLockUntil) return;
    toastEl.textContent = msg; toastEl.hidden = false;
    toastEl.classList.toggle('toast-error', !!o.error);
    clearTimeout(toast._t);
    var ms = o.ms || 1600;
    toastEl.classList.toggle('toast-top', !sheet.hidden);
    if (o.lock) toastLockUntil = Date.now() + ms;
    toast._t = setTimeout(function () { toastEl.hidden = true; }, ms);
  }
  Store.onSaveError = function () {
    toast('Не сохранилось: в браузере закончилось место. Выгрузи копию в настройках.',
      { force: true, lock: true, error: true, ms: 6000 });
  };
  function haptic(type) {
    if (tg && tg.HapticFeedback) {
      try { tg.HapticFeedback.impactOccurred(type || 'light'); } catch (e) {}
    }
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length !== 3) return esc(iso);
    var m = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return Number(p[2]) + ' ' + m[Number(p[1]) - 1] + ' ' + p[0];
  }
  function today() { return Calc.localISO(); }
  function nonneg(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0; }
  function plural(n, a, b, c) { return Calc.plural(n, a, b, c); }

  /* subOff — подпись для выключенного состояния; меняется сама при переключении */
  function switchRow(id, title, sub, checked, subOff) {
    var off = subOff == null ? sub : subOff;
    var cur = checked ? sub : off;
    return '<label class="switch-row" for="' + id + '">' +
      '<span class="sw-main"><span class="sw-title">' + esc(title) + '</span>' +
      (cur || off ? '<span class="sw-sub" data-on="' + esc(sub || '') + '" data-off="' + esc(off || '') + '">' +
        esc(cur || '') + '</span>' : '') + '</span>' +
      '<span class="switch"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '>' +
      '<span class="switch-track"></span></span></label>';
  }
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || t.type !== 'checkbox' || !t.closest) return;
    var row = t.closest('.switch-row');
    var sub = row && row.querySelector('.sw-sub');
    if (sub && sub.dataset) sub.textContent = t.checked ? sub.dataset.on : sub.dataset.off;
  });

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
    /* 4,5 — четыре звезды, а не пять: число рядом показывает точное значение */
    var v = Math.round((Number(value) || 0) - 0.01);
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
  function current() { return stack[stack.length - 1]; }
  function go(name, params) { stack.push({ name: name, params: params || {} }); render(); }

  /* Уход с экрана рецепта: если есть несохранённые правки — спросить */
  function draftDirty() {
    if (!draft || current().name !== 'recipe') return false;
    return draftSnapshot(draft) !== draft.__orig;
  }
  function leaveRecipe(proceed) {
    if (!draftDirty()) { draft = null; proceed(); return; }
    openSheet('Сохранить изменения?',
      '<p class="hint-text" style="margin-top:0">В рецепте «' + esc(draft.name || 'без названия') +
      '» есть несохранённые изменения.</p><div class="divider"></div>' +
      '<button class="btn-primary" id="lvSave">Сохранить</button>' +
      '<div style="height:8px"></div><button class="btn-ghost btn-danger" id="lvDrop">Не сохранять</button>' +
      '<div style="height:8px"></div><button class="btn-ghost" id="lvStay">Остаться</button>',
      function (root) {
        root.querySelector('#lvSave').addEventListener('click', function () {
          closeSheet();
          if (saveDraft()) proceed();
        });
        root.querySelector('#lvDrop').addEventListener('click', function () { closeSheet(); draft = null; proceed(); });
        root.querySelector('#lvStay').addEventListener('click', closeSheet);
      });
  }

  function back() {
    if (!sheet.hidden) { closeSheet(); return; }
    if (stack.length <= 1) return;
    var doBack = function () { stack.pop(); render(); };
    if (current().name === 'recipe') leaveRecipe(doBack); else doBack();
  }
  function switchTab(name) {
    if (!sheet.hidden) closeSheet();
    var doSwitch = function () { stack = [{ name: name, params: {} }]; render(); };
    if (current().name === 'recipe') leaveRecipe(doSwitch); else doSwitch();
  }

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
    if (Store.state.settings.theme !== t) Store.setSetting('theme', t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', effectiveTheme() === 'dark' ? '#17120F' : '#FDF9F7');
  }
  themeBtn.addEventListener('click', function () {
    haptic();
    applyTheme(effectiveTheme() === 'dark' ? 'light' : 'dark');
  });

  /* ---------------- главная кнопка ---------------- */
  var mainText = '';
  function setMain(text, fn) {
    mainAction = fn;
    mainText = text || '';
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
  /* Пока открыта шторка, главная кнопка не действует: у шторки свои кнопки */
  function runMain() { if (sheet.hidden && mainAction) mainAction(); }
  mainBtn.addEventListener('click', function () { haptic('medium'); runMain(); });


  /* ---------------- шторка ---------------- */
  function openSheet(title, bodyHtml, onMount) {
    sheetBody.innerHTML = '<div class="sheet-handle"></div><h2 class="sheet-title">' + esc(title) + '</h2>' + bodyHtml;
    sheet.hidden = false;
    sheetBody.scrollTop = 0;
    if (tg) { try { tg.MainButton.hide(); tg.BackButton.show(); } catch (e) {} }
    if (onMount) onMount(sheetBody);
  }
  function closeSheet() {
    sheet.hidden = true;
    sheetBody.innerHTML = '';
    sheetBody.scrollTop = 0;
    if (tg) {
      try {
        if (mainText) tg.MainButton.show();
        if (stack.length > 1) tg.BackButton.show(); else tg.BackButton.hide();
      } catch (e) {}
    }
  }

  /* Своё подтверждение: нативный confirm() в части окружений просто не показывается */
  function askConfirm(title, text, label, onYes, neutral) {
    openSheet(title,
      '<p class="hint-text" style="margin-top:0">' + esc(text) + '</p>' +
      '<div class="divider"></div>' +
      '<button class="btn-primary' + (neutral ? '' : ' btn-destructive') + '" id="cYes">' + esc(label) + '</button>' +
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
    { key: 'labor',       label: 'Твой труд', color: 'var(--c-lab)' },
    { key: 'overhead',    label: 'Накладные', color: 'var(--c-ovh)' },
    { key: 'tax',         label: 'Налог',     color: 'var(--c-tax)' },
    { key: 'profit',      label: 'Сверх ставки', color: 'var(--c-prof)' }
  ];

  function legend(items) {
    return '<div class="legend">' + items.map(function (s2) {
      return '<span class="legend-item"><span class="legend-swatch" style="background:' + s2.color + '"></span>' +
        esc(s2.label) + '</span>';
    }).join('') + '</div>';
  }

  function svgOpen(W, H, label) {
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" preserveAspectRatio="xMidYMid meet" ' +
      'style="max-width:' + W + 'px;height:auto" role="img" aria-label="' + esc(label) + '">';
  }

  function niceTop(max) {
    if (max <= 0) return 1;
    var step = Math.pow(10, Math.floor(Math.log10(max)));
    var t = Math.ceil(max / step) * step;
    if (t / step <= 2) t = Math.ceil(max / (step / 2)) * (step / 2);
    return t;
  }

  function kLabel(v) {
    if (v >= 1000000) return (Math.round(v / 100000) / 10).toString().replace('.', ',') + 'м';
    if (v >= 1000) return Math.round(v / 1000) + 'к';
    return String(Math.round(v));
  }

  /* Столбец на месяц: слои снизу вверх — продукты, труд, накладные, налог, сверх ставки.
     Ширина делится между месяцами поровну, график тянется по ширине карточки. */
  function moneyChart(rows) {
    if (!rows.length) return '';
    var W = 520, padL = 40, padR = 8, padT = 20, padB = 26, plotH = 180;
    var H = padT + plotH + padB;
    var slot = (W - padL - padR) / rows.length;
    var barW = Math.min(56, slot * 0.62);
    var max = 0;
    rows.forEach(function (r) { max = Math.max(max, r.revenue, r.cost + r.tax); });
    var top = niceTop(max);
    var y = function (v) { return padT + plotH - (v / top) * plotH; };

    var svg = svgOpen(W, H, 'Выручка и расходы по месяцам');
    [0, 0.5, 1].forEach(function (f) {
      var v = top * f, yy = y(v);
      svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + yy + '" y2="' + yy + '" stroke="var(--grid)" stroke-width="1"/>';
      svg += '<text x="' + (padL - 7) + '" y="' + (yy + 4) + '" text-anchor="end" font-size="11" fill="var(--hint)" font-family="var(--mono)">' + kLabel(v) + '</text>';
    });

    rows.forEach(function (r, i) {
      var x = padL + i * slot + (slot - barW) / 2;
      var total = Math.max(r.revenue, r.cost + r.tax);
      var barTop = y(total);
      var clip = 'mclip' + i;
      svg += '<clipPath id="' + clip + '"><rect x="' + x + '" y="' + barTop + '" width="' + barW +
        '" height="' + (padT + plotH - barTop) + '" rx="4"/></clipPath><g clip-path="url(#' + clip + ')">';
      var parts = [
        { v: r.ingredients, c: 'var(--c-ing)' }, { v: r.labor, c: 'var(--c-lab)' },
        { v: r.overhead, c: 'var(--c-ovh)' }, { v: r.tax, c: 'var(--c-tax)' }
      ];
      if (r.profit > 0) parts.push({ v: r.profit, c: 'var(--c-prof)' });
      parts = parts.filter(function (p) { return p.v > 0; });
      var acc = 0;
      parts.forEach(function (p, idx) {
        var hh = (p.v / top) * plotH;
        var gap = idx < parts.length - 1 ? 2 : 0;
        svg += '<rect x="' + x + '" y="' + (padT + plotH - acc - hh + gap) + '" width="' + barW +
          '" height="' + Math.max(1, hh - gap) + '" fill="' + p.c + '"/>';
        acc += hh;
      });
      svg += '</g>';
      if (r.profit < 0) {
        svg += '<line x1="' + (x - 4) + '" x2="' + (x + barW + 4) + '" y1="' + y(r.revenue) + '" y2="' + y(r.revenue) +
          '" stroke="var(--text)" stroke-width="2" stroke-dasharray="4 3"/>';
      }
      svg += '<text x="' + (x + barW / 2) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="12" fill="var(--hint)">' + esc(r.label) + '</text>';
      svg += '<text x="' + (x + barW / 2) + '" y="' + (barTop - 6) + '" text-anchor="middle" font-size="11" fill="var(--text)" font-family="var(--mono)">' + kLabel(r.revenue) + '</text>';
    });
    svg += '</svg>';
    return '<div class="chart-wrap">' + svg + '</div>' + legend(SERIES) +
      '<div class="hint-text">Высота столбца — выручка. Пунктир — месяц, где расходы выше выручки.</div>';
  }

  function conversionChart(rows) {
    if (rows.length < 2) return '';
    var W = 520, padL = 42, padR = 24, padT = 14, padB = 28, plotH = 120;
    var H = padT + plotH + padB;
    var usable = W - padL - padR;
    var x = function (i) { return padL + (i / (rows.length - 1)) * usable; };
    var y = function (v) { return padT + plotH - (v / 100) * plotH; };
    var svg = svgOpen(W, H, 'Конверсия в заказ по месяцам');
    [0, 50, 100].forEach(function (v) {
      svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--grid)" stroke-width="1"/>' +
        '<text x="' + (padL - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end" font-size="11" fill="var(--hint)" font-family="var(--mono)">' + v + '%</text>';
    });
    var d = rows.map(function (r, i) { return (i ? 'L' : 'M') + x(i) + ' ' + y(r.conversion); }).join(' ');
    svg += '<path d="' + d + '" fill="none" stroke="var(--c-prof)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    rows.forEach(function (r, i) {
      var anchor = i === 0 ? 'start' : (i === rows.length - 1 ? 'end' : 'middle');
      svg += '<circle cx="' + x(i) + '" cy="' + y(r.conversion) + '" r="4.5" fill="var(--c-prof)" stroke="var(--bg)" stroke-width="2"/>';
      svg += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="' + anchor + '" font-size="12" fill="var(--hint)">' + esc(r.label) + '</text>';
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

    var html = '';
    html += '<div class="search"><span class="muted">🔍</span><input id="qRecipes" placeholder="Поиск рецептов" value="' + esc(search.recipes) + '"></div>';
    html += '<div class="chips">' + cats.map(function (c) {
      return '<button class="chip' + (filters.recipes === c ? ' active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('') + '</div>';

    if (draft && !draft.id && draft.__for === 'new' && draftSnapshot(draft) !== draft.__orig) {
      html += '<div class="card" style="margin-bottom:10px"><div class="row" id="resumeDraft">' +
        '<div class="thumb">✎</div><div class="row-main"><div class="row-title">Незаконченный расчёт' +
        (draft.name ? ': ' + esc(draft.name) : '') + '</div><div class="row-sub">Не сохранён. Нажми, чтобы продолжить</div></div>' +
        '<span class="chev">›</span></div></div>';
    }

    if (!list.length) {
      html += s.recipes.length
        ? '<div class="empty"><div class="empty-title">Ничего не найдено</div><div class="empty-text">Попробуй другой запрос или категорию.</div></div>'
        : emptyState('🎂', 'Пока ни одного рецепта',
            'Нажми «Новый расчёт» и добавь продукты прямо в рецепт — как в чеке, за пачку или десяток. Приложение само посчитает себестоимость и цену.');
    } else {
      html += '<div class="card">' + list.map(function (r) {
        var c = Store.computeRecipe(r);
        return '<div class="row" data-open="' + esc(r.id) + '">' +
          '<div class="thumb">' + esc(r.name.charAt(0)) + '</div>' +
          '<div class="row-main"><div class="row-title clamp2">' + esc(r.name) + '</div>' +
          '<div class="row-sub">себестоимость <span class="num">' + Calc.money(c.cost) + '</span></div></div>' +
          '<div class="row-right"><div class="num num-md">' + Calc.money(c.price) + '</div>' +
          '<div class="row-sub">цена за ' + num(r.yieldAmount) + ' ' + esc(r.yieldUnit) + '</div></div>' +
          '<span class="chev">›</span></div>';
      }).join('') + '</div>';
    }

    html += '<div style="height:12px"></div><div class="card"><div class="row" id="toProducts"><div class="row-main">' +
      '<div class="row-title">Продукты и цены</div><div class="row-sub">Цена меняется в одном месте и сразу во всех рецептах</div></div>' +
      '<span class="chev">›</span></div></div>';

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
      b.addEventListener('click', function () { haptic(); draft = null; go('recipe', { id: b.dataset.open }); });
    });
    var resume = document.getElementById('resumeDraft');
    if (resume) resume.addEventListener('click', function () { go('recipe', { id: null }); });
    document.getElementById('toProducts').addEventListener('click', function () { go('ingredients'); });

    setMain('+ Новый расчёт', function () {
      if (draft && draft.__for !== 'new') draft = null;
      go('recipe', { id: null });
    });
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

  function draftSnapshot(d) {
    return JSON.stringify(d, function (k, v) { return k.indexOf('__') === 0 ? undefined : v; });
  }

  function moneyUnit(ing) {
    var up = Calc.unitPrice(ing);
    return (up.value < 100 ? Calc.moneyPrecise(up.value) : Calc.money(up.value)) + '/' + up.unit;
  }

  /* Итоговый блок рецепта: пересчитывается сам, без перерисовки всего экрана,
     чтобы поле, в котором печатают, не теряло фокус. */
  function totalsHtml(c) {
    var html = '<div class="total-card">' +
      '<div class="total-row"><span>Продукты + работа</span><span class="num">' + Calc.money(c.base) + '</span></div>' +
      '<div class="total-row"><span>Накладные ' + num(c.overheadPercent) + '%</span><span class="num">' + Calc.money(c.overhead) + '</span></div>' +
      '<div class="total-row main"><span>Себестоимость</span><span class="num">' + Calc.money(c.cost) + '</span></div>' +
      '<div class="total-row main"><span>Цена для клиента</span><span class="num">' + Calc.money(c.price) + '</span></div>' +
      (c.tax ? '<div class="total-row"><span>из неё налог ' + num(c.taxRate) + '%</span><span class="num">' + Calc.money(c.tax) + '</span></div>' : '') +
      '<div class="total-row"><span>Ты получишь: работа + сверху</span><span class="num">' + Calc.money(c.labor + c.profit) + '</span></div>' +
      '</div>';
    html += '<div class="hint-text" style="margin:-4px 2px 10px">Маржа ' + Calc.pct(c.marginFact, 0) +
      ' — это наценка ' + Calc.pct(c.markup, 0) + ': цена до налога = себестоимость × ' +
      num(c.cost ? c.priceNet / c.cost : 0) + '.</div>';

    var y = Number(draft.yieldAmount) || 0;
    if (y > 0) {
      html += '<div class="spread" style="padding:2px 2px 8px"><span class="hint-text">За 1 ' + esc(draft.yieldUnit) + '</span>' +
        '<span class="num num-md">' + Calc.money(c.cost / y) + ' себес · ' + Calc.money(c.price / y) + ' цена</span></div>';
    }
    var yg = Calc.yieldGrams(y, draft.yieldUnit);
    if (yg > 0) {
      var mass = Store.recipeMass(draft);
      var loss = Calc.bakeLoss(mass.grams, yg);
      var note = mass.unknown.length ? ' Без учёта: ' + esc(mass.unknown.join(', ')) + ' — укажи массу 1 шт в справочнике.' : '';
      if (loss && loss.impossible && draft.items.length >= 3) {
        html += '<div class="warn-box">Продукты весят ' + Math.round(mass.grams) + ' г, а готовое изделие ' + Math.round(yg) +
          ' г. Так не бывает: в духовке масса уходит. Взвесь готовое изделие и впиши его вес.' + note + '</div>';
      } else if (loss) {
        if (!loss.impossible) html += '<div class="hint-text" style="padding:0 2px 8px">Продукты весят ' + Math.round(mass.grams) + ' г → готовое ' +
          Math.round(yg) + ' г, упёк и потери ' + Calc.pct(loss.percent) + '.' + note + '</div>';
      }
    }
    return html;
  }

  function updateTotals() {
    var box = document.getElementById('totalsBox');
    if (box && draft) box.innerHTML = totalsHtml(Store.computeRecipe(draft));
  }

  /* Сохранение черновика с проверками. Возвращает true, если сохранено. */
  function saveDraft() {
    if (!draft) return false;
    if (!draft.name.trim()) { toast('Впиши название рецепта'); return false; }
    if (!draft.items.length) { toast('Добавь хотя бы один ингредиент'); return false; }
    if (!(Number(draft.yieldAmount) > 0)) { toast('Укажи выход: вес или количество готового изделия'); return false; }
    var c = Store.computeRecipe(draft);
    if (c.problems.length) { toast('У некоторых продуктов не совпадают единицы — они отмечены красным'); return false; }
    draft.margin = Math.min(95, Math.max(0, Number(draft.margin) || 0));
    var copy = JSON.parse(draftSnapshot(draft));
    Store.upsertRecipe(copy);
    draft = null;
    toast('Рецепт сохранён');
    return true;
  }

  function viewRecipe(params) {
    titleEl.textContent = 'Расчёт себестоимости';
    if (!draft || draft.__for !== (params.id || 'new')) {
      var src = params.id ? Store.getRecipe(params.id) : null;
      if (params.id && !src) { stack.pop(); render(); return; }
      draft = src ? JSON.parse(JSON.stringify(src)) : blankRecipe();
      draft.__for = params.id || 'new';
      draft.__orig = draftSnapshot(draft);
    }
    var c = Store.computeRecipe(draft);
    var byId = Store.ingredientsById();
    var byMass = draft.yieldUnit === 'кг' || draft.yieldUnit === 'г';

    var html = '';
    html += '<div class="field"><label class="label" for="fName">Название рецепта</label>' +
      '<input class="input" id="fName" placeholder="Например, Красный бархат" value="' + esc(draft.name) + '"></div>';

    var yUnits = Store.YIELD_UNITS.map(function (u) {
      return '<option value="' + esc(u) + '"' + (u === draft.yieldUnit ? ' selected' : '') + '>' + esc(u) + '</option>';
    }).join('');
    html += '<div class="field-row"><div class="field"><label class="label" for="fYield">' +
      (byMass ? 'Вес готового изделия' : 'Сколько получается') + '</label>' +
      '<input class="input num-input" id="fYield" type="number" inputmode="decimal" min="0" step="0.1" value="' + esc(draft.yieldAmount) + '"></div>' +
      '<div class="field narrow"><label class="label" for="fYieldUnit">Ед.</label><select class="input" id="fYieldUnit">' + yUnits + '</select></div></div>';
    html += '<div class="hint-text" style="margin-top:-6px;margin-bottom:14px">' +
      (byMass ? 'Взвесь готовый торт один раз. По весу считается упёк, а заказ на другой вес пересчитается сам.'
              : 'Сколько штук или порций выходит из этой закладки. Заказ на другое количество пересчитается сам.') + '</div>';

    /* Ингредиенты */
    html += '<div class="spread section-title"><span>Продукты</span><button class="btn-link" id="addItem">+ Добавить</button></div>';
    if (!draft.items.length) {
      html += '<div class="card"><div class="row" style="cursor:default"><div class="row-main hint-text">Пока пусто. Добавь первый продукт.</div></div></div>';
    } else {
      html += '<div class="card">' + draft.items.map(function (it, i) {
        var ing = byId[it.ingredientId];
        var cost = Calc.lineCost(it, ing);
        var bad = ing && !Calc.unitsMatch(it, ing);
        return '<div class="row' + (bad || !ing ? ' row-bad' : '') + '" data-item="' + i + '">' +
          '<div class="row-main"><div class="row-title">' + esc(ing ? ing.name : 'Удалённый продукт') +
          (it.fixed ? '<span class="tag-decor">на любой вес</span>' : '') + '</div>' +
          '<div class="row-sub num">' + esc(num(it.qty)) + ' ' + esc(it.unit) +
          (ing && !bad ? ' × ' + moneyUnit(ing) : '') + '</div>' +
          (bad ? '<div class="row-sub neg">Продаётся в «' + esc(ing.unit) + '», а в рецепте «' + esc(it.unit) + '». Исправь количество.</div>' : '') +
          (!ing ? '<div class="row-sub neg">Продукт удалён из справочника. Убери или замени.</div>' : '') +
          '</div><div class="row-right num num-md">' + Calc.money(cost) + '</div>' +
          '<span class="chev">›</span></div>';
      }).join('') + '</div>';
    }
    html += '<div class="spread" style="padding:8px 2px"><span class="hint-text">Продукты итого</span>' +
      '<span class="num num-md">' + Calc.money(c.ingredients) + '</span></div>';

    /* Работа */
    html += '<div class="spread section-title"><span>Работа</span><button class="btn-link" id="addLabor">+ Добавить</button></div>';
    html += '<div class="card">' + draft.labor.map(function (l, i) {
      var r = Calc.stageRate(l, draft.rate, draft.splitRates);
      return '<div class="row" data-labor="' + i + '">' +
        '<div class="row-main"><div class="row-title">' + esc(l.name) +
        (l.fixed ? '<span class="tag-decor">на любой вес</span>' : '') + '</div>' +
        (draft.splitRates ? '<div class="row-sub num">' + Calc.money(r) + '/ч</div>' : '') + '</div>' +
        '<div class="row-right"><div class="num num-md muted">' + Calc.duration(l.minutes) + '</div>' +
        (draft.splitRates ? '<div class="row-sub num">' + Calc.money(l.minutes / 60 * r) + '</div>' : '') + '</div>' +
        '<span class="chev">›</span></div>';
    }).join('') +
      (draft.splitRates ? '' :
        '<div class="row" id="editRate"><div class="row-main"><div class="row-title">Цена твоего часа</div>' +
        '<div class="row-sub">' + Calc.duration(c.laborMinutes) + ' работы</div></div>' +
        '<div class="row-right num num-md">' + Calc.money(draft.rate) + '/ч</div><span class="chev">›</span></div>') +
      '</div>';
    html += '<div style="height:8px"></div>' +
      switchRow('swSplit', 'Разная цена часа по этапам', 'У каждого этапа своя цена часа', draft.splitRates,
        'Все этапы по одной цене часа');
    html += '<div class="spread" style="padding:8px 2px"><span class="hint-text">Работа итого</span>' +
      '<span class="num num-md">' + Calc.money(c.labor) + '</span></div>';

    /* Накладные */
    html += '<div class="spread section-title"><span>Накладные</span><button class="btn-link" id="addOh">+ Добавить</button></div>';
    var ohHidden = c.overheadRows.filter(function (o) { return o.percent <= 0; }).length;
    html += '<div class="card">' + c.overheadRows.map(function (o, i) {
      if (o.percent <= 0 && !draft.__showAllOh) return '';
      return '<div class="row" data-oh="' + i + '">' +
        '<div class="row-main"><div class="row-title">' + esc(o.name) + '</div></div>' +
        '<div class="row-right"><span class="num muted">' + num(o.percent) + '%</span> ' +
        '<span class="num num-md" style="margin-left:10px">' + Calc.money(o.value) + '</span></div>' +
        '<span class="chev">›</span></div>';
    }).join('') +
      (ohHidden && !draft.__showAllOh
        ? '<div class="row" id="showAllOh"><div class="row-main hint-text">Показать статьи с 0% (' + ohHidden + ')</div><span class="chev">›</span></div>'
        : '') + '</div>';
    html += '<div class="hint-text" style="padding:8px 2px">Расходы, которых нет в составе: свет, износ техники, расходники. Процент от продуктов и работы.</div>';

    /* Итог */
    html += '<div id="totalsBox">' + totalsHtml(c) + '</div>';

    html += switchRow('swScaleLabor', 'Работа растёт вместе с объёмом',
      'Торт вдвое больше — работы вдвое больше', draft.scaleLabor !== false, 'Работа одинаковая при любом объёме');
    html += '<div style="height:14px"></div>';

    html += '<div class="field"><label class="label" for="fMargin">Маржа, %</label>' +
      '<input class="input num-input" id="fMargin" type="number" inputmode="decimal" min="0" max="95" value="' + esc(draft.margin) + '"></div>' +
      '<div class="hint-text" style="margin-top:-8px">Доля цены, которая остаётся сверх себестоимости. От 0 до 95%.</div>';

    if (draft.id) {
      html += '<div class="divider"></div><button class="btn-ghost btn-danger" id="delRecipe">Удалить рецепт</button>';
    }

    viewEl.innerHTML = html;

    document.getElementById('fName').addEventListener('input', function () { draft.name = this.value; });
    document.getElementById('fYield').addEventListener('input', function () {
      draft.yieldAmount = nonneg(this.value); updateTotals();
    });
    document.getElementById('fYieldUnit').addEventListener('change', function () {
      draft.yieldUnit = this.value; render();
    });
    document.getElementById('swSplit').addEventListener('change', function () {
      draft.splitRates = this.checked; render();
    });
    document.getElementById('swScaleLabor').addEventListener('change', function () {
      draft.scaleLabor = this.checked;
    });
    var showOh = document.getElementById('showAllOh');
    if (showOh) showOh.addEventListener('click', function () { draft.__showAllOh = true; render(); });
    var fm = document.getElementById('fMargin');
    fm.addEventListener('input', function () {
      draft.margin = Math.min(95, nonneg(this.value)); updateTotals();
    });
    fm.addEventListener('change', function () {
      if (this.value !== '' && Number(this.value) !== draft.margin) this.value = draft.margin;
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
      var used = Store.ordersUsingRecipe(draft.id);
      var active = used.filter(function (o) { return o.status !== 'done'; }).length;
      var text = 'Рецепт «' + draft.name + '» будет удалён без возможности вернуть.';
      if (used.length) {
        text += ' Он есть в ' + used.length + ' ' + plural(used.length, 'заказе', 'заказах', 'заказах') + '. ' +
          'Выданные заказы сохранят свою себестоимость' +
          (active ? ', а у ' + active + ' ' + plural(active, 'текущего', 'текущих', 'текущих') + ' расчёт себестоимости пропадёт.' : '.');
      }
      askConfirm('Удалить рецепт?', text, 'Удалить', function () {
        Store.removeRecipe(draft.id); draft = null; stack.pop(); render();
      });
    });

    setMain('Сохранить рецепт', function () {
      if (saveDraft()) { stack.pop(); render(); }
    });
  }

  /* --- шторки редактирования внутри расчёта --- */
  function defaultUnitFor(ing) {
    var base = ing ? Calc.BASE_UNIT[ing.unit] : 'г';
    return base || 'г';
  }

  function itemSheet(index, preselectId) {
    var isNew = index === null;
    var src = isNew ? null : draft.items[index];
    var firstIng = Store.state.ingredients[0];
    var it = src ? JSON.parse(JSON.stringify(src)) : { ingredientId: preselectId || (firstIng && firstIng.id), qty: '', unit: '' };
    if (preselectId) it.ingredientId = preselectId;
    var ingNow = Store.ingredientsById()[it.ingredientId];
    if (!it.unit || (ingNow && !Calc.unitsMatch(it, ingNow))) it.unit = defaultUnitFor(ingNow);

    var opts = Store.state.ingredients.map(function (i) {
      return '<option value="' + esc(i.id) + '"' + (i.id === it.ingredientId ? ' selected' : '') + '>' +
        esc(i.name) + ' — ' + moneyUnit(i) + '</option>';
    }).join('');
    var units = Store.UNITS.map(function (u) {
      return '<option value="' + u + '"' + (u === it.unit ? ' selected' : '') + '>' + u + '</option>';
    }).join('');

    openSheet(isNew ? 'Добавить продукт' : 'Продукт в рецепте',
      (Store.state.ingredients.length
        ? '<div class="field"><label class="label" for="sIng">Продукт</label><select class="input" id="sIng">' + opts + '</select></div>'
        : '<div class="hint-text" style="margin-bottom:12px">В справочнике пока нет продуктов.</div>') +
      '<div class="spread" style="margin:-6px 0 10px;gap:12px;flex-wrap:wrap">' +
      '<button class="btn-link" id="sNewIng">+ Новый продукт</button>' +
      (Store.state.ingredients.length ? '<button class="btn-link" id="sEditIng">Изменить цену продукта</button>' : '') + '</div>' +
      (Store.state.ingredients.length
        ? '<div class="field-row"><div class="field"><label class="label" for="sQty">Сколько кладёшь</label>' +
          '<input class="input num-input" id="sQty" type="number" inputmode="decimal" min="0" placeholder="0" value="' + esc(it.qty) + '"></div>' +
          '<div class="field narrow"><label class="label" for="sUnit">Ед.</label><select class="input" id="sUnit">' + units + '</select></div></div>' +
          '<div class="hint-text" id="sPreview"></div>' +
          '<div style="height:14px"></div>' +
          switchRow('sFixed', 'Не растёт с весом', 'Одинаково на любой вес: фигурка, топпер, коробка', !!it.fixed,
            'Растёт вместе с весом заказа') +
          '<div class="divider"></div>' +
          '<button class="btn-primary" id="sSave">Сохранить</button>' +
          (isNew ? '' : '<div style="height:8px"></div><button class="btn-ghost btn-danger" id="sDel">Убрать из рецепта</button>')
        : ''),
      function (root) {
        root.querySelector('#sNewIng').addEventListener('click', function () {
          ingredientSheet(null, function (saved) { itemSheet(index, saved.id); });
        });
        if (!Store.state.ingredients.length) return;
        root.querySelector('#sEditIng').addEventListener('click', function () {
          var keepQty = root.querySelector('#sQty').value, keepUnit = root.querySelector('#sUnit').value;
          var pid = root.querySelector('#sIng').value;
          ingredientSheet(pid, function () {
            render();                       // цена поменялась во всех строках рецепта
            itemSheet(index, pid);
            var u = sheetBody.querySelector('#sUnit'), q = sheetBody.querySelector('#sQty');
            if (u && keepUnit) { u.value = keepUnit; u.dispatchEvent(new Event('change')); }
            if (q && keepQty) { q.value = keepQty; q.dispatchEvent(new Event('input')); }
            toast('Цена обновлена во всех рецептах');
          });
        });
        var selIng = root.querySelector('#sIng'), selUnit = root.querySelector('#sUnit'), qty = root.querySelector('#sQty');
        function preview() {
          var ing = Store.ingredientsById()[selIng.value];
          var tmp = { ingredientId: ing && ing.id, qty: nonneg(qty.value), unit: selUnit.value };
          var box = root.querySelector('#sPreview');
          if (!ing) { box.textContent = ''; return; }
          if (!Calc.unitsMatch(tmp, ing)) {
            box.textContent = 'Этот продукт продаётся в «' + ing.unit + '» — выбери ' + Calc.BASE_UNIT[ing.unit] + ' или ' + ing.unit + '.';
            box.className = 'hint-text neg';
            return;
          }
          box.className = 'hint-text';
          box.textContent = 'Стоимость: ' + Calc.moneyPrecise(Calc.lineCost(tmp, ing)) + ' (продукт по ' + moneyUnit(ing).replace(/ /g, ' ') + ')';
        }
        selIng.addEventListener('change', function () {
          var ing = Store.ingredientsById()[this.value];
          if (ing && !Calc.unitsMatch({ unit: selUnit.value }, ing)) selUnit.value = defaultUnitFor(ing);
          preview();
        });
        qty.addEventListener('input', preview);
        selUnit.addEventListener('change', preview);
        preview();
        if (isNew) setTimeout(function () { try { qty.focus(); } catch (e) {} }, 50);
        root.querySelector('#sSave').addEventListener('click', function () {
          var next = {
            ingredientId: selIng.value,
            qty: nonneg(qty.value),
            unit: selUnit.value,
            fixed: root.querySelector('#sFixed').checked
          };
          var ing = Store.ingredientsById()[next.ingredientId];
          if (!next.qty) { toast('Впиши, сколько кладёшь'); return; }
          if (!Calc.unitsMatch(next, ing)) {
            toast('Продукт продаётся в «' + ing.unit + '» — выбери подходящую единицу'); return;
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
    var h = Math.floor((Number(l.minutes) || 0) / 60), m = (Number(l.minutes) || 0) % 60;
    openSheet('Этап работы',
      '<div class="field"><label class="label" for="lName">Что делаешь</label>' +
      '<input class="input" id="lName" placeholder="Например, декорирование" value="' + esc(l.name) + '"></div>' +
      '<div class="field-row"><div class="field"><label class="label" for="lH">Часов</label>' +
      '<input class="input num-input" id="lH" type="number" inputmode="numeric" min="0" value="' + h + '"></div>' +
      '<div class="field"><label class="label" for="lM">Минут</label>' +
      '<input class="input num-input" id="lM" type="number" inputmode="numeric" min="0" max="59" value="' + m + '"></div></div>' +
      (draft.splitRates
        ? '<div class="field"><label class="label" for="lRate">Цена часа на этом этапе, ₽</label>' +
          '<input class="input num-input" id="lRate" type="number" inputmode="numeric" min="0" placeholder="' + esc(draft.rate) + '" value="' +
          (l.rate == null ? '' : esc(l.rate)) + '"></div>' +
          '<div class="hint-text" style="margin-top:-8px;margin-bottom:14px">Пусто — по общей цене часа ' + Calc.money(draft.rate) + '/ч.</div>'
        : '') +
      switchRow('lFixed', 'Не растёт с весом', 'Одинаково на любой вес: упаковка, оформление надписи', !!l.fixed,
        'Растёт вместе с весом заказа') +
      '<div class="divider"></div>' +
      '<button class="btn-primary" id="lSave">Сохранить</button>' +
      (isNew ? '' : '<div style="height:8px"></div><button class="btn-ghost btn-danger" id="lDel">Удалить этап</button>'),
      function (root) {
        root.querySelector('#lSave').addEventListener('click', function () {
          var next = {
            name: root.querySelector('#lName').value.trim() || 'Работа',
            minutes: Math.round(nonneg(root.querySelector('#lH').value) * 60 + nonneg(root.querySelector('#lM').value)),
            fixed: root.querySelector('#lFixed').checked
          };
          var rateEl = root.querySelector('#lRate');
          if (rateEl) { var rv = rateEl.value.trim(); next.rate = rv === '' ? null : nonneg(rv); }
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
      '<div class="field"><label class="label" for="oName">Статья</label>' +
      '<input class="input" id="oName" placeholder="Например, брак и списания" value="' + esc(o.name) + '"></div>' +
      '<div class="field"><label class="label" for="oPct">Процент от продуктов и работы</label>' +
      '<input class="input num-input" id="oPct" type="number" inputmode="decimal" min="0" max="100" step="0.5" value="' + esc(o.percent) + '"></div>' +
      '<div class="hint-text">Всё, что не попало в состав: свет, износ духовки и миксера, брак, расходники.</div>' +
      '<div class="divider"></div><button class="btn-primary" id="oSave">Сохранить</button>' +
      (isNew ? '' : '<div style="height:8px"></div><button class="btn-ghost btn-danger" id="oDel">Удалить статью</button>'),
      function (root) {
        root.querySelector('#oSave').addEventListener('click', function () {
          var next = { name: root.querySelector('#oName').value.trim() || 'Прочее',
                       percent: Math.min(100, nonneg(root.querySelector('#oPct').value)) };
          if (isNew) draft.overheads.push(next); else draft.overheads[index] = next;
          closeSheet(); render();
        });
        var d = root.querySelector('#oDel');
        if (d) d.addEventListener('click', function () { draft.overheads.splice(index, 1); closeSheet(); render(); });
      });
  }

  function rateSheet() {
    openSheet('Цена твоего часа',
      '<div class="field"><label class="label" for="rVal">Сколько стоит час твоей работы, ₽</label>' +
      '<input class="input num-input" id="rVal" type="number" inputmode="numeric" min="0" value="' + esc(draft.rate) + '"></div>' +
      '<div class="hint-text">Возьми, сколько хочешь зарабатывать в месяц, и раздели на рабочие часы. ' +
      'Меняет цену часа только в этом рецепте, значение по умолчанию — в настройках.</div>' +
      '<div class="divider"></div><button class="btn-primary" id="rSave">Сохранить</button>',
      function (root) {
        root.querySelector('#rSave').addEventListener('click', function () {
          draft.rate = nonneg(root.querySelector('#rVal').value);
          closeSheet(); render();
        });
      });
  }

  /* ============================================================
     ЭКРАН: ИНГРЕДИЕНТЫ
     ============================================================ */
  function viewIngredients() {
    titleEl.textContent = 'Продукты и цены';
    var s = Store.state;
    var cats = ['Все'].concat(Array.from(new Set(s.ingredients.map(function (i) { return i.cat || 'Прочее'; }))));
    var q = search.ingredients.toLowerCase();
    var list = s.ingredients.filter(function (i) {
      var okCat = filters.ingredients === 'Все' || (i.cat || 'Прочее') === filters.ingredients;
      return okCat && (!q || i.name.toLowerCase().indexOf(q) >= 0);
    });

    var html = '<div class="search"><span class="muted">🔍</span><input id="qIng" placeholder="Поиск продуктов" value="' + esc(search.ingredients) + '"></div>';
    html += '<div class="chips">' + cats.map(function (c) {
      return '<button class="chip' + (filters.ingredients === c ? ' active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('') + '</div>';

    if (!list.length) {
      html += s.ingredients.length
        ? '<div class="empty"><div class="empty-title">Ничего не найдено</div></div>'
        : emptyState('🧺', 'Справочник пуст',
            'Внеси продукты, из которых печёшь. Цену пиши как в чеке: за пачку, бутылку или десяток — приложение само пересчитает.');
    } else {
      var todayIso = today();
      html += '<div class="card">' + list.map(function (i) {
        var age = i.updated ? Calc.daysBetween(i.updated, todayIso) : null;
        var stale = age != null && age > 30;
        return '<div class="row" data-ing="' + esc(i.id) + '">' +
          '<div class="thumb">' + esc(i.name.charAt(0)) + '</div>' +
          '<div class="row-main"><div class="row-title clamp2">' + esc(i.name) + '</div>' +
          '<div class="row-sub' + (stale ? ' warn-text' : '') + '">' +
          (i.updated ? 'цена от ' + fmtDate(i.updated) + (stale ? ', пора проверить' : '') : 'дата цены не указана') + '</div></div>' +
          '<div class="row-right"><div class="num num-md">' + moneyUnit(i) + '</div>' +
          '<div class="row-sub">' + Calc.money(i.price) + ' за ' + esc(num(i.amount)) + ' ' + esc(i.unit) + '</div></div>' +
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

    setMain('+ Новый продукт', function () { ingredientSheet(null); });
  }

  /* onSaved — если передан, после сохранения вызывается вместо закрытия
     (так продукт можно завести прямо из рецепта и вернуться туда же) */
  function ingredientSheet(id, onSaved) {
    var isNew = !id;
    var i = isNew
      ? { name: '', price: '', amount: '', unit: 'г', cat: 'Прочее', updated: today() }
      : JSON.parse(JSON.stringify(Store.ingredientsById()[id]));
    var units = Store.UNITS.map(function (u) {
      return '<option value="' + u + '"' + (u === i.unit ? ' selected' : '') + '>' + u + '</option>';
    }).join('');
    var usedBy = isNew ? [] : Store.usedIn(i.id);

    openSheet(isNew ? 'Новый продукт' : i.name,
      '<div class="field"><label class="label" for="iName">Название</label>' +
      '<input class="input" id="iName" placeholder="Например, сливки 33%" value="' + esc(i.name) + '"></div>' +
      '<div class="hint-text" style="margin:-6px 0 10px">Как в чеке: «пачка 180 г — 210 ₽», «десяток — 130 ₽».</div>' +
      '<div class="field-row"><div class="field"><label class="label" for="iPrice">Цена, ₽</label>' +
      '<input class="input num-input" id="iPrice" type="number" inputmode="decimal" min="0" value="' + esc(i.price) + '"></div>' +
      '<div class="field"><label class="label" for="iAmt">В упаковке</label>' +
      '<input class="input num-input" id="iAmt" type="number" inputmode="decimal" min="0" placeholder="сколько" value="' + esc(i.amount) + '"></div>' +
      '<div class="field narrow"><label class="label" for="iUnit">Ед.</label><select class="input" id="iUnit">' + units + '</select></div></div>' +
      '<div class="hint-text" id="iPreview" style="margin:-6px 0 12px"></div>' +
      '<div id="iPieceBox"></div>' +
      '<div class="field"><label class="label" for="iCat">Категория</label>' +
      '<input class="input" id="iCat" value="' + esc(i.cat || '') + '"></div>' +
      '<div class="field"><label class="label" for="iDate">Дата цены</label>' +
      '<input class="input" id="iDate" type="date" value="' + esc(i.updated || today()) + '"></div>' +
      '<div class="divider"></div><button class="btn-primary" id="iSave">Сохранить</button>' +
      (isNew ? '' : '<div style="height:8px"></div><button class="btn-ghost btn-danger" id="iDel">Удалить</button>'),
      function (root) {
        var priceEl = root.querySelector('#iPrice'), amtEl = root.querySelector('#iAmt'), unitEl = root.querySelector('#iUnit');
        var dateEl = root.querySelector('#iDate');
        var origPrice = Number(i.price), origAmt = Number(i.amount), origUnit = i.unit;
        function prev() {
          var tmp = { price: nonneg(priceEl.value), amount: nonneg(amtEl.value), unit: unitEl.value };
          var box = root.querySelector('#iPreview');
          box.textContent = tmp.price && tmp.amount ? 'Получается ' + moneyUnit(tmp).replace(/ /g, ' ') : '';
          var pieceBox = root.querySelector('#iPieceBox');
          if (unitEl.value === 'шт') {
            if (!pieceBox.firstChild) {
              pieceBox.innerHTML = '<div class="field"><label class="label" for="iPiece">Масса 1 шт, г (для упёка, можно не заполнять)</label>' +
                '<input class="input num-input" id="iPiece" type="number" inputmode="decimal" min="0" placeholder="55" value="' + esc(i.pieceMass || '') + '"></div>';
            }
          } else pieceBox.innerHTML = '';
          /* Цену поменяли — дата цены становится сегодняшней */
          if (!isNew && (tmp.price !== origPrice || tmp.amount !== origAmt)) dateEl.value = today();
        }
        [priceEl, amtEl].forEach(function (el2) { el2.addEventListener('input', prev); });
        unitEl.addEventListener('change', prev);
        prev();

        root.querySelector('#iSave').addEventListener('click', function () {
          var next = {
            id: i.id,
            name: root.querySelector('#iName').value.trim(),
            price: nonneg(priceEl.value),
            amount: nonneg(amtEl.value),
            unit: unitEl.value,
            cat: root.querySelector('#iCat').value.trim() || 'Прочее',
            updated: dateEl.value || today()
          };
          var pieceEl = root.querySelector('#iPiece');
          if (pieceEl && nonneg(pieceEl.value)) next.pieceMass = nonneg(pieceEl.value);
          if (!next.name) { toast('Впиши название'); return; }
          if (!next.amount) { toast('Впиши, сколько в упаковке'); return; }
          if (!isNew && usedBy.length && Calc.BASE_UNIT[next.unit] !== Calc.BASE_UNIT[origUnit]) {
            toast('Продукт уже в ' + usedBy.length + ' ' + plural(usedBy.length, 'рецепте', 'рецептах', 'рецептах') +
              ' в «' + origUnit + '». Можно выбрать только ' + Calc.BASE_UNIT[origUnit] + ' или ' +
              ({ 'г': 'кг', 'мл': 'л', 'шт': 'шт' })[Calc.BASE_UNIT[origUnit]] + ', иначе все расчёты поедут.');
            return;
          }
          var saved = Store.upsertIngredient(next);
          if (onSaved) { onSaved(saved); return; }
          closeSheet(); render(); toast('Сохранено');
        });
        var d = root.querySelector('#iDel');
        if (d) d.addEventListener('click', function () {
          if (usedBy.length) {
            toast('Продукт есть в ' + usedBy.length + ' ' + plural(usedBy.length, 'рецепте', 'рецептах', 'рецептах') +
              ': ' + usedBy.map(function (r) { return r.name; }).join(', ') + '. Сначала убери его оттуда.');
            return;
          }
          askConfirm('Удалить продукт?', '«' + i.name + '» исчезнет из справочника.', 'Удалить', function () {
            Store.removeIngredient(i.id); render();
          });
        });
      });
  }

  /* ============================================================
     ЭКРАН: ЗАКАЗЫ
     ============================================================ */
  function orderCard(o) {
    var st = Store.ORDER_STATUS.filter(function (x) { return x.key === o.status; })[0] || Store.ORDER_STATUS[0];
    var rec = o.recipeId ? Store.getRecipe(o.recipeId) : null;
    var volume = (rec && o.qty) ? num(o.qty) + ' ' + rec.yieldUnit : '';
    var when = o.date ? fmtDate(o.date) + (o.time ? ', ' + esc(o.time) : '') : 'без даты';
    var where = o.fulfillment === 'delivery' ? 'доставка' : o.fulfillment === 'courier' ? 'курьер' : 'самовывоз';
    var overdue = o.status !== 'done' && o.date && o.date < today();
    return '<div class="row" data-ord="' + esc(o.id) + '">' +
      '<div class="row-main"><div class="row-title clamp2">' + esc(o.title) + '</div>' +
      '<div class="row-sub">' + (volume ? esc(volume) + ' · ' : '') +
      esc(o.client || '') + (o.client ? ' · ' : '') + when + '</div>' +
      '<div class="row-sub clamp1">' + where + (o.address ? ' · ' + esc(o.address) : '') + '</div>' +
      '<div style="margin-top:6px"><span class="badge ' + st.tone + '">' + st.label + '</span>' +
      (overdue ? ' <span class="badge red">дата прошла</span>' : '') +
      (Number(o.rating) > 0 ? ' ' + stars(o.rating) : '') + '</div></div>' +
      '<div class="row-right num num-md">' + Calc.money(o.amount) + '</div>' +
      '<span class="chev">›</span></div>';
  }

  function viewOrders() {
    titleEl.textContent = 'Заказы';
    var list = Store.orders();
    var archivedCount = Store.archived().length;

    /* Сначала календарь, под ним список */
    var html = calendarBlock(list);

    html += '<div class="spread section-title" id="ordList"><span>Список заказов</span>' +
      '<button class="btn-link" id="quickFail">+ Не состоялся</button></div>';

    {
      var tabs = ['Все'].concat(Store.ORDER_STATUS.map(function (x) { return x.label; }));
      html += '<div class="chips">' + tabs.map(function (t) {
        return '<button class="chip' + (filters.orders === t ? ' active' : '') + '" data-ost="' + esc(t) + '">' + esc(t) + '</button>';
      }).join('') + '</div>';

      var shown = list.filter(function (o) {
        if (filters.orders === 'Все') return true;
        var st = Store.ORDER_STATUS.filter(function (x) { return x.key === o.status; })[0];
        return st && st.label === filters.orders;
      }).sort(function (a, b) { return (a.date || '9999').localeCompare(b.date || '9999'); });

      if (!shown.length) {
        html += list.length
          ? '<div class="empty"><div class="empty-title">В этом статусе пусто</div></div>'
          : emptyState('📋', 'Заказов пока нет',
              'Добавляй каждый заказ, а сорвавшиеся отмечай кнопкой «Не состоялся». Так станет видно, сколько заказов ты теряешь и почему.');
      } else {
        /* Группы по срокам: что горит, что сегодня, что на неделе */
        var todayIso = today(), weekEnd = Calc.addDays(todayIso, 7);
        var groups = [
          { title: 'Дата прошла', test: function (o) { return o.status !== 'done' && o.date && o.date < todayIso; } },
          { title: 'Сегодня', test: function (o) { return o.status !== 'done' && o.date === todayIso; } },
          { title: 'Ближайшие 7 дней', test: function (o) { return o.status !== 'done' && o.date > todayIso && o.date <= weekEnd; } },
          { title: 'Позже', test: function (o) { return o.status !== 'done' && o.date > weekEnd; } },
          { title: 'Без даты', test: function (o) { return o.status !== 'done' && !o.date; } },
          { title: 'Выданы', test: function (o) { return o.status === 'done'; } }
        ];
        groups.forEach(function (g) {
          var items = shown.filter(g.test);
          if (!items.length) return;
          html += '<div class="section-title">' + g.title + ' · ' + items.length + '</div>' +
            '<div class="card">' + items.map(orderCard).join('') + '</div>';
        });
      }

      var doneActive = list.filter(function (o) { return o.status === 'done'; });
      if (doneActive.length) {
        html += '<div style="height:12px"></div>' +
          '<button class="btn-ghost" id="toArchive">Убрать выданные в архив (' + doneActive.length + ')</button>';
      }
    }

    html += '<div style="height:8px"></div><button class="btn-ghost" id="openRefusals">Не состоялись (' + Store.state.refusals.length + ')</button>';
    if (archivedCount) {
      html += '<div style="height:8px"></div><button class="btn-ghost" id="openArchive">Архив (' + archivedCount + ')</button>';
    }

    viewEl.innerHTML = html;

    if (scrollToList) {
      scrollToList = false;
      var anchor = document.getElementById('ordList');
      if (anchor && anchor.scrollIntoView) anchor.scrollIntoView({ block: 'start' });
    }
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
      askConfirm('Убрать в архив?', done.length + ' ' + plural(done.length, 'выданный заказ уедет', 'выданных заказа уедут', 'выданных заказов уедут') +
        ' в архив. Из аналитики они никуда не денутся.',
        'Убрать', function () {
          done.forEach(function (o) { o.archived = true; Store.upsertOrder(o); });
          render(); toast('В архиве');
        }, true);
    });
    var opn = document.getElementById('openArchive');
    if (opn) opn.addEventListener('click', function () { go('archive'); });
    document.getElementById('openRefusals').addEventListener('click', function () { go('refusals'); });
    document.getElementById('quickFail').addEventListener('click', function () {
      refusalSheet(null, { reason: 'Клиент пропал, не ответил', stage: 'После озвучивания цены' });
    });

    setMain('+ Новый заказ', function () {
      orderSheet(null);
    });
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
    var MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
    var html = '<div class="cal-head">' +
      '<button class="icon-btn cal-arrow" id="calPrev" aria-label="Предыдущий месяц">‹</button>' +
      '<span class="cal-title">' + MONTHS[calCursor.m] + ' ' + calCursor.y + '</span>' +
      '<button class="icon-btn cal-arrow" id="calNext" aria-label="Следующий месяц">›</button></div>';

    html += '<div class="cal-week">' + ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map(function (d) {
      return '<div class="cal-dow">' + d + '</div>';
    }).join('') + '</div>';

    html += grid.map(function (week) {
      return '<div class="cal-week" style="margin-bottom:4px">' + week.map(function (d) {
        var orders = byDay[d.iso] || [];
        var cls = 'cal-day' + (d.inMonth ? '' : ' out') +
          (d.iso === todayIso ? ' today' : '') +
          (orders.length ? ' has' : '') +
          (d.iso === calSelected ? ' sel' : '');
        /* По точке на заказ; выданные — бледные, чтобы видеть, что ещё впереди */
        var dots = orders.slice().sort(function (a, b) { return (a.status === 'done') - (b.status === 'done'); })
          .slice(0, 3).map(function (o) {
            return '<span class="cal-dot' + (o.status === 'done' ? ' done' : '') + '"></span>';
          }).join('');
        return '<button class="' + cls + '" data-day="' + d.iso + '" aria-label="' + fmtDate(d.iso) +
          (orders.length ? ', ' + orders.length + ' ' + plural(orders.length, 'заказ', 'заказа', 'заказов') : '') + '">' +
          '<span>' + d.day + '</span>' +
          '<span class="cal-dots">' + dots + '</span>' +
          (orders.length > 3 ? '<span class="cal-load num">+' + (orders.length - 3) + '</span>' : '') +
          '</button>';
      }).join('') + '</div>';
    }).join('');

    html += '<div class="hint-text" style="margin-top:8px">Нажми на день, чтобы увидеть заказы. ' +
      'Точка под числом – один заказ, бледная – уже выдан.</div>';
    return html;
  }

  function bindCalendar() {
    function shift(n) {
      calCursor.m += n;
      if (calCursor.m < 0) { calCursor.m = 11; calCursor.y -= 1; }
      if (calCursor.m > 11) { calCursor.m = 0; calCursor.y += 1; }
    }
    var prev = document.getElementById('calPrev');
    var next = document.getElementById('calNext');
    if (prev) prev.addEventListener('click', function () { shift(-1); render(); });
    if (next) next.addEventListener('click', function () { shift(1); render(); });
    viewEl.querySelectorAll('[data-day]').forEach(function (b) {
      b.addEventListener('click', function () {
        haptic();
        var iso = b.dataset.day;
        /* День соседнего месяца — переключаемся на этот месяц */
        if (b.classList.contains('out')) {
          var p = iso.split('-');
          calCursor = { y: Number(p[0]), m: Number(p[1]) - 1 };
        }
        calSelected = iso;
        render();
        daySheet(iso);
      });
    });
  }

  /* Окно дня: что выдаём в этот день */
  var WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  function dayTitle(iso) {
    var p = iso.split('-').map(Number);
    var wd = WEEKDAYS[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
    var diff = Calc.daysBetween(today(), iso);
    var rel = diff === 0 ? 'Сегодня' : diff === 1 ? 'Завтра' : diff === -1 ? 'Вчера' : '';
    return (rel ? rel + ', ' : '') + fmtDate(iso) + ', ' + wd;
  }

  function daySheet(iso) {
    var list = Store.orders().filter(function (o) { return o.date === iso; })
      .sort(function (a, b) { return (a.time || '99').localeCompare(b.time || '99'); });
    var diff = Calc.daysBetween(today(), iso);
    var when = diff === 0 ? 'Сегодня' : diff === 1 ? 'Завтра' : diff === -1 ? 'Вчера' : 'В этот день';
    var html;
    if (!list.length) {
      html = '<div class="day-empty">' + when + ' заказов нет.</div>';
    } else {
      var sum = list.reduce(function (t, o) { return t + (Number(o.amount) || 0); }, 0);
      var left = list.filter(function (o) { return o.status !== 'done'; }).length;
      html = '<div class="hint-text" style="margin:-4px 2px 10px">' + when + ' ' + list.length + ' ' +
        plural(list.length, 'заказ', 'заказа', 'заказов') + ' на ' + Calc.money(sum) +
        (left === list.length ? '' : left ? ', осталось выдать ' + left : ', все выданы') + '.</div>' +
        '<div class="day-lines">' + list.map(function (o) {
          var bits = [o.time || 'время не указано', o.title || 'Заказ'];
          if (o.client) bits.push(o.client);
          return '<div class="day-line">' + esc(bits.join(' · ')) + '</div>';
        }).join('') + '</div>' +
        '<div class="card">' + list.map(orderCard).join('') + '</div>';
    }
    html += '<div style="height:12px"></div><button class="btn-primary" id="dayAdd">+ Заказ на этот день</button>';
    openSheet(dayTitle(iso), html, function (root) {
      root.querySelectorAll('[data-ord]').forEach(function (b) {
        b.addEventListener('click', function () { orderSheet(b.dataset.ord); });
      });
      root.querySelector('#dayAdd').addEventListener('click', function () { orderSheet(null, { date: iso }); });
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
        '<div class="hint-text" style="margin-top:4px">' + list.length + ' ' + plural(list.length, 'заказ', 'заказа', 'заказов') + '</div></div>';
      html += '<div class="card">' + list.map(orderCard).join('') + '</div>';
    }
    viewEl.innerHTML = html;
    viewEl.querySelectorAll('[data-ord]').forEach(function (b) {
      b.addEventListener('click', function () { orderSheet(b.dataset.ord); });
    });
    setMain('', null);
  }

  /* ---------------- Карточка заказа ---------------- */
  var STAGE_BY_STATUS = {
    'new': 'После озвучивания цены',
    'confirmed': 'После внесения предоплаты',
    'work': 'Отмена уже в работе'
  };

  function orderSheet(id, prefill) {
    var isNew = !id;
    var found = isNew ? null : Store.state.orders.filter(function (x) { return x.id === id; })[0];
    if (!isNew && !found) { render(); return; }
    var o = isNew
      ? Object.assign({ title: '', client: '', amount: '', date: today(), time: '', status: 'new', recipeId: '',
          qty: '', fulfillment: 'pickup', address: '', deliveryFee: 0,
          archived: false, legal: false, rating: 0, review: '' }, prefill || {})
      : JSON.parse(JSON.stringify(found));
    Store.normalizeOrder(o);
    var settings = Store.state.settings;
    /* Новый заказ: сумма подставляется сама, пока её не поменяли руками */
    var amountTouched = !isNew;

    var recipeOpts = '<option value="">— без рецепта —</option>' + Store.state.recipes.map(function (r) {
      return '<option value="' + esc(r.id) + '"' + (r.id === o.recipeId ? ' selected' : '') + '>' + esc(r.name) + '</option>';
    }).join('');
    var statusOpts = Store.ORDER_STATUS.map(function (x) {
      return '<option value="' + x.key + '"' + (x.key === o.status ? ' selected' : '') + '>' + x.label + '</option>';
    }).join('');

    openSheet(isNew ? 'Новый заказ' : o.title,
      '<div class="field"><label class="label" for="oRecipe">Рецепт</label><select class="input" id="oRecipe">' + recipeOpts + '</select></div>' +
      '<div id="oScaleBox"></div>' +
      '<div class="field"><label class="label" for="oTitle">Что заказали</label>' +
      '<input class="input" id="oTitle" placeholder="Например, торт «Медовик» 2 кг" value="' + esc(o.title) + '"></div>' +
      '<div class="field-row"><div class="field"><label class="label" for="oDate">Дата выдачи</label>' +
      '<input class="input" id="oDate" type="date" value="' + esc(o.date) + '"></div>' +
      '<div class="field"><label class="label" for="oTime">Время</label>' +
      '<input class="input" id="oTime" type="time" value="' + esc(o.time || '') + '"></div></div>' +
      '<div class="field"><label class="label" for="oClient">Клиент</label>' +
      '<input class="input" id="oClient" value="' + esc(o.client || '') + '"></div>' +

      '<div class="label">Как заказ попадёт к клиенту</div>' +
      segmented('oFulfil', [
        { key: 'pickup', label: 'Самовывоз' },
        { key: 'delivery', label: 'Везу сам' },
        { key: 'courier', label: 'Курьер' }
      ], o.fulfillment || 'pickup') +
      '<div class="hint-text" id="oFulfilHint" style="margin:6px 2px 12px"></div>' +
      '<div id="oDeliveryBox"></div>' +
      (settings.taxOn
        ? switchRow('oLegal', 'Заказ от компании или ИП', 'Налог ' + num(settings.taxLegal) + '%', !!o.legal,
            'От частного лица, налог ' + num(settings.taxPerson) + '%') + '<div style="height:12px"></div>'
        : '') +

      '<div class="field"><label class="label" for="oAmount">Сумма для клиента, ₽</label>' +
      '<input class="input num-input" id="oAmount" type="number" inputmode="decimal" min="0" value="' + esc(o.amount) + '"></div>' +
      '<div id="oMoney"></div>' +

      '<div class="field"><label class="label" for="oStatus">Статус</label><select class="input" id="oStatus">' + statusOpts + '</select></div>' +
      '<div id="oReviewBox"></div>' +
      '<div class="divider"></div><button class="btn-primary" id="oSave">Сохранить</button>' +
      (isNew ? '' :
        (o.status !== 'done' ? '<div style="height:8px"></div><button class="btn-ghost" id="oFail">Не состоялся</button>' : '') +
        '<div style="height:8px"></div><button class="btn-ghost" id="oArch">' + (o.archived ? 'Вернуть из архива' : 'Убрать в архив') + '</button>' +
        '<div style="height:8px"></div><button class="btn-ghost btn-danger" id="oDel">Удалить заказ</button>'),
      function (root) {
        var box = root.querySelector('#oScaleBox');
        var amountEl = root.querySelector('#oAmount');

        function recipe() { var v = root.querySelector('#oRecipe').value; return v ? Store.getRecipe(v) : null; }
        function qtyVal() {
          var f = root.querySelector('#oQty');
          return f ? nonneg(f.value) : nonneg(o.qty);
        }
        function legalOn() {
          var f = root.querySelector('#oLegal');
          return f ? f.checked : !!o.legal;
        }
        var fulfil = o.fulfillment || 'pickup';
        function feeVal() {
          if (fulfil === 'pickup') return 0;
          var f = root.querySelector('#oFee');
          return f ? nonneg(f.value) : nonneg(o.deliveryFee);
        }
        function taxRate() {
          return settings.taxOn ? (legalOn() ? settings.taxLegal : settings.taxPerson) : 0;
        }

        function drawScale() {
          var r = recipe();
          if (!r) { box.innerHTML = ''; return; }
          var q = qtyVal() || r.yieldAmount;
          box.innerHTML =
            '<div class="field-row"><div class="field"><label class="label" for="oQty">Сколько нужно</label>' +
            '<input class="input num-input" id="oQty" type="number" inputmode="decimal" min="0" step="0.1" value="' + esc(q) + '"></div>' +
            '<div class="field narrow"><label class="label" for="oQtyUnit">Ед.</label>' +
            '<input class="input" id="oQtyUnit" value="' + esc(r.yieldUnit) + '" readonly tabindex="-1"></div></div>' +
            '<div class="hint-text" style="margin-top:-6px;margin-bottom:12px">В рецепте выход ' +
            num(r.yieldAmount) + ' ' + esc(r.yieldUnit) + ', остальное пересчитается.</div>';
          var qf = root.querySelector('#oQty');
          if (qf) qf.addEventListener('input', recalc);
        }

        /* Деньги заказа: цена торта, доставка, итог клиенту и что останется */
        function recalc() {
          var r = recipe();
          var panel = root.querySelector('#oMoney');
          var fee = feeVal();
          var t = taxRate();
          if (!r) {
            var a0 = nonneg(amountEl.value);
            panel.innerHTML = a0 && t ? '<div class="hint-text" style="margin:-6px 0 14px">Налог ' + num(t) + '%: ' +
              Calc.money(a0 * t / 100) + '. Без рецепта себестоимость не считается.</div>'
              : '<div class="hint-text" style="margin:-6px 0 14px">Выбери рецепт, чтобы посчитать цену и себестоимость.</div>';
            return;
          }
          var scale = Calc.scaleFactor(qtyVal(), r.yieldAmount);
          var c = Store.computeRecipe(r, { scale: scale, taxRate: t });
          var recommended = Math.round(c.price) + fee;
          if (!amountTouched) amountEl.value = recommended;
          var amount = nonneg(amountEl.value);
          /* Налог берётся со всей суммы, которую платит клиент, вместе с доставкой */
          var taxSum = amount * t / 100;
          var toCourier = fulfil === 'courier' ? Math.min(fee, amount) : 0;   // транзит, не заработок
          var selfFee = fulfil === 'delivery' ? Math.min(fee, amount) : 0;    // плата за свою доставку
          var keep = amount - toCourier - selfFee - taxSum - c.cost;          // «сверху» с самого торта
          var diff = recommended - amount;

          var html = '<div class="total-card" style="margin-top:-4px">' +
            '<div class="total-row"><span>Объём ×' + num(scale) + ', себестоимость</span><span class="num">' + Calc.money(c.cost) + '</span></div>' +
            '<div class="total-row"><span>Рекомендуемая цена торта</span><span class="num">' + Calc.money(c.price) + '</span></div>' +
            (fee ? '<div class="total-row"><span>' + (fulfil === 'courier' ? 'Курьер' : 'Доставка') + '</span><span class="num">' + Calc.money(fee) + '</span></div>' : '') +
            '<div class="total-row main"><span>Итого клиенту</span><span class="num">' + Calc.money(recommended) + '</span></div>' +
            '</div>';
          if (amount) {
            if (keep + selfFee < 0) {
              html += '<div class="warn-box">При сумме ' + Calc.money(amount) + ' ты работаешь в убыток: ' +
                Calc.money(-(keep + selfFee)) + ' не хватает даже на себестоимость.</div>';
            } else {
              html += '<div class="total-row-plain"><span>Тебе на руки: работа + сверху</span><b class="num">' +
                Calc.money(c.labor + keep + selfFee) + '</b></div>' +
                '<div class="hint-text" style="margin:2px 2px 6px">При сумме ' + Calc.money(amount) +
                (t ? ', после налога ' + Calc.money(taxSum) : '') + (toCourier ? ' и ' + Calc.money(toCourier) + ' курьеру' : '') +
                ': за работу ' + Calc.money(c.labor) + ', сверху ' + Calc.money(keep) +
                (selfFee ? ', за доставку ' + Calc.money(selfFee) : '') + '.</div>';
            }
            if (diff > 1) {
              html += '<div class="hint-text warn-text" style="margin:0 2px 14px">Ниже рекомендуемой на ' + Calc.money(diff) +
                '. <button class="btn-link" id="oUseRec" type="button">Поставить ' + Calc.money(recommended) + '</button></div>';
            } else if (diff < -1 && amountTouched) {
              html += '<div class="hint-text" style="margin:0 2px 14px"><button class="btn-link" id="oUseRec" type="button">Вернуть рекомендуемую ' +
                Calc.money(recommended) + '</button></div>';
            } else {
              html += '<div style="height:10px"></div>';
            }
          }
          panel.innerHTML = html;
          var use = panel.querySelector('#oUseRec');
          if (use) use.addEventListener('click', function () { amountEl.value = recommended; amountTouched = false; recalc(); });
        }

        root.querySelector('#oRecipe').addEventListener('change', function () {
          var r = recipe();
          o.qty = '';
          drawScale();
          var titleEl2 = root.querySelector('#oTitle');
          if (r && !titleEl2.value) titleEl2.value = r.name;
          recalc();
        });

        var FULFIL_HINT = {
          pickup: 'Клиент забирает сам, доплаты нет.',
          delivery: 'Плата за доставку остаётся тебе и входит в заработок.',
          courier: 'Служба доставки: клиент платит, деньги уходят курьеру. В заработок не входят.'
        };
        function drawDelivery() {
          var dbox = root.querySelector('#oDeliveryBox');
          root.querySelector('#oFulfilHint').textContent = FULFIL_HINT[fulfil];
          dbox.innerHTML = fulfil !== 'pickup'
            ? '<div class="field"><label class="label" for="oAddress">Адрес доставки</label>' +
              '<input class="input" id="oAddress" placeholder="Город, улица, дом, квартира" value="' + esc(o.address || '') + '"></div>' +
              '<div class="field"><label class="label" for="oFee">' +
              (fulfil === 'courier' ? 'Сколько стоит курьер, ₽' : 'Доставка для клиента, ₽') + '</label>' +
              '<input class="input num-input" id="oFee" type="number" inputmode="decimal" min="0" value="' + esc(o.deliveryFee || 0) + '"></div>' +
              '<div class="hint-text" style="margin-top:-8px;margin-bottom:14px">Прибавляется к цене торта. В себестоимость не входит.</div>'
            : '';
          var f = dbox.querySelector('#oFee');
          if (f) f.addEventListener('input', recalc);
        }
        root.querySelectorAll('#oFulfil [data-seg]').forEach(function (b) {
          b.addEventListener('click', function () {
            var a = root.querySelector('#oAddress');
            var f = root.querySelector('#oFee');
            if (a) o.address = a.value;
            if (f) o.deliveryFee = nonneg(f.value);
            fulfil = b.dataset.seg;
            root.querySelectorAll('#oFulfil [data-seg]').forEach(function (x) { x.classList.toggle('active', x === b); });
            haptic();
            drawDelivery(); recalc();
          });
        });
        var legalEl = root.querySelector('#oLegal');
        if (legalEl) legalEl.addEventListener('change', recalc);
        amountEl.addEventListener('input', function () { amountTouched = true; recalc(); });

        function drawReview() {
          var done = root.querySelector('#oStatus').value === 'done';
          var rbox = root.querySelector('#oReviewBox');
          if (!done) { rbox.innerHTML = ''; return; }
          var t = rbox.querySelector('#oReview');
          if (t) o.review = t.value;
          rbox.innerHTML =
            '<div class="section-title">Отзыв клиента</div>' +
            '<div class="rate-pick" id="oRate">' +
            [1, 2, 3, 4, 5].map(function (n) {
              return '<button type="button" data-rate="' + n + '" aria-label="' + n + ' из 5"' +
                (Number(o.rating) >= n ? ' class="on"' : '') + '>★</button>';
            }).join('') + '</div>' +
            '<div style="height:10px"></div>' +
            '<div class="field"><label class="label" for="oReview">Что сказали</label>' +
            '<textarea class="input" id="oReview" rows="2" placeholder="Своими словами">' + esc(o.review || '') + '</textarea></div>' +
            (Number(o.rating) ? '<button class="btn-link" id="oRateClear" type="button">Убрать оценку</button>' : '');
          rbox.querySelectorAll('[data-rate]').forEach(function (b) {
            b.addEventListener('click', function () {
              var tt = root.querySelector('#oReview');
              if (tt) o.review = tt.value;
              o.rating = Number(b.dataset.rate);
              haptic(); drawReview();
            });
          });
          var clr = rbox.querySelector('#oRateClear');
          if (clr) clr.addEventListener('click', function () {
            var tt = root.querySelector('#oReview');
            if (tt) o.review = tt.value;
            o.rating = 0; drawReview();
          });
        }
        root.querySelector('#oStatus').addEventListener('change', drawReview);
        drawReview();

        drawScale();
        drawDelivery();
        recalc();

        /* Сборка заказа из формы — одна и та же для сохранения и архива */
        function collect() {
          var delivery = fulfil !== 'pickup';
          var addrEl = root.querySelector('#oAddress');
          var revEl = root.querySelector('#oReview');
          var next = {
            id: o.id,
            title: root.querySelector('#oTitle').value.trim(),
            recipeId: root.querySelector('#oRecipe').value,
            qty: recipe() ? (qtyVal() || null) : null,
            legal: legalOn(),
            amount: nonneg(amountEl.value),
            date: root.querySelector('#oDate').value,
            time: root.querySelector('#oTime').value,
            client: root.querySelector('#oClient').value.trim(),
            status: root.querySelector('#oStatus').value,
            fulfillment: fulfil,
            address: delivery ? (addrEl ? addrEl.value.trim() : o.address) : '',
            deliveryFee: feeVal(),
            archived: !!o.archived,
            rating: Number(o.rating) || 0,
            review: revEl ? revEl.value.trim() : (o.review || ''),
            reviewDate: o.reviewDate
          };
          if (!next.title) { toast('Впиши, что заказали'); return null; }
          if (!next.date) { toast('Укажи дату выдачи'); return null; }
          if (next.status !== 'done') { next.rating = 0; next.review = ''; next.reviewDate = ''; }
          if (next.rating && !next.reviewDate) next.reviewDate = today();
          return next;
        }

        root.querySelector('#oSave').addEventListener('click', function () {
          var next = collect();
          if (!next) return;
          Store.upsertOrder(next); closeSheet(); render(); toast('Сохранено');
        });
        var arch = root.querySelector('#oArch');
        if (arch) arch.addEventListener('click', function () {
          var next = collect();
          if (!next) return;
          next.archived = !o.archived;
          Store.upsertOrder(next);
          closeSheet(); render();
          toast(next.archived ? 'Убрано в архив' : 'Возвращено в список');
        });
        var fail = root.querySelector('#oFail');
        if (fail) fail.addEventListener('click', function () {
          var next = collect() || o;
          refusalSheet(null, {
            title: next.title, client: next.client, amount: next.amount, date: today(),
            stage: STAGE_BY_STATUS[next.status] || Store.STAGES[1], reason: ''
          }, function () {
            Store.removeOrder(o.id);
            toast('Заказ перенесён в «Не состоялись»');
          });
        });
        var d = root.querySelector('#oDel');
        if (d) d.addEventListener('click', function () {
          askConfirm('Удалить заказ?', 'Заказ «' + (o.title || 'без названия') + '» исчезнет и из аналитики тоже. ' +
            'Если он сорвался, лучше нажать «Не состоялся» — тогда причина попадёт в аналитику.',
            'Удалить', function () { Store.removeOrder(o.id); render(); });
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

    viewEl.querySelectorAll('[data-mm]').forEach(function (b) {
      b.addEventListener('click', function () { moneyMonth = b.dataset.mm; render(); });
    });
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
  var moneyMonth = null;

  function moneySection() {
    var rows = Store.moneyRows();
    if (!rows.length) {
      return emptyState('💰', 'Выданных заказов нет',
        'Здесь считаются заказы со статусом «Выдан». Отметь первый выданный заказ — появятся выручка, расходы и сколько заработано.');
    }

    var months = Calc.monthlyRollup(rows);
    if (moneyMonth === null) moneyMonth = months[months.length - 1].key;
    if (moneyMonth !== 'all' && !months.some(function (m) { return m.key === moneyMonth; })) moneyMonth = 'all';
    var picked = moneyMonth === 'all' ? months : months.filter(function (m) { return m.key === moneyMonth; });
    var all = picked.reduce(function (a, m) {
      ['revenue', 'ingredients', 'labor', 'overhead', 'tax', 'minutes', 'orders', 'withRecipe'].forEach(function (k) { a[k] += m[k]; });
      return a;
    }, { revenue: 0, ingredients: 0, labor: 0, overhead: 0, tax: 0, minutes: 0, orders: 0, withRecipe: 0 });
    all.cost = all.ingredients + all.labor + all.overhead;
    all.profit = all.revenue - all.cost - all.tax;
    all.cash = all.revenue - all.ingredients - all.tax;
    all.earned = all.revenue - all.ingredients - all.overhead - all.tax;
    var hours = all.minutes / 60;

    var MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
    function longLabel(key) { var p = key.split('-'); return MONTHS[Number(p[1]) - 1] + ' ' + p[0]; }

    var html = '<div class="chips">' +
      '<button class="chip' + (moneyMonth === 'all' ? ' active' : '') + '" data-mm="all">Всё время</button>' +
      months.slice().reverse().map(function (m) {
        return '<button class="chip' + (moneyMonth === m.key ? ' active' : '') + '" data-mm="' + m.key + '">' + esc(longLabel(m.key)) + '</button>';
      }).join('') + '</div>';

    var period = moneyMonth === 'all' ? 'за всё время' : 'за ' + longLabel(moneyMonth);
    html += '<div class="stat-card"><div class="stat-label">Заработано ' + esc(period) + '</div>' +
      '<div class="stat-value num num-lg">' + Calc.money(all.earned) + '</div>' +
      '<div class="hint-text" style="margin-top:4px">' +
      (hours ? Math.round(hours) + ' ч работы — это ' + Calc.money(all.earned / hours) + ' в час' : '') +
      '. Выручка минус продукты, накладные и налог.</div></div>';

    html += '<div class="kpi">' +
      kpi('Выручка', Calc.money(all.revenue), all.orders + ' ' + plural(all.orders, 'выданный заказ', 'выданных заказа', 'выданных заказов')) +
      kpi('Ушло на продукты', Calc.money(all.ingredients), Calc.pct(all.revenue ? all.ingredients / all.revenue * 100 : 0, 0) + ' выручки') +
      kpi('Налог', Calc.money(all.tax), all.tax ? 'не забудь чеки в «Мой налог»' : 'учёт налога выключен') +
      kpi('За работу', Calc.money(all.labor), 'по цене твоего часа') +
      kpi('Прибыль сверх оплаты труда', Calc.money(all.profit), 'то, что сверху', true) +
      '</div>';

    if (moneyMonth === 'all' && months.length) {
      html += '<div class="section-title">Куда уходит выручка</div>';
      html += moneyChart(months);
    }

    html += '<div class="section-title">По месяцам</div>' +
      '<div class="hint-text" style="margin:-4px 0 6px">Таблица листается вбок →</div>';
    html += '<div class="table-scroll"><table class="data-table"><thead><tr>' +
      '<th>Месяц</th><th class="num">Выручка</th><th class="num">Заработано</th><th class="num">Продукты</th>' +
      '<th class="num">Накладные</th><th class="num">Налог</th><th class="num">За работу</th><th class="num">Сверх оплаты труда</th>' +
      '</tr></thead><tbody>' +
      months.slice().reverse().map(function (m) {
        return '<tr' + (m.key === moneyMonth ? ' class="hl"' : '') + '><td>' + esc(m.label) + '</td>' +
          '<td class="num">' + Calc.money(m.revenue) + '</td>' +
          '<td class="num"><b>' + Calc.money(m.earned) + '</b></td>' +
          '<td class="num">' + Calc.money(m.ingredients) + '</td>' +
          '<td class="num">' + Calc.money(m.overhead) + '</td>' +
          '<td class="num">' + Calc.money(m.tax) + '</td>' +
          '<td class="num">' + Calc.money(m.labor) + '</td>' +
          '<td class="num' + (m.profit < 0 ? ' neg' : '') + '">' + Calc.money(m.profit) + '</td></tr>';
      }).join('') + '</tbody></table></div>';

    html += '<div class="hint-text" style="margin-top:10px">«Заработано» = оплата за работу + прибыль сверху. Себестоимость выданного заказа ' +
      'фиксируется в день выдачи и не меняется, если потом подорожают продукты.</div>';

    var noRecipe = all.orders - all.withRecipe;
    if (noRecipe > 0) {
      html += '<div class="warn-box" style="margin-top:10px">' + noRecipe + ' ' +
        plural(noRecipe, 'выданный заказ без рецепта', 'выданных заказа без рецепта', 'выданных заказов без рецепта') +
        ': выручка посчитана, а продукты нет, поэтому заработок завышен. Выбери рецепт в карточке заказа.</div>';
    }
    return html;
  }

  /* ---------------- Отказы ---------------- */
  var ADVICE = {
    'Дорого, не устроила цена': 'Прежде чем снижать цену, посмотри канал: если «дорого» скапливается в одном месте (часто Авито), это не твоя аудитория. Покажи в переписке, из чего складывается цена, и предложи вариант меньше по весу.',
    'Занята дата, нет слота': 'Спрос выше, чем ты успеваешь. Это сигнал поднимать цену, а не брать больше смен.',
    'Клиент пропал, не ответил': 'Обычно это долгий ответ или непонятная цена. Отвечай в течение часа и называй цену сразу, без «напишите в личку».',
    'Ушёл к другому кондитеру': 'Сравни с конкурентами не только цену: сроки, фото работ, отзывы, как быстро отвечают.',
    'Слишком срочно': 'Вместо отказа можно брать срочные заказы с наценкой.',
    'Событие отменилось': 'Это не про тебя. Главное, чтобы предоплата покрывала уже купленные продукты.',
    'Не подошёл состав': 'Подумай о варианте без лактозы, сахара или орехов — если таких отказов много, это спрос.',
    'Доставка не устроила': 'Проверь, сколько стоит доставка и предлагаешь ли самовывоз.',
    'Технически не получилось сделать': 'Если повторяется — это направление, которому стоит научиться.',
    'Отказ с моей стороны, невыгодно': 'Отказаться от невыгодного заказа – правильное решение. Проверь, что твоя цена учитывает всё — тогда таких заказов будет меньше.'
  };

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
        'Выбери другой период. Когда заказ срывается, нажми в нём «Не состоялся» — отсюда станет видно, где ты теряешь деньги.');
    }

    var byReason = Calc.groupBy(refusals, 'reason');
    if (byReason.length) {
      var top = byReason[0];
      html += '<div class="stat-card"><div class="stat-label">Главная причина, почему не покупают</div>' +
        '<div class="row-title" style="margin-top:4px">' + esc(top.key) + '</div>' +
        '<div class="hint-text" style="margin-top:2px">' + top.count + ' из ' + refusals.length + ' · упущено ' + Calc.money(top.amount) + '</div>' +
        (ADVICE[top.key] ? '<div class="hint-text" style="margin-top:8px;color:var(--text)">' + ADVICE[top.key] + '</div>' : '') +
        '</div>';
    }

    html += '<div class="kpi">' +
      kpi('Стали заказами', Calc.pct(f.conversion, 0), f.done + ' из ' + f.total + ' ' + plural(f.total, 'обращения', 'обращений', 'обращений')) +
      kpi('Упущено', Calc.money(f.lostRevenue), f.lost + ' ' + plural(f.lost, 'заказ не состоялся', 'заказа не состоялись', 'заказов не состоялись')) +
      kpi('Средний заказ', Calc.money(f.avgCheckWon),
        f.lost ? 'средний сорвавшийся ' + Calc.money(f.avgCheckLost) : '') +
      '</div>';

    function barBlock(title, rows) {
      if (!rows.length) return '';
      var max = Math.max.apply(null, rows.map(function (r) { return r.count; }));
      return '<div class="section-title">' + title + '</div><div class="card" style="padding:12px 14px">' +
        rows.map(function (r) {
          return '<div class="bar-row"><span class="bar-label">' + esc(r.key) + '</span>' +
            '<span class="bar-track"><span class="bar-fill" style="width:' + (max ? (r.count / max * 100) : 0) + '%"></span></span>' +
            '<span class="num muted" style="text-align:right">' + Calc.pct(r.share, 0) + '</span></div>' +
            '<div class="hint-text" style="margin:-2px 0 8px">' + r.count + ' шт · упущено ' + Calc.money(r.amount) + '</div>';
        }).join('') + '</div>';
    }

    html += barBlock('Почему не купили', byReason);
    html += barBlock('На каком этапе срывалось', Calc.groupBy(refusals, 'stage'));
    html += barBlock('Откуда приходили', Calc.groupBy(refusals, 'channel'));

    var cross = Calc.crossTab(refusals, 'reason', 'channel');
    var usedChannels = Store.CHANNELS.filter(function (c) { return refusals.some(function (r) { return r.channel === c; }); });
    if (cross.length && usedChannels.length > 1) {
      html += '<div class="section-title">Какая причина из какого канала</div>' +
        '<div class="hint-text" style="margin:-4px 0 6px">Таблица листается вбок →</div>' +
        '<div class="table-scroll"><table class="data-table"><thead><tr><th>Причина</th>' +
        usedChannels.map(function (c) { return '<th class="num">' + esc(c) + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        cross.map(function (r) {
          return '<tr><td>' + esc(r.key) + '</td>' +
            usedChannels.map(function (c) {
              var v = r.cols[c] || 0;
              return '<td class="num' + (v ? '' : ' muted') + '">' + (v || '·') + '</td>';
            }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="hint-text" style="margin-top:8px">Если одна причина скапливается в одном канале — проблема в канале, а не в тебе.</div>';
    }

    var conv = Calc.conversionByMonth(s2.orders, s2.refusals);
    if (conv.length >= 2) {
      html += '<div class="section-title">Доля обращений, ставших заказами, по месяцам</div>' + conversionChart(conv);
    }

    html += '<div class="divider"></div><button class="btn-ghost" id="toRef">Все несостоявшиеся заказы (' + s2.refusals.length + ')</button>';
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
          rs.count + ' из ' + done.length + ' ' + plural(done.length, 'заказа', 'заказов', 'заказов') + ' с оценкой') +
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
              '<div class="row-sub">' + r.count + ' ' + plural(r.count, 'оценка', 'оценки', 'оценок') + '</div></div>' +
              '<div class="row-right">' + stars(r.average) + '<div class="row-sub num">' + num(r.average) + '</div></div></div>';
          }).join('') + '</div>';
      }
    }

    var rc = Calc.repeatClients(done);
    html += '<div class="kpi" style="margin-top:12px">' +
      kpi('Повторные клиенты', Calc.pct(rc.share, 0), rc.repeat + ' из ' + rc.clients + ' вернулись') +
      kpi('Всего клиентов', String(rc.clients), 'по выданным заказам') +
      '</div>';

    var texts = done.filter(function (o) { return (o.review || '').trim(); })
      .sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    if (texts.length) {
      html += '<div class="section-title">Что пишут</div><div class="card">' +
        texts.map(function (o) {
          return '<div class="row" data-ord="' + esc(o.id) + '"><div class="row-main">' +
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
    titleEl.textContent = 'Не состоялись';
    var s = Store.state;
    var f = Calc.funnel(s.orders, s.refusals);
    var html = '';

    if (s.refusals.length) {
      html += '<div class="stat-card"><div class="stat-label">Упущено за всё время</div>' +
        '<div class="stat-value num num-lg">' + Calc.money(f.lostRevenue) + '</div>' +
        '<div class="hint-text" style="margin-top:4px">' + f.lost + ' ' + plural(f.lost, 'заказ', 'заказа', 'заказов') +
        '. Причины разобраны в Аналитике → Отказы.</div></div>';
      html += '<div class="card">' + s.refusals.slice().sort(function (a, b) {
        return (b.date || '').localeCompare(a.date || '');
      }).map(function (r) {
        return '<div class="row" data-ref="' + esc(r.id) + '">' +
          '<div class="row-main"><div class="row-title clamp2">' + esc(r.title || 'Без названия') + '</div>' +
          '<div class="row-sub">' + esc(r.client || '') + (r.client ? ' · ' : '') + esc(r.channel || '') + ' · ' + fmtDate(r.date) + '</div>' +
          '<div class="row-sub" style="margin-top:4px">' + esc(r.reason || '—') + '</div>' +
          '<div class="row-sub">' + esc(r.stage || '') + '</div></div>' +
          '<div class="row-right num num-md">' + (Number(r.amount) ? Calc.money(r.amount) : '<span class="muted" style="font-family:var(--font);font-weight:400;font-size:13px">сумма<br>не указана</span>') + '</div>' +
          '<span class="chev">›</span></div>';
      }).join('') + '</div>';
    } else {
      html += emptyState('📉', 'Пока пусто',
        'Сюда попадают заказы, которые не состоялись: спросили цену и пропали, ушли к другому, отменили. Через месяц станет видно, где ты теряешь деньги.');
    }

    viewEl.innerHTML = html;
    viewEl.querySelectorAll('[data-ref]').forEach(function (b) {
      b.addEventListener('click', function () { refusalSheet(b.dataset.ref); });
    });
    setMain('+ Записать несостоявшийся', function () { refusalSheet(null); });
  }

  /* prefill — данные из карточки заказа; onSaved — вызывается после сохранения */
  function refusalSheet(id, prefill, onSaved) {
    var isNew = !id;
    var found = isNew ? null : Store.state.refusals.filter(function (x) { return x.id === id; })[0];
    if (!isNew && !found) { render(); return; }
    var r = isNew
      ? Object.assign({ title: '', client: '', amount: '', date: today(), channel: 'Instagram',
          stage: Store.STAGES[1], reason: Store.REASONS[3], comment: '' }, prefill || {})
      : JSON.parse(JSON.stringify(found));

    function opts(arr, cur) {
      var list = arr.indexOf(cur) >= 0 || !cur ? arr : arr.concat([cur]);
      return list.map(function (v) {
        return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>';
      }).join('');
    }

    openSheet(isNew ? 'Заказ не состоялся' : (r.title || 'Несостоявшийся заказ'),
      '<div class="field"><label class="label" for="rReason">Почему</label><select class="input" id="rReason">' +
        (r.reason ? '' : '<option value="" selected disabled>Выбери причину</option>') + opts(Store.REASONS, r.reason) + '</select></div>' +
      '<div class="field"><label class="label" for="rStage">Когда сорвалось</label><select class="input" id="rStage">' + opts(Store.STAGES, r.stage) + '</select></div>' +
      '<div class="field"><label class="label" for="rTitle">Что просили</label>' +
      '<input class="input" id="rTitle" placeholder="Например, бенто-торт" value="' + esc(r.title) + '"></div>' +
      '<div class="field-row"><div class="field"><label class="label" for="rAmount">На какую сумму, ₽</label>' +
      '<input class="input num-input" id="rAmount" type="number" inputmode="decimal" min="0" value="' + esc(r.amount) + '"></div>' +
      '<div class="field"><label class="label" for="rDate">Дата</label>' +
      '<input class="input" id="rDate" type="date" value="' + esc(r.date) + '"></div></div>' +
      '<div class="field"><label class="label" for="rClient">Клиент</label>' +
      '<input class="input" id="rClient" value="' + esc(r.client || '') + '"></div>' +
      '<div class="field"><label class="label" for="rChannel">Откуда пришёл</label><select class="input" id="rChannel">' + opts(Store.CHANNELS, r.channel) + '</select></div>' +
      '<div class="field"><label class="label" for="rComment">Комментарий</label>' +
      '<textarea class="input" id="rComment" rows="2">' + esc(r.comment || '') + '</textarea></div>' +
      '<div class="hint-text">Сумма — на сколько был бы заказ. Без неё видно, сколько заказов сорвалось, но не сколько денег.</div>' +
      '<div class="divider"></div><button class="btn-primary" id="rSave">Сохранить</button>' +
      (isNew ? '' : '<div style="height:8px"></div><button class="btn-ghost btn-danger" id="rDel">Удалить запись</button>'),
      function (root) {
        root.querySelector('#rSave').addEventListener('click', function () {
          var next = {
            id: r.id,
            title: root.querySelector('#rTitle').value.trim(),
            client: root.querySelector('#rClient').value.trim(),
            amount: nonneg(root.querySelector('#rAmount').value),
            date: root.querySelector('#rDate').value || today(),
            channel: root.querySelector('#rChannel').value,
            stage: root.querySelector('#rStage').value,
            reason: root.querySelector('#rReason').value,
            comment: root.querySelector('#rComment').value.trim()
          };
          if (!next.title) { toast('Впиши, что просили'); return; }
          if (!next.reason) { toast('Выбери причину — без неё аналитика не поймёт, что случилось'); return; }
          Store.upsertRefusal(next);
          closeSheet();
          if (onSaved) onSaved(next);
          render();
          if (!onSaved) toast('Записано');
        });
        var d = root.querySelector('#rDel');
        if (d) d.addEventListener('click', function () {
          askConfirm('Удалить запись?', 'Запись исчезнет и из аналитики отказов.', 'Удалить', function () {
            Store.removeRefusal(r.id); render();
          });
        });
      });
  }

  /* ============================================================
     ЭКРАН: ГЛАВНАЯ — деньги месяца и ближайшие заказы
     ============================================================ */
  var homeMonth = 'cur';             // cur | prev

  function monthKeyShift(iso, delta) {
    var p = iso.split('-'), y = Number(p[0]), m = Number(p[1]) - 1 + delta;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + (m < 9 ? '0' : '') + (m + 1);
  }

  /* Напоминание о копии: только для своих данных, если копии не было неделю */
  function backupDue() {
    var s = Store.state, st = s.settings;
    if (st.demo) return false;
    var own = s.recipes.length + s.orders.length + s.refusals.length + Store.purchases().length;
    if (own < 3) return false;
    if (!st.lastExport) return true;
    return Calc.daysBetween(st.lastExport, today()) >= 7;
  }

  function viewHome() {
    titleEl.textContent = 'Главная';
    var s = Store.state, t = today();
    var key = homeMonth === 'prev' ? monthKeyShift(t, -1) : t.slice(0, 7);
    var m = Calc.monthSummary(Store.moneyRows(), Store.purchases(), key);
    var active = Store.orders().filter(function (o) { return o.status !== 'done'; });
    var waiting = active.filter(function (o) { return Calc.monthKey(o.date) === key; })
      .reduce(function (sum, o) { return sum + (Number(o.amount) || 0); }, 0);

    var html = '';
    if (s.settings.demo) {
      html += '<div class="demo-note"><div><b>Себес</b> считает себестоимость и цену тортов, ведёт заказы и деньги. ' +
        '<b>Сейчас здесь примеры</b> – посмотри и очисти, когда будет удобно.</div>' +
        '<button class="btn-link" id="clearDemo">Очистить примеры</button></div>';
    }
    if (backupDue()) {
      var ago = s.settings.lastExport ? Calc.daysBetween(s.settings.lastExport, t) : 0;
      html += '<div class="warn-box" style="margin-bottom:12px"><b>Сохрани копию данных.</b> ' +
        (ago ? 'Последняя была ' + ago + ' ' + plural(ago, 'день', 'дня', 'дней') + ' назад. ' : 'Копии ещё не было. ') +
        'Если сменить телефон или очистить браузер, без копии записи пропадут.' +
        '<div style="margin-top:8px"><button class="btn-link" id="homeBackup">Сделать копию сейчас</button></div></div>';
    }

    html += segmented('homeSeg', [
      { key: 'cur', label: 'Этот месяц' },
      { key: 'prev', label: 'Прошлый месяц' }
    ], homeMonth);

    html += '<div class="card home-money">' +
      '<div class="row" id="homeRevenue"><div class="row-main"><div class="row-title">Пришло</div>' +
      '<div class="row-sub">' + (m.orders ? m.orders + ' ' + plural(m.orders, 'заказ выдан', 'заказа выдано', 'заказов выдано') : 'выданных заказов нет') + '</div></div>' +
      '<div class="row-right num num-md pos">' + Calc.money(m.revenue) + '</div><span class="chev">›</span></div>' +
      '<div class="row" id="homePurchases"><div class="row-main"><div class="row-title">Закупки</div>' +
      '<div class="row-sub">' + (m.purchaseCount ? m.purchaseCount + ' ' + plural(m.purchaseCount, 'запись', 'записи', 'записей') : 'пока не записаны') + '</div></div>' +
      '<div class="row-right num num-md">' + (m.purchases ? '−' : '') + Calc.money(m.purchases) + '</div><span class="chev">›</span></div>' +
      (m.tax ? '<div class="row" style="cursor:default"><div class="row-main"><div class="row-title">Налог</div></div>' +
        '<div class="row-right num num-md">−' + Calc.money(m.tax) + '</div></div>' : '') +
      '<div class="row home-left" style="cursor:default"><div class="row-main"><div class="row-title"><b>Осталось</b></div>' +
      '<div class="row-sub">пришло минус закупки' + (m.tax ? ' и налог' : '') + '</div></div>' +
      '<div class="row-right num num-lg' + (m.left < 0 ? ' neg' : '') + '">' + Calc.money(m.left) + '</div></div>' +
      '</div>';

    var notes = [];
    if (m.orders) notes.push('Себестоимость выданных заказов ' + Calc.money(m.cost) + ', из неё продукты ' + Calc.money(m.ingredients) +
      '. Это не то же, что закупки: часть продуктов лежит в запасе.');
    if (m.courier) notes.push('Курьерам ушло ' + Calc.money(m.courier) + ' – в «Пришло» эти деньги не входят.');
    if (waiting) notes.push('Ещё в работе заказов на ' + Calc.money(waiting) + '.');
    if (notes.length) html += '<div class="hint-text" style="padding:8px 2px 0">' + notes.join(' ') + '</div>';

    /* Ближайшие заказы */
    var soon = active.filter(function (o) { return o.date && Calc.daysBetween(t, o.date) <= 7; })
      .sort(function (a, b) { return (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')); });
    var overdue = soon.filter(function (o) { return o.date < t; }).length;
    var todayN = soon.filter(function (o) { return o.date === t; }).length;
    html += '<div class="spread section-title"><span>Ближайшие заказы</span><button class="btn-link" id="homeCal">Календарь</button></div>';
    if (overdue || todayN) {
      html += '<div class="hint-text" style="margin:-4px 2px 8px">' +
        (todayN ? '<b>Сегодня: ' + todayN + '</b>' : '') + (todayN && overdue ? ' · ' : '') +
        (overdue ? '<span class="neg">дата прошла: ' + overdue + '</span>' : '') + '</div>';
    }
    if (soon.length) {
      html += '<div class="card">' + soon.slice(0, 5).map(orderCard).join('') + '</div>';
      if (soon.length > 5) html += '<button class="btn-link" id="homeAll" style="margin-top:8px">Все заказы (' + active.length + ')</button>';
    } else {
      html += '<div class="card"><div class="row" style="cursor:default"><div class="row-main hint-text">' +
        (active.length ? 'На неделю вперёд заказов нет. Всего в работе: ' + active.length + '.' : 'Заказов в работе нет.') +
        '</div></div></div>';
    }

    html += '<div style="height:14px"></div><button class="btn-ghost" id="homeBuy">+ Записать закупку</button>' +
      '<div class="divider"></div>' +
      '<div class="card"><div class="row" id="homeProducts"><div class="row-main"><div class="row-title">Продукты и цены</div>' +
      '<div class="row-sub">' + s.ingredients.length + ' ' + plural(s.ingredients.length, 'продукт', 'продукта', 'продуктов') + '</div></div><span class="chev">›</span></div>' +
      '<div class="row" id="homeSettings"><div class="row-main"><div class="row-title">Настройки и копия данных</div></div><span class="chev">›</span></div></div>';

    viewEl.innerHTML = html;

    bindSegmented('homeSeg', function (k) { homeMonth = k; render(); });
    document.getElementById('homeRevenue').addEventListener('click', function () {
      analyticsTab = 'money'; moneyMonth = key; switchTab('analytics');
    });
    document.getElementById('homePurchases').addEventListener('click', function () { go('purchases', { month: key }); });
    document.getElementById('homeCal').addEventListener('click', function () {
      switchTab('orders');
    });
    var all = document.getElementById('homeAll');
    if (all) all.addEventListener('click', function () { scrollToList = true; switchTab('orders'); });
    viewEl.querySelectorAll('[data-ord]').forEach(function (b) {
      b.addEventListener('click', function () { orderSheet(b.dataset.ord); });
    });
    document.getElementById('homeBuy').addEventListener('click', function () { purchaseSheet(null); });
    document.getElementById('homeProducts').addEventListener('click', function () { go('ingredients'); });
    document.getElementById('homeSettings').addEventListener('click', function () { go('settings'); });
    var hb = document.getElementById('homeBackup');
    if (hb) hb.addEventListener('click', exportSheet);
    var cd = document.getElementById('clearDemo');
    if (cd) cd.addEventListener('click', function () {
      askConfirm('Очистить примеры?', 'Все примеры рецептов, продуктов, заказов, закупок и отказов будут удалены. Останется чистое приложение для твоих данных.',
        'Очистить', function () { Store.clearAll(); draft = null; render(); toast('Примеры удалены'); });
    });

    setMain('+ Новый заказ', function () { orderSheet(null); });
  }

  /* ---------------- закупки ---------------- */
  function purchaseSheet(id) {
    var src = id ? Store.purchases().filter(function (p) { return p.id === id; })[0] : null;
    var p = src ? JSON.parse(JSON.stringify(src)) : { date: today(), amount: '', note: '' };
    openSheet(src ? 'Закупка' : 'Записать закупку',
      '<div class="field"><label class="label" for="pAmount">Сумма чека, ₽</label>' +
      '<input class="input num-input" id="pAmount" type="number" inputmode="decimal" min="0" placeholder="0" value="' + esc(p.amount) + '"></div>' +
      '<div class="field"><label class="label" for="pNote">Что купили</label>' +
      '<input class="input" id="pNote" placeholder="Например, сливки и маскарпоне" maxlength="200" value="' + esc(p.note) + '"></div>' +
      '<div class="field"><label class="label" for="pDate">Дата</label>' +
      '<input class="input" id="pDate" type="date" value="' + esc(p.date) + '"></div>' +
      '<div class="hint-text">Закупки – это деньги, которые реально ушли. Цены продуктов в рецептах они не меняют.</div>' +
      '<div class="divider"></div><button class="btn-primary" id="pSave">Сохранить</button>' +
      (src ? '<div style="height:8px"></div><button class="btn-ghost btn-danger" id="pDel">Удалить</button>' : ''),
      function (root) {
        var a = root.querySelector('#pAmount');
        if (!src) setTimeout(function () { try { a.focus(); } catch (e) {} }, 50);
        root.querySelector('#pSave').addEventListener('click', function () {
          var amount = nonneg(a.value);
          if (!amount) { toast('Впиши сумму'); return; }
          p.amount = amount;
          p.note = root.querySelector('#pNote').value.trim();
          p.date = root.querySelector('#pDate').value || today();
          Store.upsertPurchase(p);
          closeSheet(); render(); toast('Закупка записана');
        });
        var d = root.querySelector('#pDel');
        if (d) d.addEventListener('click', function () {
          Store.removePurchase(p.id); closeSheet(); render(); toast('Удалено');
        });
      });
  }

  function viewPurchases(params) {
    titleEl.textContent = 'Закупки';
    var key = params.month || today().slice(0, 7);
    var keys = Array.from(new Set(Store.purchases().map(function (p) { return Calc.monthKey(p.date); }).concat([key]))).sort().reverse();
    var list = Store.purchases().filter(function (p) { return Calc.monthKey(p.date) === key; })
      .sort(function (a, b) { return b.date.localeCompare(a.date); });
    var total = list.reduce(function (sum, p) { return sum + p.amount; }, 0);
    var html = '<div class="chips">' + keys.map(function (k) {
      return '<button class="chip' + (k === key ? ' active' : '') + '" data-m="' + esc(k) + '">' + esc(Calc.monthLabel(k)) + '</button>';
    }).join('') + '</div>';
    html += '<div class="stat-card"><div class="stat-label">Закупки за ' + esc(Calc.monthLabel(key)) + '</div>' +
      '<div class="stat-value num num-lg">' + Calc.money(total) + '</div></div><div style="height:12px"></div>';
    html += list.length
      ? '<div class="card">' + list.map(function (p) {
          return '<div class="row" data-pur="' + esc(p.id) + '"><div class="row-main"><div class="row-title clamp2">' +
            esc(p.note || 'Закупка') + '</div><div class="row-sub">' + fmtDate(p.date) + '</div></div>' +
            '<div class="row-right num num-md">' + Calc.money(p.amount) + '</div><span class="chev">›</span></div>';
        }).join('') + '</div>'
      : emptyState('🧾', 'Закупок нет', 'Записывай сумму чека после похода в магазин – тогда на главной будет видно, сколько денег реально осталось.');
    viewEl.innerHTML = html;
    viewEl.querySelectorAll('[data-m]').forEach(function (b) {
      b.addEventListener('click', function () { current().params.month = b.dataset.m; render(); });
    });
    viewEl.querySelectorAll('[data-pur]').forEach(function (b) {
      b.addEventListener('click', function () { purchaseSheet(b.dataset.pur); });
    });
    setMain('+ Записать закупку', function () { purchaseSheet(null); });
  }

  /* ============================================================
     ЭКРАН: НАСТРОЙКИ
     ============================================================ */
  function viewSettings() {
    titleEl.textContent = 'Настройки и данные';
    var s = Store.state, st = s.settings;
    var snaps = Store.autoSnapshots();
    viewEl.innerHTML =
      '<div class="section-title">Для новых расчётов</div>' +
      '<div class="field"><label class="label" for="setRate">Цена твоего часа, ₽</label>' +
      '<input class="input num-input" id="setRate" type="number" inputmode="numeric" min="0" value="' + esc(st.rate) + '"></div>' +
      '<div class="field"><label class="label" for="setMargin">Маржа, %</label>' +
      '<input class="input num-input" id="setMargin" type="number" inputmode="decimal" min="0" max="95" value="' + esc(st.margin) + '"></div>' +
      '<div class="hint-text">Подставляются в каждый новый рецепт, в самом рецепте их можно поменять.</div>' +

      '<div class="section-title">Налог самозанятого</div>' +
      switchRow('setTax', 'Учитывать налог в цене', 'Цена поднимается так, чтобы после налога на руках осталось столько же', st.taxOn,
        'Цены и заработок считаются без налога') +
      '<div class="field-row" style="margin-top:12px"><div class="field"><label class="label" for="setTaxP">С частных лиц, %</label>' +
      '<input class="input num-input" id="setTaxP" type="number" inputmode="decimal" min="0" max="50" value="' + esc(st.taxPerson) + '"></div>' +
      '<div class="field"><label class="label" for="setTaxL">С компаний и ИП, %</label>' +
      '<input class="input num-input" id="setTaxL" type="number" inputmode="decimal" min="0" max="50" value="' + esc(st.taxLegal) + '"></div></div>' +
      '<div class="hint-text">Для самозанятых 4% и 6%. Ставка с компаний применяется к заказам, где включено «Заказ от компании или ИП».</div>' +

      '<div class="divider"></div>' +
      '<div class="section-title">Данные</div>' +
      '<div class="warn-box">Всё хранится только в этом браузере. Очистка истории сайта или смена телефона сотрут записи. ' +
      'Раз в неделю отправляй копию себе.' + (st.lastExport ? ' Последняя копия: ' + fmtDate(st.lastExport) + '.' : ' Копии ещё не было.') + '</div>' +
      '<div style="height:10px"></div>' +
      '<button class="btn-ghost" id="btnExport">Сделать копию данных</button>' +
      '<div style="height:8px"></div><button class="btn-ghost" id="btnImport">Восстановить из копии</button>' +
      (snaps.length ? '<div class="section-title">Автокопии в этом браузере</div><div class="card">' + snaps.map(function (x) {
        return '<div class="row" data-snap="' + esc(x.date) + '"><div class="row-main"><div class="row-title">' + fmtDate(x.date) + '</div>' +
          '<div class="row-sub">' + (x.broken ? 'повреждена' : x.recipes + ' ' + plural(x.recipes, 'рецепт', 'рецепта', 'рецептов') + ', ' +
          x.orders + ' ' + plural(x.orders, 'заказ', 'заказа', 'заказов')) + '</div></div><span class="chev">›</span></div>';
      }).join('') + '</div><div class="hint-text" style="margin-top:6px">Делаются сами раз в день, хранятся последние 5. Спасут от случайной ошибки, но не от смены телефона.</div>' : '') +
      '<div style="height:8px"></div><button class="btn-ghost" id="btnDemo">Загрузить примеры</button>' +
      '<div style="height:8px"></div><button class="btn-ghost btn-danger" id="btnClear">Удалить всё и начать с нуля</button>' +
      '<div class="divider"></div>' +
      '<div class="hint-text">Рецептов: ' + s.recipes.length + ' · продуктов: ' + s.ingredients.length +
      ' · заказов: ' + Store.orders().length + ' (в архиве ' + Store.archived().length + ')' +
      ' · не состоялись: ' + s.refusals.length + '<br>Версия 0.5.5</div>';

    function bindNum(id, key, lo, hi) {
      document.getElementById(id).addEventListener('change', function () {
        var v = Math.min(hi, Math.max(lo, nonneg(this.value)));
        this.value = v;
        Store.setSetting(key, v); toast('Сохранено');
      });
    }
    bindNum('setRate', 'rate', 0, 100000);
    bindNum('setMargin', 'margin', 0, 95);
    bindNum('setTaxP', 'taxPerson', 0, 50);
    bindNum('setTaxL', 'taxLegal', 0, 50);
    document.getElementById('setTax').addEventListener('change', function () {
      Store.setSetting('taxOn', this.checked); toast(this.checked ? 'Налог учитывается' : 'Налог не учитывается');
    });
    document.getElementById('btnExport').addEventListener('click', exportSheet);
    viewEl.querySelectorAll('[data-snap]').forEach(function (b) {
      b.addEventListener('click', function () {
        askConfirm('Вернуть данные на ' + fmtDate(b.dataset.snap) + '?',
          'Текущие данные заменятся автокопией. Перед этим их копия отложится в браузере.', 'Вернуть', function () {
            var res = Store.restoreSnapshot(b.dataset.snap);
            if (!res.ok) { toast(res.error, { error: true }); return; }
            draft = null; stack = [{ name: 'home', params: {} }]; render(); toast('Данные возвращены');
          });
      });
    });
    document.getElementById('btnImport').addEventListener('click', importSheet);
    document.getElementById('btnDemo').addEventListener('click', function () {
      askConfirm('Загрузить примеры?', 'Твои рецепты, заказы и отказы будут заменены примерами. Сначала сделай копию, если они нужны.',
        'Заменить примерами', function () { Store.reset(); draft = null; render(); toast('Примеры загружены'); });
    });
    document.getElementById('btnClear').addEventListener('click', function () {
      askConfirm('Удалить всё?', 'Все рецепты, продукты, заказы и отказы будут стёрты. Вернуть их можно только из копии.',
        'Удалить всё', function () { Store.clearAll(); draft = null; render(); toast('Очищено'); });
    });
    setMain('', null);
  }

  function markExported() { Store.setSetting('lastExport', today()); }

  function exportSheet() {
    var json = Store.exportJSON();
    var name = 'sebes-' + today() + '.json';
    var file = null;
    try { file = new File([json], name, { type: 'application/json' }); } catch (e) {}
    var noFiles = !!window.__NO_FILES;          // окно просмотра без скачивания
    var canShare = !noFiles && !!(file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
    openSheet('Копия данных',
      '<p class="hint-text" style="margin-top:0">Надёжнее всего отправить файл себе в Telegram («Избранное») или на почту. ' +
      'На новом телефоне: Настройки → «Восстановить из копии».</p>' +
      (canShare ? '<button class="btn-primary" id="exShare">Отправить файл себе</button><div style="height:8px"></div>' : '') +
      (noFiles ? '' : '<button class="' + (canShare ? 'btn-ghost' : 'btn-primary') + '" id="exFile">Сохранить файлом</button>' +
      '<div style="height:8px"></div>') +
      '<button class="' + (noFiles ? 'btn-primary' : 'btn-ghost') + '" id="exCopy">Скопировать текстом</button>' +
      '<textarea class="input mono" id="exText" readonly rows="5" style="margin-top:10px"></textarea>',
      function (root) {
        var ta = root.querySelector('#exText');
        ta.value = json;
        function done(msg) { markExported(); toast(msg); }
        var sh = root.querySelector('#exShare');
        if (sh) sh.addEventListener('click', function () {
          navigator.share({ files: [file], title: 'Копия Себеса' })
            .then(function () { done('Копия отправлена'); }, function () {});
        });
        root.querySelector('#exCopy').addEventListener('click', function () {
          function manual() { ta.focus(); ta.select(); toast('Текст выделен — скопируй его'); markExported(); }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(json).then(function () { done('Скопировано. Сохрани текст в заметки или отправь себе'); }, manual);
          } else manual();
        });
        var ef = root.querySelector('#exFile');
        if (ef) ef.addEventListener('click', function () {
          try {
            var blob = new Blob([json], { type: 'application/json' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
            done('Файл сохранён');
          } catch (e) { toast('Сохранить файлом здесь нельзя, скопируй текст'); }
        });
      });
  }

  function importSheet() {
    openSheet('Восстановить из копии',
      '<p class="hint-text" style="margin-top:0">Вставь сохранённый текст копии. Текущие данные заменятся, но перед этим их копия отложится в браузере.</p>' +
      '<label class="btn-ghost" style="display:block;text-align:center;cursor:pointer">Выбрать файл копии' +
      '<input type="file" id="imFile" accept=".json,application/json,text/plain" hidden></label>' +
      '<div class="hint-text" style="margin:10px 0 6px">или вставь текст копии:</div>' +
      '<textarea class="input mono" id="imText" rows="6" placeholder=\'{"version":1, ...}\'></textarea>' +
      '<div class="divider"></div><button class="btn-primary" id="imGo">Восстановить</button>',
      function (root) {
        root.querySelector('#imFile').addEventListener('change', function () {
          var f = this.files && this.files[0];
          if (!f) return;
          var rd = new FileReader();
          rd.onload = function () { root.querySelector('#imText').value = String(rd.result || ''); toast('Файл прочитан, нажми «Восстановить»'); };
          rd.onerror = function () { toast('Файл не читается', { error: true }); };
          rd.readAsText(f);
        });
        root.querySelector('#imGo').addEventListener('click', function () {
          var raw = root.querySelector('#imText').value.trim();
          if (!raw) { toast('Вставь текст копии'); return; }
          var res = Store.importJSON(raw);
          if (!res.ok) { toast(res.error, { ms: 4000 }); return; }
          closeSheet(); draft = null;
          stack = [{ name: 'home', params: {} }];
          render();
          toast('Восстановлено: ' + res.counts.recipes + ' ' + plural(res.counts.recipes, 'рецепт', 'рецепта', 'рецептов') +
            ', ' + res.counts.orders + ' ' + plural(res.counts.orders, 'заказ', 'заказа', 'заказов'));
        });
      });
  }

  /* ============================================================
     РОУТЕР
     ============================================================ */
  var SCREENS = {
    home: viewHome,
    purchases: viewPurchases,
    recipes: viewRecipes,
    recipe: viewRecipe,
    ingredients: viewIngredients,
    orders: viewOrders,
    analytics: viewAnalytics,
    refusals: viewRefusals,
    archive: viewArchive,
    settings: viewSettings
  };
  var TAB_OF = { home: 'home', purchases: 'home', settings: 'home',
                 recipes: 'recipes', recipe: 'recipes', ingredients: 'recipes',
                 orders: 'orders', archive: 'orders',
                 analytics: 'analytics', refusals: 'analytics' };

  function render() {
    var cur = current();
    if (Date.now() > toastLockUntil) { toastEl.hidden = true; clearTimeout(toast._t); }
    backBtn.hidden = stack.length <= 1;
    if (tg) { if (stack.length > 1) tg.BackButton.show(); else tg.BackButton.hide(); }
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.tab === TAB_OF[stack[0].name]);
    });
    window.scrollTo(0, 0);
    try {
      (SCREENS[cur.name] || viewHome)(cur.params || {});
      /* Выбранный чип всегда в видимой части ленты */
      viewEl.querySelectorAll('.chips .chip.active').forEach(function (c) {
        var row = c.parentNode;
        if (c.offsetLeft + c.offsetWidth > row.scrollLeft + row.clientWidth || c.offsetLeft < row.scrollLeft) {
          row.scrollLeft = Math.max(0, c.offsetLeft - 16);
        }
      });
    } catch (e) {
      /* Ошибка на одном экране не должна оставлять пустую страницу */
      if (window.console) console.error(e);
      viewEl.innerHTML = emptyState('⚠️', 'Этот экран не открылся',
        'Что-то в данных пошло не так. Остальные вкладки работают. Если повторяется — сделай копию данных в настройках и напиши разработчику.');
      setMain('', null);
    }
  }

  /* ---------------- старт ---------------- */
  applyTheme(Store.state.settings.theme || 'auto');

  function attachTelegram() {
    var w = window.Telegram && window.Telegram.WebApp;
    if (!w || !w.initData) return;            // пустой initData = не Telegram
    tg = w;
    document.body.classList.add('tg');
    try {
      tg.ready(); tg.expand();
      tg.BackButton.onClick(back);
      tg.MainButton.onClick(runMain);
      if (tg.colorScheme) applyTheme(tg.colorScheme);
    } catch (e) {}
    render();
  }

  /* SDK грузится асинхронно и только внутри Telegram: если сервер Telegram
     недоступен, страница не ждёт его и не зависает на загрузке. */
  if (launchedFromTelegram()) {
    var sdk = document.createElement('script');
    sdk.src = 'https://telegram.org/js/telegram-web-app.js';
    sdk.async = true;
    sdk.onload = attachTelegram;
    document.head.appendChild(sdk);
  }

  render();
  if (Store.notice) { toast(Store.notice, { force: true, ms: 7000 }); Store.clearNotice(); }
  try { Store.requestPersist(); } catch (e) {}
  window.__app = { go: go, render: render, Store: Store, Calc: Calc, effectiveTheme: effectiveTheme };
})();
