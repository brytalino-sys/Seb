/* Проверка арифметики. Запуск: node test-calc.js
   Эталон — «Красный бархат» из технического задания. */
const Calc = require('./calc.js');

let failed = 0;
function ok_true(name, cond) {
  if (!cond) failed++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name);
}
function eq(name, got, want, tol) {
  const t = tol === undefined ? 0.01 : tol;
  const ok = Math.abs(got - want) <= t;
  if (!ok) failed++;
  console.log((ok ? '  OK   ' : '  FAIL ') + name +
    '  получено ' + (Math.round(got * 100) / 100) +
    ', ожидалось ' + want);
}

const ingredientsById = {
  cream:  { id: 'cream',  name: 'Сливки 33%',  price: 850,  amount: 1, unit: 'л'  },
  choco:  { id: 'choco',  name: 'Шоколад тёмный', price: 1420, amount: 1, unit: 'кг' },
  masc:   { id: 'masc',   name: 'Маскарпоне',  price: 1290, amount: 1, unit: 'кг' },
  flour:  { id: 'flour',  name: 'Мука',        price: 70,   amount: 1, unit: 'кг' }
};

const input = {
  ingredientsById,
  items: [
    { ingredientId: 'cream', qty: 180, unit: 'мл' },
    { ingredientId: 'choco', qty: 120, unit: 'г'  },
    { ingredientId: 'masc',  qty: 500, unit: 'г'  },
    { ingredientId: 'flour', qty: 250, unit: 'г'  }
  ],
  labor: [
    { name: 'Приготовление', minutes: 90 },
    { name: 'Декорирование', minutes: 60 },
    { name: 'Упаковка',      minutes: 15 }
  ],
  rate: 500,
  overheads: [
    { name: 'Электричество', percent: 5 },
    { name: 'Аренда',        percent: 0 },
    { name: 'Упаковка',      percent: 3 },
    { name: 'Амортизация',   percent: 2 }
  ],
  margin: 55
};

const r = Calc.recipe(input);

console.log('\nЭталонный рецепт «Красный бархат»');
eq('Сливки 180 мл',        r.lines[0].cost, 153);
eq('Шоколад 120 г',        r.lines[1].cost, 170.4);
eq('Маскарпоне 500 г',     r.lines[2].cost, 645);
eq('Мука 250 г',           r.lines[3].cost, 17.5);
eq('Ингредиенты итого',    r.ingredients,   985.9);
eq('Работа, минут',        r.laborMinutes,  165);
eq('Работа, ₽',            r.labor,         1375);
eq('База',                 r.base,          2360.9);
eq('Накладные, %',         r.overheadPercent, 10);
eq('Накладные, ₽',         r.overhead,      236.09);
eq('СЕБЕСТОИМОСТЬ',        r.cost,          2596.99);
eq('Цена при марже 55%',   r.price,         5771.09);
eq('Прибыль',              r.profit,        3174.10);

console.log('\nКонтроль: маржа, посчитанная обратно от цены');
eq('Фактическая маржа',    r.marginFact,    55);

console.log('\nГраничные случаи');
const zero = Calc.recipe({ ingredientsById: {}, items: [], labor: [], overheads: [], rate: 0, margin: 0 });
eq('Пустой рецепт: себестоимость', zero.cost, 0);
eq('Пустой рецепт: цена',          zero.price, 0);

const noOh = Calc.recipe(Object.assign({}, input, { overheads: [] }));
eq('Без накладных себестоимость = база', noOh.cost, noOh.base);

const m99 = Calc.recipe(Object.assign({}, input, { margin: 150 }));
console.log('  INFO  маржа 150% обрезана до ' + m99.margin + '%, цена ' + Math.round(m99.price));

console.log('\nМасштаб заказа');
const x2 = Calc.recipe(Object.assign({}, input, { scale: 2 }));
eq('Ингредиенты ×2',  x2.ingredients, 985.9 * 2);
eq('Работа ×2',       x2.labor,       1375 * 2);
eq('Себестоимость ×2', x2.cost,       2596.99 * 2);
eq('Цена ×2',         x2.price,       5771.09 * 2);
eq('Маржа не поехала', x2.marginFact, 55);

const fixedLabor = Calc.recipe(Object.assign({}, input, { scale: 2, scaleLabor: false }));
eq('Работа не масштабируется', fixedLabor.labor, 1375);
eq('Ингредиенты всё равно ×2', fixedLabor.ingredients, 985.9 * 2);
eq('Себестоимость при фикс. работе', fixedLabor.cost, (985.9 * 2 + 1375) * 1.1);

