/* Интеграционный прогон интерфейса в jsdom.
   Числа на экранах сверяются с Calc, плюс проверки на баги из аудита 0.3. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

let failed = 0;
function ok(name, cond, extra) {
  if (!cond) failed++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (extra !== undefined ? '  ' + extra : ''));
}

function boot(preset) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.com/', pretendToBeVisual: true });
  const w = dom.window;
  w.scrollTo = () => {};
  w.confirm = () => { throw new Error('нативный confirm вызван'); };
  if (preset) preset(w);
  for (const f of ['calc.js', 'store.js', 'app.js']) w.eval(fs.readFileSync(path.join(dir, f), 'utf8'));
  const doc = w.document;
  const $ = (s) => doc.querySelector(s);
  const $$ = (s) => Array.from(doc.querySelectorAll(s));
  /* неразрывные пробелы не трогаем: суммы на экране должны совпадать с Calc.money буква в букву */
  const text = () => $('#view').textContent.replace(/[ \t\n\r]+/g, ' ');
  const sheetText = () => $('#sheetBody').textContent.replace(/[ \t\n\r]+/g, ' ');
  const click = (el) => el.dispatchEvent(new w.Event('click', { bubbles: true }));
  const input = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const change = (el, v) => { if (v !== undefined) { if (el.type === 'checkbox') el.checked = v; else el.value = v; } el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  return { w, doc, $, $$, text, sheetText, click, input, change, Calc: w.Calc, Store: w.Store, app: w.__app };
}

let t = boot();
let { $, $$, text, sheetText, click, input, change, Calc, Store, app, doc } = t;

console.log('\n0. Главная');
ok('Старт на главной', $('#screenTitle').textContent === 'Главная');
ok('Вкладка «Главная» подсвечена', $('[data-tab="home"]').classList.contains('active'));
ok('Вкладки «Продукты» больше нет', !$('[data-tab="ingredients"]'));
ok('Плашка про примеры и что это за приложение', text().includes('Сейчас здесь примеры') && text().includes('считает себестоимость'));
{
  const key = Calc.localISO().slice(0, 7);
  const m = Calc.monthSummary(Store.moneyRows(), Store.purchases(), key);
  ok('Закупки месяца на экране', text().includes(Calc.money(m.purchases)), Calc.money(m.purchases));
  ok('«Осталось» = пришло − закупки − налог', text().includes(Calc.money(m.left)), Calc.money(m.left));
  ok('Ближайший заказ сегодня виден', text().includes('Сегодня: 1') && $$('[data-ord]').length >= 1);
  click($('[data-seg="prev"]'));
  const pk = Calc.monthKey(Calc.addDays(key + '-01', -1));
  const pm = Calc.monthSummary(Store.moneyRows(), Store.purchases(), pk);
  ok('Прошлый месяц: пришло', pm.revenue > 0 && text().includes(Calc.money(pm.revenue)), Calc.money(pm.revenue));
  ok('Прошлый месяц: осталось', text().includes(Calc.money(pm.left)), Calc.money(pm.left));
  ok('Пояснение про себестоимость и закупки', text().includes('Себестоимость выданных заказов ' + Calc.money(pm.cost)));
  click($('#homePurchases'));
  ok('Экран закупок', $('#screenTitle').textContent === 'Закупки' && $$('[data-pur]').length >= 1);
  click($('#mainButton'));
  input($('#pAmount'), '1234'); input($('#pNote'), 'Тест <b>');
  click($('#pSave'));
  ok('Закупка записалась', Store.purchases().some((p) => p.amount === 1234 && p.note === 'Тест <b>'));
  ok('Текст закупки экранирован', !$('#view').innerHTML.includes('Тест <b>'));
  click($('[data-tab="home"]'));
  ok('Нет напоминания о копии на примерах', !text().includes('Сохрани копию данных'));
}

