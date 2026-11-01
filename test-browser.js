/* Браузерная проверка в Chromium: node test-browser.js . /tmp */
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], shots = process.argv[3];
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml' };
let fails = 0;
const ok = (n, c, x) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (x ? '  ' + x : '')); };
const SDK = (initData) => "window.Telegram={WebApp:{initData:" + JSON.stringify(initData) + ",colorScheme:'light',ready(){},expand(){}," +
  "MainButton:{t:'',setText(t){this.t=t},show(){this.v=1},hide(){this.v=0},onClick(f){this.f=f}},BackButton:{show(){},hide(){},onClick(){}},HapticFeedback:{impactOccurred(){}}}};";

const srv = http.createServer((q, r) => {
  const f = path.join(root, q.url === '/' ? 'index.html' : q.url.split(/[?#]/)[0]);
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'text/plain' }); fs.createReadStream(f).pipe(r);
}).listen(8765, async () => {
  const b = await chromium.launch();

  async function scenario(name, viewport, opts) {
    console.log('\n' + name);
    const p = await b.newPage({ viewport });
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    let sdkRequested = false;
    await p.route('https://telegram.org/**', rt => {
      sdkRequested = true;
      if (opts.sdkDown) return rt.abort();
      return rt.fulfill({ contentType: 'text/javascript', body: SDK(opts.initData || '') });
    });
    const t0 = Date.now();
    await p.goto('http://localhost:8765/' + (opts.hash || ''), { waitUntil: 'load' });
    await p.waitForTimeout(400);
    ok('Загрузилась быстро', Date.now() - t0 < 3000, (Date.now() - t0) + ' мс');

    const st = await p.evaluate(() => ({
      tg: document.body.classList.contains('tg'),
      tabbar: getComputedStyle(document.querySelector('.tabbar')).display,
      back: getComputedStyle(document.getElementById('btnBack')).display,
      sheet: getComputedStyle(document.getElementById('sheet')).display
    }));
    ok('Шторка скрыта', st.sheet === 'none', st.sheet);
    ok('Нет стрелки «назад» на главной', st.back === 'none', st.back);
    if (opts.expectTg) {
      ok('Режим Telegram включён', st.tg);
      ok('Таббар спрятан (навигация Telegram)', st.tabbar === 'none');
      ok('SDK запрошен', sdkRequested);
      const mb = await p.evaluate(() => window.Telegram.WebApp.MainButton.t);
      ok('Нативная кнопка Telegram получила текст', !!mb, mb);
    } else {
      ok('Обычный режим, не Telegram', !st.tg);
      ok('Таббар виден', st.tabbar !== 'none', st.tabbar);
      ok('SDK Telegram даже не запрашивался', !sdkRequested);
    }

    await p.click('[data-open]');
    await p.waitForTimeout(200);
    ok('Открылся расчёт по клику', (await p.textContent('#screenTitle')) === 'Расчёт себестоимости');
    if (!opts.expectTg) {
      await p.click('#btnBack');
      await p.waitForTimeout(200);
      ok('Назад работает', (await p.textContent('#screenTitle')) === 'Рецепты');
      for (const [tab, title] of [['ingredients','Ингредиенты'],['orders','Заказы'],['analytics','Аналитика'],['recipes','Рецепты']]) {
        await p.click('.tab[data-tab="' + tab + '"]'); await p.waitForTimeout(150);
        ok('Вкладка ' + title, (await p.textContent('#screenTitle')) === title);
      }
      await p.click('.tab[data-tab="ingredients"]'); await p.waitForTimeout(150);
      await p.click('[data-ing]'); await p.waitForTimeout(200);
      ok('Шторка открылась', await p.isVisible('#sheet'));
      await p.mouse.click(viewport.width / 2, 20); await p.waitForTimeout(200);
      ok('Шторка закрылась по фону', !(await p.isVisible('#sheet')));
      await p.click('.tab[data-tab="recipes"]'); await p.waitForTimeout(150);
      ok('После закрытия шторки клики снова работают', (await p.textContent('#screenTitle')) === 'Рецепты');
    }
    ok('Нет ошибок JS', !errors.length, errors.join(' | '));
    if (opts.shot) await p.screenshot({ path: path.join(shots, opts.shot) });
    await p.close();
  }

  await scenario('Десктоп, обычный браузер', { width: 1600, height: 900 }, { shot: 'desktop.png' });
  await scenario('Десктоп, telegram.org недоступен', { width: 1600, height: 900 }, { sdkDown: true });
  await scenario('Телефон', { width: 390, height: 844 }, { shot: 'mobile.png' });
  await scenario('Запуск внутри Telegram', { width: 390, height: 844 },
    { hash: '#tgWebAppData=query_id%3D1&tgWebAppPlatform=ios&tgWebAppVersion=8.0', initData: 'query_id=1', expectTg: true });

  console.log(fails ? '\n' + fails + ' проверок провалено' : '\nВсе браузерные проверки пройдены');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
});