eq('Множитель 3 кг от выхода 1,5 кг', Calc.scaleFactor(3, 1.5), 2);
eq('Множитель 24 шт от 12 шт',        Calc.scaleFactor(24, 12), 2);
eq('Нулевой выход не ломает',         Calc.scaleFactor(3, 0), 1);

console.log('\nПозиции «не растёт с весом»');
ingredientsById.i_box = { id: 'i_box', name: 'Коробка', price: 1200, amount: 10, unit: 'шт' };
const withFixed = {
  ingredientsById,
  items: input.items.concat([{ ingredientId: 'i_box', qty: 1, unit: 'шт', fixed: true }]),
  labor: input.labor.concat([{ name: 'Надпись', minutes: 12, fixed: true }]),
  rate: 500, overheads: input.overheads, margin: 55
};
const f1 = Calc.recipe(withFixed);
const f2 = Calc.recipe(Object.assign({}, withFixed, { scale: 2 }));
eq('×1: ингредиенты = эталон + коробка', f1.ingredients, 985.9 + 120);
eq('×1: работа = эталон + надпись',     f1.labor, 1375 + 100);
eq('×2: коробка не удваивается',        f2.ingredients, 985.9 * 2 + 120);
eq('×2: надпись не удваивается',        f2.labor, 1375 * 2 + 100);
eq('×2: минуты работы',                 f2.laborMinutes, 165 * 2 + 12);
eq('×2: строка коробки',                f2.lines[f2.lines.length - 1].cost, 120);
eq('×2: строка этапа «Надпись»',        f2.laborRows[f2.laborRows.length - 1].cost, 100);
const f3 = Calc.recipe(Object.assign({}, withFixed, { scale: 2, scaleLabor: false }));
eq('Работа без масштаба: всё по одному разу', f3.labor, 1375 + 100);
ok_true('Фиксированная позиция найдена', Calc.hasFixed(withFixed));
ok_true('В эталоне фиксированных нет', !Calc.hasFixed({ items: input.items, labor: input.labor }));
ok_true('Старый флаг decor больше ничего не выключает',
  Math.abs(Calc.recipe(Object.assign({}, input, { withDecor: false })).cost - 2596.99) < 0.01);

console.log('\nСводка месяца для главной');
const ms = Calc.monthSummary(
  [{ date: '2026-11-03', revenue: 7000, ingredients: 1000, labor: 1500, overhead: 250, tax: 280 },
   { date: '2026-11-20', revenue: 5000, ingredients: 800, labor: 1200, overhead: 200, tax: 200 },
   { date: '2026-10-30', revenue: 9999, ingredients: 1, labor: 1, overhead: 1, tax: 1 }],
  [{ date: '2026-11-01', amount: 3000 }, { date: '2026-11-15', amount: 1500 }, { date: '2026-10-31', amount: 777 }],
  '2026-11');
eq('Пришло', ms.revenue, 12000);
eq('Закупки', ms.purchases, 4500);
eq('Налог', ms.tax, 480);
eq('Осталось = пришло − закупки − налог', ms.left, 12000 - 4500 - 480);
eq('Себестоимость выданных отдельно', ms.cost, 1800 + 2700 + 450);
eq('Заказов в месяце', ms.orders, 2);
eq('Пустой месяц', Calc.monthSummary([], [], '2026-12').left, 0);

console.log('\nРаздельные ставки по этапам');
const split = Calc.recipe(Object.assign({}, input, {
  splitRates: true,
  labor: [
    { name: 'Приготовление', minutes: 90, rate: 400 },
    { name: 'Декорирование', minutes: 60, rate: 800 },
    { name: 'Упаковка',      minutes: 15 }
  ]
}));
eq('Приготовление 1,5 ч × 400', split.laborRows[0].cost, 600);
eq('Декор 1 ч × 800',           split.laborRows[1].cost, 800);
eq('Упаковка 15 мин по общей 500', split.laborRows[2].cost, 125);
eq('Работа итого',              split.labor, 1525);

const splitOff = Calc.recipe(Object.assign({}, input, {
  splitRates: false,
  labor: [
    { name: 'Приготовление', minutes: 90, rate: 400 },
    { name: 'Декорирование', minutes: 60, rate: 800 },
    { name: 'Упаковка',      minutes: 15 }
  ]
}));
eq('Тумблер выключен — своя ставка игнорируется', splitOff.labor, 1375);

console.log('\nВоронка отказов');
const f = Calc.funnel(
  [{ amount: 4500 }, { amount: 5200 }, { amount: 3800 }],
  [{ amount: 5500 }, { amount: 3200 }]
);
eq('Всего обращений', f.total, 5);
eq('Конверсия, %',    f.conversion, 60);
eq('Упущено, ₽',      f.lostRevenue, 8700);
eq('Средний чек выполненных', f.avgCheckWon, 4500);

