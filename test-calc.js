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

console.log('\nДекор как отключаемая часть');
const withDecor = {
  ingredientsById,
  items: input.items.concat([{ ingredientId: 'i_berry', qty: 150, unit: 'г', decor: true }]),
  labor: input.labor.concat([{ name: 'Декор', minutes: 30, decor: true }]),
  rate: 500, overheads: input.overheads, margin: 55
};
ingredientsById.i_berry = { id: 'i_berry', name: 'Клубника', price: 650, amount: 1, unit: 'кг' };
const on  = Calc.recipe(withDecor);
const off = Calc.recipe(Object.assign({}, withDecor, { withDecor: false }));
eq('С декором: ингредиенты', on.ingredients, 985.9 + 97.5);
eq('С декором: работа',      on.labor,       1375 + 250);
eq('Без декора: ингредиенты', off.ingredients, 985.9);
eq('Без декора: работа',      off.labor,       1375);
eq('Без декора себестоимость = эталон', off.cost, 2596.99);
ok_true('Декор найден в рецепте', Calc.hasDecor(withDecor));
ok_true('В эталоне декора нет', !Calc.hasDecor({ items: input.items, labor: input.labor }));

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

console.log(failed === 0
  ? '\nВсе проверки пройдены.\n'
  : '\n' + failed + ' проверок провалено.\n');
process.exit(failed === 0 ? 0 : 1);