console.log('\n1. Список рецептов');
click($('[data-tab="recipes"]'));
ok('Заголовок «Рецепты»', $('#screenTitle').textContent === 'Рецепты');
ok('Три рецепта', $$('[data-open]').length === 3);
ok('Ссылка «Продукты и цены»', !!$('#toProducts'));
ok('В рецептах нет блока про сорвавшиеся заказы', !text().includes('Упущено') && !$('[data-goto="refusals"]'));
const velvet = Store.getRecipe('r_velvet');
const vc = Store.computeRecipe(velvet);
ok('Себестоимость в списке = Calc', text().includes(Calc.money(vc.cost)), Calc.money(vc.cost));
ok('Цена в списке = Calc', text().includes(Calc.money(vc.price)), Calc.money(vc.price));
ok('У цены есть подпись', text().includes('цена за 1,1'));
const etalon = Store.computeRecipe(Object.assign({}, velvet, { items: velvet.items.filter((i) => i.ingredientId !== 'i_berry' && i.ingredientId !== 'i_box') }), { taxRate: 0 });
ok('Эталон без ягод, коробки и налога: 2 597 ₽', Math.abs(etalon.cost - 2596.99) < 0.01, etalon.cost.toFixed(2));
ok('Эталон без ягод, коробки и налога: 5 771 ₽', Math.abs(etalon.price - 5771.09) < 0.01, etalon.price.toFixed(2));
ok('Налог 4% включён по умолчанию', Math.abs(vc.price - vc.priceNet / 0.96) < 0.01);

console.log('\n2. Экран расчёта');
app.go('recipe', { id: 'r_velvet' });
ok('Заголовок', $('#screenTitle').textContent === 'Расчёт себестоимости');
ok('Себестоимость', text().includes(Calc.money(vc.cost)));
ok('Цена для клиента', text().includes(Calc.money(vc.price)));
ok('Налог отдельной строкой', text().includes('налог 4%') && text().includes(Calc.money(vc.tax)));
ok('«Ты получишь»', text().includes(Calc.money(vc.labor + vc.profit)));
ok('Маржа объяснена через наценку', text().includes('наценка 122%'));
ok('Цена за кг, а не за упаковку', text().includes('180 мл × 850 ₽/л') || text().includes('180 мл × 850 ₽/л'));
ok('Упёк показан', /упёк и потери \d/.test(text()));

console.log('\n3. Поле маржи не теряет фокус');
const fm = $('#fMargin');
fm.focus();
input(fm, '4');
ok('После первой цифры фокус на том же поле', doc.activeElement === fm);
input(fm, '40');
const v40 = Store.computeRecipe(Object.assign({}, velvet, { margin: 40 }));
ok('Итог пересчитался под 40%', $('#totalsBox').textContent.includes(Calc.money(v40.price)), Calc.money(v40.price));
ok('Поле то же самое', $('#fMargin') === fm);
input(fm, '');
ok('Пустое поле не превращается в 0', fm.value === '');
input(fm, '150');
ok('Маржа 150 ограничена 95', /Маржа 95%/.test($('#totalsBox').textContent));

console.log('\n4. Уход с несохранённым рецептом');
click($('#btnBack'));
ok('Спросили, сохранить ли', !$('#sheet').hidden && sheetText().includes('Сохранить изменения?'));
click($('#lvDrop'));
ok('Вернулись к списку', $('#screenTitle').textContent === 'Рецепты');
app.go('recipe', { id: 'r_velvet' });
ok('Черновик сброшен: маржа снова 55', $('#fMargin').value === '55');

console.log('\n5. Выход больше закладки');
input($('#fYield'), '2');
ok('Предупреждение «так не бывает»', $('#totalsBox').textContent.includes('Так не бывает'));
input($('#fYield'), '1.1');
click($('[data-tab="recipes"]'));
if (!$('#sheet').hidden) click($('#lvDrop'));

console.log('\n6. Продукт: цена за единицу и защита единиц');
click($('#toProducts'));
ok('Заголовок «Продукты и цены»', $('#screenTitle').textContent === 'Продукты и цены');
ok('Масло: цена за кг, а не за пачку', text().includes(Calc.money(210 / 180 * 1000) + '/кг'), Calc.money(210 / 180 * 1000) + '/кг');
ok('И цена упаковки', text().includes('210 ₽ за 180 г'));
click($('[data-ing="i_masc"]'));
change($('#iUnit'), 'шт');
click($('#iSave'));
ok('Смену кг→шт у используемого продукта запретили', Store.ingredientsById().i_masc.unit === 'кг');
ok('Себестоимость не раздулась', Math.abs(Store.computeRecipe(Store.getRecipe('r_velvet')).cost - vc.cost) < 0.01);
change($('#iUnit'), 'г'); input($('#iAmt'), '500'); input($('#iPrice'), '650');
click($('#iSave'));
ok('Смена кг→г разрешена', Store.ingredientsById().i_masc.unit === 'г');
ok('Дата цены стала сегодняшней', Store.ingredientsById().i_masc.updated === Calc.localISO());