console.log('\nЭкономика заказа');
const oe = Calc.orderEconomics(5771, { ingredients: 986, labor: 1375, overhead: 236, known: true });
eq('Себестоимость',  oe.cost,   2597);
eq('Прибыль',        oe.profit, 3174);
eq('Маржа',          oe.margin, 54.99, 0.02);
eq('Деньги за вычетом продуктов', oe.cash, 4785);
ok_true('Помечен как известный', oe.known);

const unknown = Calc.orderEconomics(4000, null);
eq('Без рецепта: расходы 0', unknown.cost, 0);
ok_true('Без рецепта помечен', !unknown.known);

console.log('\nСводка по месяцам');
const roll = Calc.monthlyRollup([
  { date: '2026-09-04', revenue: 5000, ingredients: 1000, labor: 1200, overhead: 220, known: true },
  { date: '2026-09-20', revenue: 3000, ingredients: 600,  labor: 800,  overhead: 140, known: true },
  { date: '2026-10-02', revenue: 7000, ingredients: 1500, labor: 1800, overhead: 330, known: true }
]);
eq('Два месяца',            roll.length, 2);
eq('Сентябрь: выручка',     roll[0].revenue, 8000);
eq('Сентябрь: продукты',    roll[0].ingredients, 1600);
eq('Сентябрь: себестоимость', roll[0].cost, 3960);
eq('Сентябрь: прибыль',     roll[0].profit, 4040);
eq('Сентябрь: кэш',         roll[0].cash, 6400);
eq('Сентябрь: заказов',     roll[0].orders, 2);
ok_true('Месяцы отсортированы', roll[0].key === '2026-09' && roll[1].key === '2026-10');
ok_true('Подпись месяца', roll[1].label === 'окт 26');
eq('Сумма частей = себестоимость',
   roll[0].ingredients + roll[0].labor + roll[0].overhead, roll[0].cost);

console.log('\nКонверсия по месяцам');
const cm = Calc.conversionByMonth(
  [{ date: '2026-09-04' }, { date: '2026-09-20' }, { date: '2026-10-02' }],
  [{ date: '2026-09-11' }, { date: '2026-10-05' }, { date: '2026-10-09' }]
);
eq('Сентябрь: конверсия 2 из 3', cm[0].conversion, 66.67, 0.01);
eq('Октябрь: конверсия 1 из 3',  cm[1].conversion, 33.33, 0.01);

console.log('\nПересечение причина и канал');
const ct = Calc.crossTab([
  { reason: 'Дорого', channel: 'Instagram' },
  { reason: 'Дорого', channel: 'Instagram' },
  { reason: 'Дорого', channel: 'Авито' },
  { reason: 'Срок',   channel: 'Telegram' }
], 'reason', 'channel');
eq('Две причины',            ct.length, 2);
ok_true('Самая частая сверху', ct[0].key === 'Дорого');
eq('Дорого всего',           ct[0].total, 3);
eq('Дорого из Instagram',    ct[0].cols['Instagram'], 2);

console.log('\nОтзывы');
const rs = Calc.reviewStats([
  { rating: 5, amount: 6000, review: 'Супер' },
  { rating: 5, amount: 5000, review: '' },
  { rating: 3, amount: 3000, review: 'Долго' },
  { rating: 0, amount: 4000 },
  { amount: 2000 }
]);
eq('С оценкой',        rs.count, 3);
eq('Средняя оценка',   rs.average, 4.33, 0.01);
eq('Покрытие, %',      rs.coverage, 60);
eq('Пятёрок',          rs.distribution[4], 2);
eq('Троек',            rs.distribution[2], 1);
eq('С текстом',        rs.withText, 2);
eq('Средний чек у высоких оценок', rs.avgAmountHigh, 5500);
eq('Средний чек у низких оценок',  rs.avgAmountLow, 3000);

const rbr = Calc.ratingByRecipe(
  [{ rating: 5, recipeId: 'a' }, { rating: 3, recipeId: 'a' }, { rating: 5, recipeId: 'b' }],
  { a: { name: 'Медовик' }, b: { name: 'Чизкейк' } }
);
ok_true('Лучший рецепт сверху', rbr[0].name === 'Чизкейк');
eq('Средняя по Медовику', rbr[1].average, 4);

const rc = Calc.repeatClients([
  { client: 'Анна' }, { client: 'анна ' }, { client: 'Марина' }, { client: '' }
]);
eq('Уникальных клиентов', rc.clients, 2);
eq('Повторных',           rc.repeat, 1);
eq('Доля повторных, %',   rc.share, 50);

