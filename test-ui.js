/* Интеграционный прогон интерфейса в jsdom.
   Проверяет, что экраны рисуются и что числа на экране совпадают с Calc. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
  .replace(/<script src="https:\/\/telegram\.org[^>]*><\/script>/, '');

let failed = 0;
function ok(name, cond, extra) {
  if (!cond) failed++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (extra ? '  ' + extra : ''));
}

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  url: 'https://example.com/',
  pretendToBeVisual: true
});
const w = dom.window;
w.confirm = () => true;
w.scrollTo = () => {};

for (const f of ['calc.js', 'store.js', 'app.js']) {
  w.eval(fs.readFileSync(path.join(dir, f), 'utf8'));
}

const doc = w.document;
const Calc = w.Calc, Store = w.Store, app = w.__app;
const $ = (s) => doc.querySelector(s);
const $$ = (s) => Array.from(doc.querySelectorAll(s));
const text = () => $('#view').textContent.replace(/\s+/g, ' ');

console.log('\n1. Стартовый экран');
ok('Заголовок «Рецепты»', $('#screenTitle').textContent === 'Рецепты');
ok('Отрисовано 3 рецепта', $$('[data-open]').length === 3, '(' + $$('[data-open]').length + ')');
ok('Главная кнопка — новый расчёт', $('#mainButton').textContent.includes('Новый расчёт'));

console.log('\n2. Числа на списке совпадают с Calc');
const velvet = Store.getRecipe('r_velvet');
const vc = Store.computeRecipe(velvet);
ok('Себестоимость в списке', text().includes(Calc.money(vc.cost)), Calc.money(vc.cost));
ok('Цена в списке', text().includes(Calc.money(vc.price)), Calc.money(vc.price));
const vcNoDecor = Store.computeRecipe(velvet, { withDecor: false });
ok('Эталон без декора: себестоимость 2 597 ₽', Math.abs(vcNoDecor.cost - 2596.99) < 0.5, Math.round(vcNoDecor.cost));
ok('Эталон без декора: цена 5 771 ₽', Math.abs(vcNoDecor.price - 5771.09) < 0.5, Math.round(vcNoDecor.price));
ok('С декором дороже', vc.cost > vcNoDecor.cost, Math.round(vc.cost) + ' > ' + Math.round(vcNoDecor.cost));

console.log('\n3. Экран расчёта');
app.go('recipe', { id: 'r_velvet' });
const t3 = text();
ok('Заголовок экрана', $('#screenTitle').textContent === 'Расчёт себестоимости');
ok('Есть блок накладных', t3.includes('Накладные'));
ok('Накладные 236 ₽ показаны', t3.includes(Calc.money(vc.overhead)), Calc.money(vc.overhead));
ok('Себестоимость = база + накладные', t3.includes(Calc.money(vc.cost)));
ok('База показана отдельно', t3.includes(Calc.money(vc.base)), Calc.money(vc.base));
ok('Себестоимость НЕ равна базе', Math.abs(vc.cost - vc.base) > 1);
ok('Поле маржи на месте', !!$('#fMargin'));

console.log('\n4. Пересчёт при смене маржи');
const f = $('#fMargin');
f.value = '40';
f.dispatchEvent(new w.Event('input'));
const d2 = Store.computeRecipe(Object.assign({}, velvet, { margin: 40 }));
ok('Цена пересчиталась под 40%', text().includes(Calc.money(d2.price)), Calc.money(d2.price));
ok('Себестоимость не изменилась', text().includes(Calc.money(vc.cost)));

console.log('\n5. Цена одинакова на всех экранах');
app.go('recipes');
w.__app.render();
const listPrice = text().includes(Calc.money(vc.price));
ok('В списке та же цена, что в расчёте', listPrice);

console.log('\n6. Ингредиенты');
app.go('ingredients');
ok('Заголовок', $('#screenTitle').textContent === 'Ингредиенты');
ok('8 ингредиентов', $$('[data-ing]').length === 8, '(' + $$('[data-ing]').length + ')');
ok('Видна дата цены', text().includes('Обновлено'));

console.log('\n7. Заказы');
app.go('orders');
ok('Заголовок', $('#screenTitle').textContent === 'Заказы');
ok('4 заказа', $$('[data-ord]').length === 4, '(' + $$('[data-ord]').length + ')');
ok('Нет блока ингредиентов на экране заказов', !text().includes('Накладные'));
ok('Есть статусы', text().includes('В работе') || text().includes('Выдан'));

console.log('\n8. Аналитика: деньги');
app.go('analytics');
ok('Заголовок', $('#screenTitle').textContent === 'Аналитика');
ok('Три раздела', $$('#anSeg [data-seg]').length === 3);
const t8 = text();
ok('Открывается на деньгах', t8.includes('Выручка'));
ok('Есть прибыль', t8.includes('Прибыль'));
ok('Есть кэш за вычетом продуктов', t8.includes('Деньги за вычетом продуктов'));
ok('Нарисован график', !!$('.chart-wrap svg'));
ok('Легенда из 4 рядов', $$('.legend-item').length === 4, '(' + $$('.legend-item').length + ')');
ok('Таблица значений под графиком', !!$('.data-table'));

const moneyRows = Store.moneyRows();
const totals = moneyRows.reduce((a, r) => {
  a.revenue += r.revenue; a.ingredients += r.ingredients; a.labor += r.labor; a.overhead += r.overhead; return a;
}, { revenue: 0, ingredients: 0, labor: 0, overhead: 0 });
const profit = totals.revenue - (totals.ingredients + totals.labor + totals.overhead);
ok('Выручка на экране совпадает с расчётом', t8.includes(Calc.money(totals.revenue)), Calc.money(totals.revenue));
ok('Прибыль на экране совпадает', t8.includes(Calc.money(profit)), Calc.money(profit));
ok('Кэш на экране совпадает', t8.includes(Calc.money(totals.revenue - totals.ingredients)));
ok('Предупреждение о заказе без рецепта', t8.includes('без привязки к рецепту'));

console.log('\n8б. Аналитика: отказы');
$$('#anSeg [data-seg]')[1].dispatchEvent(new w.Event('click'));
const fn = Calc.funnel(Store.state.orders, Store.state.refusals);
const t8b = text();
ok('Блок «Почему не купили»', t8b.includes('Почему не купили'));
ok('Конверсия в процентах', t8b.includes(Calc.pct(fn.conversion)), Calc.pct(fn.conversion));
ok('Упущенная выручка в рублях', t8b.includes(Calc.money(fn.lostRevenue)), Calc.money(fn.lostRevenue));
ok('Доли причин нарисованы', $$('.bar-row').length >= 3, '(' + $$('.bar-row').length + ' строк)');
ok('Таблица причина-канал', t8b.includes('Причина и канал'));
ok('Фильтр периода', $$('[data-period]').length === 3);
$$('[data-period]')[0].dispatchEvent(new w.Event('click'));
ok('Период переключился на 30 дней', $$('[data-period]')[0].classList.contains('active'));
$$('[data-period]')[2].dispatchEvent(new w.Event('click'));
ok('Вернулись на всё время', $$('[data-period]')[2].classList.contains('active'));

console.log('\n8в. Аналитика: отзывы');
$$('#anSeg [data-seg]')[2].dispatchEvent(new w.Event('click'));
const doneOrders = Store.state.orders.filter(o => o.status === 'done');
const rs = Calc.reviewStats(doneOrders);
const t8v = text();
ok('Средняя оценка показана', t8v.includes('Средняя оценка'));
ok('Значение средней верное', t8v.includes(String(Math.round(rs.average * 100) / 100).replace('.', ',')),
  String(Math.round(rs.average * 100) / 100));
ok('Распределение оценок', t8v.includes('Распределение оценок'));
ok('Оценки по рецептам', t8v.includes('Оценки по рецептам'));
ok('Повторные клиенты', t8v.includes('Повторные клиенты'));
ok('Тексты отзывов выведены', t8v.includes('Что пишут'));

console.log('\n9. Журнал отказов');
app.go('refusals');
ok('Заголовок', $('#screenTitle').textContent === 'Журнал отказов');
ok('6 записей', $$('[data-ref]').length === 6, '(' + $$('[data-ref]').length + ')');
ok('Этап — стадия воронки, не копия причины',
  text().includes('После озвучивания цены') || text().includes('До расчёта цены'));

console.log('\n10. Пустые состояния');
Store.clearAll();
app.go('recipes'); w.__app.render();
ok('Пустой экран рецептов', text().includes('Пока ни одного рецепта'));
app.go('ingredients');
ok('Пустой справочник', text().includes('Справочник пуст'));
app.go('orders');
ok('Пустые заказы', text().includes('Заказов пока нет'));
app.go('analytics');
analyticsTabReset();
ok('Пустой дашборд денег', text().includes('Выполненных заказов нет'));
$$('#anSeg [data-seg]')[2].dispatchEvent(new w.Event('click'));
ok('Пустые отзывы', text().includes('Отзывов пока нет'));
analyticsTabReset();
app.go('refusals');
ok('Пустой журнал', text().includes('Журнал пуст'));

function analyticsTabReset() {
  const segs = $$('#anSeg [data-seg]');
  if (segs.length) segs[0].dispatchEvent(new w.Event('click'));
}

console.log('\n11. Сохранение в localStorage');
Store.reset();
const raw = w.localStorage.getItem('sebes.v1');
ok('Данные записались', !!raw && JSON.parse(raw).recipes.length === 3);

console.log('\n12. Тёмная тема');
$('#btnTheme').dispatchEvent(new w.Event('click'));
ok('Переключилась в dark', doc.documentElement.getAttribute('data-theme') === 'dark');
$('#btnTheme').dispatchEvent(new w.Event('click'));
ok('Вернулась в light', doc.documentElement.getAttribute('data-theme') === 'light');

console.log('\n13. Масштаб и декор в заказе');
app.go('orders'); w.__app.render();
$('#mainButton').dispatchEvent(new w.Event('click'));
const sel = doc.querySelector('#oRecipe');
sel.value = 'r_velvet';
sel.dispatchEvent(new w.Event('change'));
ok('Появилось поле объёма', !!doc.querySelector('#oQty'));
ok('Единица из рецепта', doc.querySelector('#oQtyUnit').value === 'кг', doc.querySelector('#oQtyUnit').value);
ok('Подставлен базовый выход 1.5', Number(doc.querySelector('#oQty').value) === 1.5);
ok('Тумблер декора показан', !!doc.querySelector('#oDecor'));
const panel1 = doc.querySelector('#oCalc').textContent.replace(/\s+/g, ' ');
ok('Множитель ×1 при базовом объёме', panel1.includes('×1'), panel1.slice(0, 60));
ok('Цена с декором в панели', panel1.includes(Calc.money(vc.price)), Calc.money(vc.price));

const qf = doc.querySelector('#oQty');
qf.value = '3';
qf.dispatchEvent(new w.Event('input'));
const x2 = Store.computeRecipe(velvet, { scale: 2 });
const panel2 = doc.querySelector('#oCalc').textContent.replace(/\s+/g, ' ');
ok('Множитель ×2 при 3 кг', panel2.includes('×2'));
ok('Цена удвоилась', panel2.includes(Calc.money(x2.price)), Calc.money(x2.price));

const df = doc.querySelector('#oDecor');
df.checked = false;
df.dispatchEvent(new w.Event('change'));
const x2nd = Store.computeRecipe(velvet, { scale: 2, withDecor: false });
const panel3 = doc.querySelector('#oCalc').textContent.replace(/\s+/g, ' ');
ok('Без декора цена ниже', panel3.includes(Calc.money(x2nd.price)), Calc.money(x2nd.price));
ok('Декор реально влияет', x2nd.price < x2.price);

doc.querySelector('#oTitle').value = 'Красный бархат 3 кг';
doc.querySelector('#oAmount').value = '11000';
doc.querySelector('#oSave').dispatchEvent(new w.Event('click'));
const saved = Store.state.orders.filter(o => o.title === 'Красный бархат 3 кг')[0];
ok('Заказ сохранён с объёмом', saved && saved.qty === 3, saved ? String(saved.qty) : 'нет');
ok('Заказ сохранён без декора', saved && saved.withDecor === false);
ok('Объём виден в списке', text().includes('3 кг'));

console.log('\n14. Раздельные ставки в расчёте');
app.go('recipe', { id: 'r_medovik' });
ok('Тумблер ставок есть', !!doc.querySelector('#swSplit'));
ok('Общая ставка видна', text().includes('Общая ставка'));
const sw = doc.querySelector('#swSplit');
sw.checked = true;
sw.dispatchEvent(new w.Event('change'));
ok('Строка общей ставки скрылась', !text().includes('Общая ставка'));
ok('У этапов показана ставка', text().includes('500 ₽ / ч'));
doc.querySelector('[data-labor="0"]').dispatchEvent(new w.Event('click'));
ok('Поле своей ставки в шторке', !!doc.querySelector('#lRate'));
doc.querySelector('#lRate').value = '800';
doc.querySelector('#lSave').dispatchEvent(new w.Event('click'));
ok('Ставка этапа сохранилась в черновик', text().includes('800 ₽ / ч'));

console.log('\n15. Выход рецепта и цена за единицу');
ok('Поле выхода есть', !!doc.querySelector('#fYield'));
ok('Показана цена за единицу', text().includes('За 1 кг'));
ok('Тумблер масштаба работы', !!doc.querySelector('#swScaleLabor'));

console.log('\n16. Нулевые накладные свёрнуты');
app.go('recipe', { id: 'r_cheese' });
ok('Аренда 0% скрыта', !text().includes('Аренда'));
ok('Есть кнопка показать нулевые', !!doc.querySelector('#showAllOh'));
doc.querySelector('#showAllOh').dispatchEvent(new w.Event('click'));
ok('После нажатия аренда видна', text().includes('Аренда'));

console.log('\n17. Удаление без нативного confirm');
app.go('analytics'); w.__app.render();
const before = Store.state.refusals.length;
$$('#anSeg [data-seg]')[1].dispatchEvent(new w.Event('click'));
doc.querySelector('#toRef').dispatchEvent(new w.Event('click'));
doc.querySelector('[data-ref]').dispatchEvent(new w.Event('click'));
ok('Открылась карточка отказа', !doc.getElementById('sheet').hidden);
doc.querySelector('#rDel').dispatchEvent(new w.Event('click'));
ok('Запись удалена через свою кнопку', Store.state.refusals.length === before - 1,
  '(' + before + ' -> ' + Store.state.refusals.length + ')');

console.log('\n18. Подтверждение очистки — своя шторка, не confirm()');
w.confirm = () => { throw new Error('нативный confirm вызван'); };
app.go('settings'); w.__app.render();
doc.querySelector('#btnClear').dispatchEvent(new w.Event('click'));
ok('Показана своя шторка подтверждения', !!doc.querySelector('#cYes'));
doc.querySelector('#cYes').dispatchEvent(new w.Event('click'));
ok('После подтверждения данные стёрты', Store.state.recipes.length === 0);

console.log('\n19. Календарь заказов');
Store.reset();
app.go('orders'); w.__app.render();
ok('Два режима списка', $$('#ordSeg [data-seg]').length === 2);
$$('#ordSeg [data-seg]')[1].dispatchEvent(new w.Event('click'));
ok('Сетка календаря нарисована', $$('.cal-day').length >= 28, '(' + $$('.cal-day').length + ' дней)');
ok('Заголовок месяца есть', !!$('.cal-title'));
ok('Дни с заказами подсвечены', $$('.cal-day.has').length > 0, '(' + $$('.cal-day.has').length + ')');
const titleBefore = $('.cal-title').textContent;
$('#calNext').dispatchEvent(new w.Event('click'));
ok('Переключение месяца работает', $('.cal-title').textContent !== titleBefore,
  titleBefore + ' -> ' + $('.cal-title').textContent);
$('#calPrev').dispatchEvent(new w.Event('click'));
ok('Вернулись назад', $('.cal-title').textContent === titleBefore);
const busy = $$('.cal-day.has')[0];
busy.dispatchEvent(new w.Event('click'));
ok('День выбран', !!$('.cal-day.sel'));
ok('Заказы дня показаны', $$('[data-ord]').length > 0);
$$('#ordSeg [data-seg]')[0].dispatchEvent(new w.Event('click'));
ok('Вернулись к списку', !$('.cal-day'));

console.log('\n20. Доставка, время и адрес');
$('#mainButton').dispatchEvent(new w.Event('click'));
ok('Поле времени есть', !!doc.querySelector('#oTime'));
ok('Тумблер доставки есть', !!doc.querySelector('#oDelivery'));
ok('Адрес скрыт при самовывозе', !doc.querySelector('#oAddress'));
const dl = doc.querySelector('#oDelivery');
dl.checked = true;
dl.dispatchEvent(new w.Event('change'));
ok('Адрес появился', !!doc.querySelector('#oAddress'));
ok('Поле стоимости доставки', !!doc.querySelector('#oFee'));
doc.querySelector('#oTitle').value = 'Тест доставки';
doc.querySelector('#oAmount').value = '5000';
doc.querySelector('#oTime').value = '18:30';
doc.querySelector('#oAddress').value = 'Москва, Тверская 1';
doc.querySelector('#oFee').value = '400';
doc.querySelector('#oSave').dispatchEvent(new w.Event('click'));
const dOrd = Store.state.orders.filter(o => o.title === 'Тест доставки')[0];
ok('Доставка сохранена', dOrd && dOrd.fulfillment === 'delivery');
ok('Адрес сохранён', dOrd && dOrd.address === 'Москва, Тверская 1');
ok('Время сохранено', dOrd && dOrd.time === '18:30');
ok('Стоимость доставки сохранена', dOrd && dOrd.deliveryFee === 400);
ok('Адрес виден в списке', text().includes('Тверская'));

console.log('\n21. Отзыв только у выданных');
doc.querySelector('[data-ord]').dispatchEvent(new w.Event('click'));
const st = doc.querySelector('#oStatus');
st.value = 'new';
st.dispatchEvent(new w.Event('change'));
ok('У нового заказа оценки нет', !doc.querySelector('#oRate'));
st.value = 'done';
st.dispatchEvent(new w.Event('change'));
ok('У выданного оценка появилась', !!doc.querySelector('#oRate'));
doc.querySelectorAll('[data-rate]')[4].dispatchEvent(new w.Event('click'));
ok('Пять звёзд выбраны', doc.querySelectorAll('[data-rate].on').length === 5);
doc.querySelector('#oReview').value = 'Проверочный отзыв';
doc.querySelector('#oSave').dispatchEvent(new w.Event('click'));
const rated = Store.state.orders.filter(o => o.review === 'Проверочный отзыв')[0];
ok('Отзыв сохранён', !!rated && rated.rating === 5);
ok('Дата отзыва проставлена', !!rated.reviewDate);

console.log('\n22. Архив');
Store.reset();
app.go('orders'); w.__app.render();
const activeBefore = Store.orders().length;
const archBefore = Store.archived().length;
ok('Часть заказов уже в архиве', archBefore > 0, '(' + archBefore + ')');
ok('Архив не мешается в списке', $$('[data-ord]').length < Store.state.orders.length);
$('#toArchive').dispatchEvent(new w.Event('click'));
doc.querySelector('#cYes').dispatchEvent(new w.Event('click'));
ok('Выданные уехали в архив', Store.archived().length > archBefore,
  archBefore + ' -> ' + Store.archived().length);
ok('В активных их больше нет', Store.orders().every(o => o.status !== 'done'));
$('#openArchive').dispatchEvent(new w.Event('click'));
ok('Экран архива открылся', $('#screenTitle').textContent === 'Архив заказов');
ok('Заказы в архиве видны', $$('[data-ord]').length === Store.archived().length);

console.log('\n23. Архив попадает в аналитику');
const moneyAll = Store.moneyRows();
ok('Выполненные из архива учтены', moneyAll.length === Store.state.orders.filter(o => o.status === 'done').length,
  '(' + moneyAll.length + ')');
app.go('analytics'); analyticsTabReset();
ok('Дашборд считает архивные', text().includes('выполненных заказов'));

console.log('\n24. Экспорт и восстановление');
Store.reset();
app.go('settings'); w.__app.render();
doc.querySelector('#btnExport').dispatchEvent(new w.Event('click'));
const exText = doc.querySelector('#exText');
ok('Текст копии показан', !!exText && exText.value.length > 100);
ok('Копия — валидный JSON с рецептами', JSON.parse(exText.value).recipes.length === 3);

console.log(failed === 0 ? '\nВсе проверки интерфейса пройдены.\n' : '\n' + failed + ' проверок провалено.\n');
process.exit(failed === 0 ? 0 : 1);