console.log('\n7. Продукт прямо из рецепта');
app.go('recipe', { id: null });
click($('#addItem'));
click($('#sNewIng'));
ok('Открылась форма продукта', !!$('#iName'));
input($('#iName'), 'Молоко 3,2%'); input($('#iPrice'), '95'); input($('#iAmt'), '1'); change($('#iUnit'), 'л');
click($('#iSave'));
ok('Вернулись в выбор продукта', !!$('#sIng'));
ok('Новый продукт выбран', $('#sIng').selectedOptions[0].textContent.includes('Молоко'));
ok('Единица подставилась мл', $('#sUnit').value === 'мл');
input($('#sQty'), '500'); click($('#sSave'));
ok('Молоко в рецепте', text().includes('Молоко'));
click($('#btnBack')); click($('#lvDrop'));

console.log('\n8. Заказ: сумма следует за объёмом, налог, доставка');
click($('[data-tab="orders"]'));
click($('#mainButton'));
change($('#oRecipe'), 'r_velvet');
ok('Поле объёма', !!$('#oQty'));
ok('Подставлен выход рецепта', Number($('#oQty').value) === 1.1);
const r1 = Store.computeRecipe(Store.getRecipe('r_velvet'));
ok('Сумма подставилась', Number($('#oAmount').value) === Math.round(r1.price), $('#oAmount').value);
input($('#oQty'), '2.2');
const r2 = Store.computeRecipe(Store.getRecipe('r_velvet'), { scale: 2 });
ok('Сумма пересчиталась при смене объёма', Number($('#oAmount').value) === Math.round(r2.price), $('#oAmount').value);
const r3 = r2;
ok('Переключателя декора больше нет', !$('#oDecor'));
ok('Коробка не удвоилась при ×2', Math.abs(r2.ingredients - (r1.ingredients * 2 - 120)) < 0.01);
const sub = () => $('#oFulfilHint').textContent;
ok('Три способа выдачи', $$('#oFulfil [data-seg]').length === 3);
ok('По умолчанию самовывоз', sub().includes('забирает сам') && !$('#oFee'));
click($('#oFulfil [data-seg="delivery"]'));
ok('Подпись доставки сменилась', sub().includes('остаётся тебе') && !!$('#oFee'));
input($('#oFee'), '500');
ok('Доставка прибавилась к сумме', Number($('#oAmount').value) === Math.round(r3.price) + 500);
ok('Итого клиенту', $('#oMoney').textContent.includes(Calc.money(Math.round(r3.price) + 500)));
change($('#oLegal'), true);
const r4 = Store.computeRecipe(Store.getRecipe('r_velvet'), { scale: 2, taxRate: 6 });
ok('Компания: налог 6%', Number($('#oAmount').value) === Math.round(r4.price) + 500);
input($('#oAmount'), '3000');
ok('Убыток подсвечен', $('#oMoney').textContent.includes('в убыток'));
input($('#oQty'), '1.1');
ok('После ручной суммы объём её не перезаписывает', $('#oAmount').value === '3000');
click($('#oUseRec'));
ok('Кнопка «Поставить рекомендуемую»', Number($('#oAmount').value) > 3000);
$('#oTitle').value = 'Тест заказа';
$('#oDate').value = '';
click($('#oSave'));
ok('Без даты не сохраняется', !Store.state.orders.some(o => o.title === 'Тест заказа'));
$('#oDate').value = Calc.addDays(Calc.localISO(), 3);
click($('#oSave'));
const saved = Store.state.orders.find(o => o.title === 'Тест заказа');
ok('Сохранён', !!saved);
ok('С налогом для компании', saved && saved.legal === true);
ok('С доставкой 500', saved && saved.deliveryFee === 500);