console.log('\nКалендарь');
const grid = Calc.monthGrid(2026, 9);           // октябрь 2026
ok_true('Недели по 7 дней', grid.every(w => w.length === 7));
ok_true('Начинается с понедельника', grid[0][0].iso === '2026-09-28');
ok_true('1 октября на своём месте', grid[0][3].iso === '2026-10-01' && grid[0][3].inMonth);
ok_true('Хвост предыдущего месяца помечен', !grid[0][0].inMonth);
const allDays = grid.flat().filter(d => d.inMonth).length;
eq('В октябре 31 день', allDays, 31);

const feb = Calc.monthGrid(2028, 1);            // високосный февраль
eq('В феврале 2028 — 29 дней', feb.flat().filter(d => d.inMonth).length, 29);


console.log('\nНалог самозанятого в цене');
const t4 = Calc.recipe(Object.assign({}, input, { taxRate: 4 }));
eq('Себестоимость не меняется', t4.cost, 2596.99);
eq('Цена до налога как раньше', t4.priceNet, 5771.09);
eq('Цена с НПД 4%', t4.price, 5771.09 / 0.96);
eq('Налог = 4% от итоговой цены', t4.tax, t4.price * 0.04);
eq('На руках столько же, сколько без налога', t4.price - t4.tax, 5771.09);
eq('Маржа сохранилась', t4.marginFact, 55);
eq('Наценка при марже 55%', t4.markup, 122.22, 0.01);
const t6 = Calc.recipe(Object.assign({}, input, { taxRate: 6 }));
eq('Цена с 6% для юрлиц', t6.price, 5771.09 / 0.94);

const oeTax = Calc.orderEconomics(6000, { ingredients: 1000, labor: 1500, overhead: 200, taxRate: 4, known: true });
eq('Налог с заказа', oeTax.tax, 240);
eq('Прибыль за вычетом налога', oeTax.profit, 6000 - 2700 - 240);
eq('Реально прибавилось', oeTax.cash, 6000 - 1000 - 240);
eq('Заработок кондитера', oeTax.earned, 6000 - 1000 - 200 - 240);

console.log('\nЕдиницы');
const masc = { id: 'm', name: 'Маскарпоне', price: 1290, amount: 1, unit: 'шт' };
eq('Граммы у штучного ингредиента дают 0, а не 645 000', Calc.lineCost({ ingredientId: 'm', qty: 500, unit: 'г' }, masc), 0);
const bad = Calc.recipe({ ingredientsById: { m: masc }, items: [{ ingredientId: 'm', qty: 500, unit: 'г' }], labor: [], overheads: [], rate: 0, margin: 0 });
eq('Проблема единиц попала в список', bad.problems.length, 1);
ok_true('Тип проблемы — единицы', bad.problems[0].kind === 'unit');
const butter = { price: 210, amount: 180, unit: 'г' };
eq('Масло 180 г за 210 ₽ — это 1 166,67 ₽/кг', Calc.unitPrice(butter).value, 1166.67, 0.01);
ok_true('Единица цены — кг', Calc.unitPrice(butter).unit === 'кг');
const eggs = { price: 130, amount: 10, unit: 'шт' };
eq('Яйца 10 шт за 130 ₽ — это 13 ₽/шт', Calc.unitPrice(eggs).value, 13);

console.log('\nУпёк по весу готового изделия');
const mass = Calc.recipeMass(input.items, ingredientsById);
eq('Закладка «Красного бархата», г', mass.grams, 1050);
const loss = Calc.bakeLoss(mass.grams, Calc.yieldGrams(0.95, 'кг'));
eq('Упёк при выходе 950 г, %', loss.percent, 9.52, 0.01);
ok_true('Выход 950 г возможен', !loss.impossible);
ok_true('Выход 1,5 кг из 1 050 г невозможен', Calc.bakeLoss(1050, 1500).impossible);
const withEggs = Calc.recipeMass([{ ingredientId: 'e', qty: 4, unit: 'шт' }], { e: { name: 'Яйца', unit: 'шт', pieceMass: 55 } });
eq('Яйца по 55 г входят в закладку', withEggs.grams, 220);
const noMass = Calc.recipeMass([{ ingredientId: 'e', qty: 4, unit: 'шт' }], { e: { name: 'Яйца', unit: 'шт' } });
ok_true('Штуки без массы помечены', noMass.unknown[0] === 'Яйца');
ok_true('Выход в штуках не проверяется', Calc.bakeLoss(1050, Calc.yieldGrams(12, 'шт')) === null);

console.log('\nДаты и форматирование');
ok_true('Местная дата 1 ноября в 01:30', Calc.localISO(new Date(2026, 10, 1, 1, 30)) === '2026-11-01');
ok_true('Ровно 30 дней назад входит в 30 дней', Calc.withinDays('2026-10-02', 30, '2026-11-01'));
ok_true('31 день назад не входит', !Calc.withinDays('2026-10-01', 30, '2026-11-01'));
ok_true('Будущий заказ входит в период', Calc.withinDays('2026-11-08', 30, '2026-11-01'));
ok_true('Пустая дата не входит', !Calc.withinDays('', 30, '2026-11-01'));
ok_true('Суммы на неразрывных пробелах', Calc.money(1250000) === '1 250 000 ₽');
ok_true('Склонение: 1 заказ', Calc.plural(1, 'заказ', 'заказа', 'заказов') === 'заказ');
ok_true('Склонение: 3 заказа', Calc.plural(3, 'заказ', 'заказа', 'заказов') === 'заказа');
ok_true('Склонение: 11 заказов', Calc.plural(11, 'заказ', 'заказа', 'заказов') === 'заказов');

console.log('\nЗащита от мусора на входе (проверка 0.5.1)');
{
  const by = { a: { id: 'a', name: 'A', price: 100, amount: 1, unit: 'кг' },
               box: { id: 'box', name: 'Коробка', price: 120, amount: 1, unit: 'шт' } };
  const bad = Calc.recipe({ ingredientsById: by,
    items: [{ ingredientId: 'a', qty: 500, unit: 'г' }, { ingredientId: 'a', qty: -5, unit: 'кг' }],
    labor: [{ minutes: 'abc' }, { minutes: -60 }], rate: 500, overheads: [{ percent: -50 }], margin: 50 });
  eq('Отрицательное количество не вычитается из суммы', bad.ingredients, 50);
  eq('Отрицательные минуты не уменьшают работу', bad.labor, 0);
  eq('Отрицательные накладные не уменьшают себестоимость', bad.cost, 50);
  ok_true('Неизвестные единицы не считаются совпавшими', !Calc.unitsMatch({ unit: 'x' }, { unit: 'y' }));
  const mass = Calc.recipeMass([{ ingredientId: 'a', qty: 500, unit: 'г' }, { ingredientId: 'box', qty: 1, unit: 'шт', fixed: true }], by);
  eq('Коробка не входит в массу закладки', mass.grams, 500);
  ok_true('И не просит массу одной штуки', mass.unknown.length === 0);
  ok_true('pct без «-0%»', Calc.pct(-0.04, 0) === '0%' && Calc.pct(Infinity) === '0,0%');
  ok_true('Минус в процентах типографский', Calc.pct(-12.5) === '−12,5%');
  ok_true('duration не уходит в минус', Calc.duration(-30) === '0 мин');
  ok_true('monthLabel без undefined', Calc.monthLabel('2026-13') === '2026-13');
}

console.log('\nТри способа выдачи заказа');
{
  const parts = { ingredients: 1000, labor: 1500, overhead: 250, taxRate: 4 };
  const pick = Calc.orderEconomics(7000, parts);
  const self = Calc.orderEconomics(7500, parts);
  const cour = Calc.orderEconomics(7500, Object.assign({ courier: 500 }, parts));
  eq('Самовывоз: заработано', pick.earned, 7000 - 1000 - 250 - 280);
  eq('Везу сам: плата за доставку в заработке', self.earned, 7500 - 1000 - 250 - 300);
  eq('Курьер: выручка без транзита', cour.revenue, 7000);
  eq('Курьер: клиент заплатил', cour.paid, 7500);
  eq('Курьер: налог со всей суммы', cour.tax, 300);
  eq('Курьер: заработано', cour.earned, 7000 - 1000 - 250 - 300);
  eq('Курьер: части складываются в выручку', cour.ingredients + cour.labor + cour.overhead + cour.tax + cour.profit, cour.revenue);
  eq('Курьер дороже суммы заказа не уводит выручку в минус', Calc.orderEconomics(300, { courier: 500 }).revenue, 0);
  const ms2 = Calc.monthSummary([{ date: '2026-11-03', revenue: 7000, tax: 300, courier: 500 }], [], '2026-11');
  eq('Сводка месяца: курьерам', ms2.courier, 500);
  eq('Сводка месяца: осталось без денег курьера', ms2.left, 6700);
}

console.log(failed === 0
  ? '\nВсе проверки пройдены.\n'
  : '\n' + failed + ' проверок провалено.\n');
process.exit(failed === 0 ? 0 : 1);