console.log('\n9. «Не состоялся» из карточки заказа');
const before = Store.state.refusals.length;
click($('[data-ord="' + saved.id + '"]'));
click($('#oFail'));
ok('Открылась форма несостоявшегося', !!$('#rReason'));
ok('Сумма перенеслась', Number($('#rAmount').value) === saved.amount);
click($('#rSave'));
ok('Без причины не сохраняется', Store.state.refusals.length === before);
change($('#rReason'), 'Дорого, не устроила цена');
click($('#rSave'));
ok('Запись добавлена', Store.state.refusals.length === before + 1);
ok('Заказ убран из списка', !Store.state.orders.some(o => o.id === saved.id));

console.log('\n10. Архив сохраняет правки формы');
const med = Store.orders().find(o => o.title === 'Медовик 3 кг');
click($('[data-ord="' + med.id + '"]'));
input($('#oAmount'), '13000');
click($('#oArch'));
const medAfter = Store.state.orders.find(o => o.id === med.id);
ok('Ушёл в архив', medAfter.archived === true);
ok('Новая сумма сохранилась', medAfter.amount === 13000);
ok('Объём не потерялся', medAfter.qty === 3);

console.log('\n11. Себестоимость выданных заказов зафиксирована');
const sepRows = Store.moneyRows();
const totalBefore = sepRows.reduce((a, r) => a + r.ingredients, 0);
const choco = Store.ingredientsById().i_choco;
Store.upsertIngredient(Object.assign({}, choco, { price: choco.price * 3 }));
const totalAfter = Store.moneyRows().reduce((a, r) => a + r.ingredients, 0);
ok('Подорожание шоколада не меняет прошлые месяцы', Math.abs(totalAfter - totalBefore) < 0.01);
ok('Но меняет цену в рецепте', Store.computeRecipe(Store.getRecipe('r_velvet')).cost > vc.cost);
Store.upsertIngredient(choco);

console.log('\n12. Аналитика: деньги');
app.go('analytics');
ok('Деньги открываются на последнем месяце', /Заработано за [а-я]+ \d{4}/.test(text()));
click($('[data-mm="all"]'));
const months = Calc.monthlyRollup(Store.moneyRows());
const earned = months.reduce((a, m) => a + m.earned, 0);
ok('Главная цифра «Заработано»', text().includes('Заработано') && text().includes(Calc.money(earned)), Calc.money(earned));
ok('Заработок в час', text().includes('в час'));
ok('Налог отдельно', text().includes('Налог'));
ok('График есть', !!$('.chart-wrap svg'));
ok('Пять рядов в легенде', $$('.legend-item').length === 5);
ok('График тянется по ширине', $('.chart-wrap svg').getAttribute('width') === '100%');
ok('Предупреждение о заказе без рецепта', text().includes('без рецепта'));
const chips = $$('[data-mm]');
ok('Можно выбрать месяц', chips.length >= 2);
click(chips[1]);
ok('Выбран месяц', /Заработано за [а-я]+ \d{4}/.test(text()));


console.log('\n12б. Заказ: сколько получишь, группы по срокам');
click($('[data-tab="orders"]'));
ok('Группа «Сегодня»', text().includes('Сегодня ·'));
ok('Кнопка «+ Не состоялся» наверху', !!$('#quickFail'));
click($('#mainButton'));
change($('#oRecipe'), 'r_cheese');
ok('«Тебе на руки» в заказе', $('#oMoney').textContent.includes('Тебе на руки'));
click($('#btnBack'));
app.go('analytics');

console.log('\n13. Аналитика: отказы');
click($$('#anSeg [data-seg]')[1]);
ok('Главная причина наверху', text().indexOf('Главная причина') < text().indexOf('Почему не купили'));
const fills = $$('.bar-fill').map(b => parseFloat(b.style.width));
ok('Полоски имеют ширину', fills.length > 0 && fills.some(v => v > 0), fills.slice(0, 4).join(','));
ok('Каналы полными названиями', !/\bINST\b|\bTELE\b/.test(text()));

console.log('\n14. Аналитика: отзывы');
click($$('#anSeg [data-seg]')[2]);
ok('Средняя оценка', text().includes('Средняя оценка'));
ok('Склонение «оценки»', !/\b[234] оценок\b/.test(text()));

console.log('\n15. Календарь');
click($('[data-tab="orders"]'));
ok('Календарь сверху, список под ним', !$('#ordSeg') && $('.cal-head') && $('#ordList') && ($('.cal-head').compareDocumentPosition($('#ordList')) & 4) > 0);
ok('Список виден вместе с календарём', $$('#view [data-ord]').length >= 1 && $$('[data-ost]').length > 1);
ok('Сегодня есть заказ', !!$('.cal-day.today.has'));
{
  const iso = Calc.localISO();
  ok('Под сегодняшним днём точка заказа', $$('.cal-day.today .cal-dot').length === 1);
  click($('.cal-day.today'));
  ok('Тап по дню открывает окно дня', !$('#sheet').hidden && sheetText().includes('Сегодня, '));
  ok('В окне подпись, чей заказ', sheetText().includes('Красный бархат') && sheetText().includes('Красный бархат · Марина') && sheetText().includes('Сегодня 1 заказ на'));
  ok('Заказ открывается из окна дня', (() => { click($('#sheetBody [data-ord]')); return !!$('#oTitle') && $('#oTitle').value === 'Красный бархат'; })());
  click($('#btnBack'));
  Store.upsertOrder({ title: 'Второй', client: 'Оля', amount: 1000, date: iso, time: '09:00', status: 'done' });
  Store.upsertOrder({ title: 'Третий', amount: 2000, date: iso, status: 'new' });
  app.render();
  ok('Три заказа – три точки, выданный бледный', $$('.cal-day.today .cal-dot').length === 3 && $$('.cal-day.today .cal-dot.done').length === 1);
  click($('.cal-day.today'));
  ok('Сводка дня', sheetText().includes('Сегодня 3 заказа на') && sheetText().includes('осталось выдать 2'));
  const lines = $$('#sheetBody .day-line').map((x) => x.textContent);
  ok('Заказы по времени, без времени в конце', lines[0].startsWith('09:00') && lines[2].startsWith('время не указано'), lines.join(' | '));
  click($('#btnBack'));
  const empty = $$('.cal-day:not(.has):not(.out)')[0];
  click(empty);
  ok('Пустой день: «заказов нет»', sheetText().includes('заказов нет') && !!$('#dayAdd'));
  click($('#dayAdd'));
  ok('Новый заказ с датой выбранного дня', $('#oDate').value === empty.dataset.day);
  click($('#btnBack'));
}
const out = $('.cal-day.out');
if (out) { const iso = out.dataset.day; click(out); ok('Тап по дню соседнего месяца переключает месяц', $('.cal-day.sel') && $('.cal-day.sel').dataset.day === iso && !$('.cal-day.sel').classList.contains('out')); click($('#btnBack')); }

console.log('\n16. Шторка и главная кнопка');
click($('#mainButton'));
ok('Шторка открыта', !$('#sheet').hidden);
const sheetsBefore = $('#sheetBody').innerHTML;
click($('#mainButton'));
ok('Главная кнопка не действует при открытой шторке', $('#sheetBody').innerHTML === sheetsBefore);
$('#sheetBody').scrollTop = 500;
click($('#btnBack'));
ok('«Назад» закрывает шторку', $('#sheet').hidden);

console.log('\n17. Пустые состояния');
Store.clearAll(); app.render();
click($('[data-tab="recipes"]'));
ok('Рецепты', text().includes('Пока ни одного рецепта'));
ok('Плашки примеров нет', !text().includes('Сейчас здесь примеры'));
app.go('ingredients'); ok('Продукты', text().includes('Справочник пуст'));
click($('[data-tab="home"]')); ok('Главная пустая не падает', text().includes('Заказов в работе нет') && text().includes('пока не записаны'));
click($('[data-tab="orders"]')); ok('Заказы', text().includes('Заказов пока нет'));
click($('[data-tab="analytics"]')); click($$('#anSeg [data-seg]')[0]); ok('Деньги', text().includes('Выданных заказов нет'));
app.go('refusals'); ok('Не состоялись', text().includes('Пока пусто'));

console.log('\n18. Импорт: очистка и защита от чужого кода');
Store.reset(); app.render();
const evil = JSON.stringify({
  version: 1,
  ingredients: [{ id: 'x"><img id=pwn1 src=x>', name: 'Мука', price: 70, amount: '1<img id=pwn2>', unit: 'кг' },
                { id: 'bad', name: 'Странное', price: 1, amount: 1, unit: 'kg' }],
  recipes: [{ id: 'r1', name: 'Торт', items: [{ ingredientId: 'x', qty: 1, unit: 'кг' }] }],
  orders: [{ id: 'o1"><img id=pwn3>', title: 'Заказ', amount: 100, date: '<img id=pwn4 src=x>', status: 'done' }],
  refusals: []
});
let res = Store.importJSON(evil);
ok('Импорт принят', res.ok);
ok('Продукт с неизвестной единицей отброшен', Store.state.ingredients.length === 1);
ok('Рецепт без труда не ломает приложение', Array.isArray(Store.state.recipes[0].labor));
for (const tab of ['home', 'recipes', 'orders', 'analytics']) { click($('[data-tab="' + tab + '"]')); }
app.go('ingredients');
click($('[data-tab="analytics"]'));
click($$('#anSeg [data-seg]')[2]);
ok('Чужой код не попал на страницу', !doc.querySelector('[id^="pwn"]'));
ok('Неполная копия отклонена', Store.importJSON('{"version":1}').ok === false);
ok('Чужая версия отклонена', Store.importJSON('{"version":2,"recipes":[]}').ok === false);
ok('Битый текст отклонён', Store.importJSON('{oops').ok === false);

console.log('\n19. Нечитаемые сохранённые данные не затираются');
t = boot((w) => { w.localStorage.setItem('sebes.v1', '{"version":2,"recipes":[{"name":"Мой торт"}]}'); });
const keys = Object.keys(t.w.localStorage).filter(k => k.indexOf('sebes.backup.') === 0);
ok('Копия отложена', keys.length === 1);
ok('В копии данные пользователя', keys.length && t.w.localStorage.getItem(keys[0]).includes('Мой торт'));
ok('Пользователь предупреждён', !t.$('#toast').hidden && t.$('#toast').textContent.includes('не удалось прочитать'));

console.log('\n20. Ошибка сохранения не выдаётся за успех');
t = boot();
t.Store.state;
const realSet = t.w.localStorage.setItem.bind(t.w.localStorage);
t.w.Storage.prototype.setItem = function () { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
t.click(t.$('[data-tab="orders"]'));
t.click(t.$('#mainButton'));
t.$('#oTitle').value = 'Не влезет';
t.click(t.$('#oSave'));
ok('Показана ошибка, а не «Сохранено»', t.$('#toast').textContent.includes('Не сохранилось'));

console.log('\n21. Дата по местному времени');
ok('localISO даёт местную дату', t.Calc.localISO(new t.w.Date(2026, 10, 1, 1, 30)) === '2026-11-01');

console.log('\n22. Экспорт');
t = boot();
t.app.go('settings');
t.click(t.$('#btnExport'));
ok('Текст копии', JSON.parse(t.$('#exText').value).recipes.length === 3);
ok('Настройки налога на экране', !!t.$('#setTax'));


console.log('\n23. Флаг «не растёт с весом» в рецепте');
t = boot();
t.app.go('recipe', { id: 'r_velvet' });
ok('Коробка помечена', t.text().includes('Коробка для торта') && t.text().includes('на любой вес'));
t.click(t.$('[data-item="0"]'));
ok('Переключатель в шторке продукта', !!t.$('#sFixed') && !t.$('#sDecor'));
ok('Ссылка «Изменить цену продукта»', !!t.$('#sEditIng'));
t.click(t.$('#sEditIng'));
ok('Открылась карточка продукта', !!t.$('#iPrice'));
t.input(t.$('#iPrice'), '1000');
t.click(t.$('#iSave'));
ok('Вернулись в продукт рецепта', !!t.$('#sQty') && t.$('#sQty').value === '180');
ok('Цена сливок обновилась в справочнике', t.Store.ingredientsById().i_cream.price === 1000);
t.change(t.$('#sFixed'), true); t.click(t.$('#sSave'));
ok('Флаг сохранился в черновике', t.text().split('на любой вес').length >= 3);

console.log('\n24. Нейтральные обращения');
const all = fs.readFileSync(path.join(dir, 'app.js'), 'utf8') + fs.readFileSync(path.join(dir, 'store.js'), 'utf8');
ok('Нет «заработала», «готова», «смогла»', !/заработала|будешь готова|не смогла|Сама отказалась/.test(all.replace(/OLD_REASON = \{[\s\S]*?\};/, '')));
t = boot((w) => w.localStorage.setItem('sebes.v1', JSON.stringify({ version: 1, refusals: [{ id: 'f1', reason: 'Сама отказалась, невыгодно', date: '2026-10-01' }] })));
ok('Старая причина переведена', t.Store.state.refusals[0].reason === 'Отказ с моей стороны, невыгодно');

console.log('\n25. Защита данных');
const own = JSON.stringify({ version: 1, settings: { demo: false }, recipes: [{ id: 'r1', name: 'Мой торт' }],
  orders: [{ id: 'o1', title: 'А', amount: 100 }, { id: 'o2', title: 'Б', amount: 200 }] });
t = boot((w) => w.localStorage.setItem('sebes.v1', own));
const autos = Object.keys(t.w.localStorage).filter((k) => k.indexOf('sebes.auto.') === 0);
ok('Автокопия сделана при запуске', autos.length === 1 && t.w.localStorage.getItem(autos[0]).includes('Мой торт'));
ok('Напоминание о копии на главной', t.text().includes('Сохрани копию данных') && t.text().includes('Копии ещё не было'));
t.click(t.$('#homeBackup'));
t.click(t.$('#exCopy'));
ok('После копии дата записана', t.Store.state.settings.lastExport === t.Calc.localISO());
t.app.render();
ok('Напоминание пропало', !t.text().includes('Сохрани копию данных'));
t.app.go('settings');
ok('Автокопия в настройках', t.$$('[data-snap]').length === 1);
t.Store.state.recipes[0].name = 'Испорчено'; t.Store.save();
t.click(t.$('[data-snap]'));
t.click(t.$('#cYes'));
ok('Данные вернулись из автокопии', t.Store.state.recipes[0].name === 'Мой торт', t.Store.state.recipes[0].name);
t = boot((w) => { for (let i = 1; i <= 7; i++) w.localStorage.setItem('sebes.auto.2026-10-0' + i, own); w.localStorage.setItem('sebes.v1', own); });
ok('Хранятся только 5 автокопий', Object.keys(t.w.localStorage).filter((k) => k.indexOf('sebes.auto.') === 0).length === 5);
ok('Импорт сохраняет закупки', (() => { const r = t.Store.importJSON(JSON.stringify({ version: 1, purchases: [{ amount: 500, note: 'x', date: '2026-11-01' }, { amount: -3 }] })); return r.ok && t.Store.purchases().length === 1; })());

console.log('\n26. Проверка калькулятора 0.5.1');
t = boot();
t.app.go('recipe', { id: 'r_velvet' });
ok('Коробка не просит массу 1 шт', !t.text().includes('Без учёта'));
{
  const S = t.Store, C = t.Calc;
  const o = S.upsertOrder({ title: 'Замороженный', recipeId: 'r_velvet', qty: 2.2, amount: 9000, status: 'done', date: C.localISO() });
  const before = JSON.stringify(S.orders().find((x) => x.id === o.id).snapshot);
  const cream = Object.assign({}, S.ingredientsById().i_cream, { price: 5000 });
  S.upsertIngredient(cream);
  const e1 = Object.assign({}, S.orders().find((x) => x.id === o.id), { rating: 5, qty: '2.2' });
  S.upsertOrder(e1);
  ok('Отзыв не пересчитывает замороженную себестоимость', JSON.stringify(S.orders().find((x) => x.id === o.id).snapshot) === before);
  const e2 = Object.assign({}, S.orders().find((x) => x.id === o.id), { legal: true });
  S.upsertOrder(e2);
  const sn = S.orders().find((x) => x.id === o.id).snapshot;
  ok('Смена плательщика меняет только налог', sn.taxRate === 6 && sn.ingredients === JSON.parse(before).ingredients);
  S.removeRecipe('r_velvet');
  S.upsertOrder(Object.assign({}, S.orders().find((x) => x.id === o.id), { legal: false, amount: 9500 }));
  const sn2 = S.orders().find((x) => x.id === o.id).snapshot;
  ok('Удалённый рецепт не стирает себестоимость выданного заказа', !!sn2 && sn2.taxRate === 4);
}
t = boot();
t.click(t.$('[data-tab="orders"]')); t.click(t.$('#mainButton'));
t.change(t.$('#oRecipe'), 'r_velvet');
{
  const c = t.Store.computeRecipe(t.Store.getRecipe('r_velvet'));
  const amount = Math.round(c.price) + 500;
  const M = t.Calc.money, money = () => t.$('#oMoney').textContent;
  const pickupHands = c.labor + Math.round(c.price) * 0.96 - c.cost;
  ok('Самовывоз: на руки', money().includes(M(pickupHands)), M(pickupHands));

  t.click(t.$('#oFulfil [data-seg="courier"]')); t.input(t.$('#oFee'), '500');
  const courierHands = c.labor + amount - 500 - amount * 0.04 - c.cost;
  ok('Курьер: сумма клиенту выросла на 500', Number(t.$('#oAmount').value) === amount);
  ok('Курьер: 500 в заработок не входят, налог со всей суммы', money().includes(M(courierHands)), M(courierHands));
  ok('Курьер: названо, сколько уйдёт курьеру', money().includes(M(500) + ' курьеру') && money().includes('после налога ' + M(amount * 0.04)));

  t.click(t.$('#oFulfil [data-seg="delivery"]'));
  ok('Сумма доставки сохранилась при переключении', t.$('#oFee').value === '500');
  const selfHands = c.labor + amount - amount * 0.04 - c.cost;
  ok('Везу сам: 500 входят в заработок', money().includes(M(selfHands)) && money().includes('за доставку ' + M(500)), M(selfHands));
  ok('Везу сам на 500 больше, чем курьер', Math.abs(selfHands - courierHands - 500) < 0.01);

  t.click(t.$('#oFulfil [data-seg="courier"]'));
  t.$('#oTitle').value = 'Курьером'; t.$('#oStatus') && t.change(t.$('#oStatus'), 'done');
  t.click(t.$('#oSave'));
  const so = t.Store.orders().find((x) => x.title === 'Курьером');
  ok('Способ «курьер» сохранён', so && so.fulfillment === 'courier' && so.deliveryFee === 500);
  const e = t.Store.orderEconomics(so);
  ok('Аналитика: выручка без денег курьеру', e.revenue === amount - 500 && e.courier === 500);
  ok('Аналитика: налог со всей суммы', Math.abs(e.tax - amount * 0.04) < 0.01);
  ok('Аналитика и окно заказа сходятся', Math.abs(e.earned - courierHands) < 0.01, t.Calc.money(e.earned));
  const so2 = Object.assign({}, so, { id: undefined, title: 'Сам', fulfillment: 'delivery' }); delete so2.id; delete so2.snapshot;
  t.Store.upsertOrder(so2);
  const e2 = t.Store.orderEconomics(t.Store.orders().find((x) => x.title === 'Сам'));
  ok('Везу сам: в аналитике заработок на 500 больше', Math.abs(e2.earned - e.earned - 500) < 0.01);
  ok('Копия с неизвестным способом → самовывоз', (() => { const r = t.Store.importJSON(JSON.stringify({ version: 1, orders: [{ id: 'o1', title: 'x', amount: 1, fulfillment: '<b>' }, { id: 'o2', title: 'y', amount: 1, fulfillment: 'courier' }] })); return r.ok && t.Store.orders()[0].fulfillment === 'pickup' && t.Store.orders()[1].fulfillment === 'courier'; })());
}

console.log(failed === 0 ? '\nВсе проверки интерфейса пройдены.\n' : '\n' + failed + ' проверок провалено.\n');
process.exit(failed === 0 ? 0 : 1);
