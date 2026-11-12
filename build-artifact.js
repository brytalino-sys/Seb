/* Собирает однофайловую версию для публикации.
   Внешние скрипты там запрещены, поэтому всё инлайнится,
   а SDK Telegram исключается — приложение и без него работает. */
const fs = require('fs');
const path = require('path');
const d = __dirname;
const read = (f) => fs.readFileSync(path.join(d, f), 'utf8');

const html = read('index.html');
const body = html
  .slice(html.indexOf('<div id="app">'), html.indexOf('<script src="calc.js">'))
  .trim();

const css = read('styles.css');
let js = ['calc.js', 'store.js', 'app.js'].map(read).join('\n');

/* В окне просмотра артефакта скачивание файлов запрещено: приложение
   прячет кнопки файла, остаётся копирование текста. */
js = 'window.__NO_FILES = true;\n' + js;
/* Внутри окна просмотра Telegram не бывает: загрузчик SDK не нужен */
js = js.replace(
  /\n  if \(launchedFromTelegram\(\)\) \{[\s\S]*?\n  \}\n/,
  "\n");

const out = `<title>Себес</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="theme-color" content="#FDF9F7">
<style>
${css}
</style>

${body}

<script>
${js}
</script>
`;

fs.writeFileSync(path.join(d, 'artifact.html'), out);

const bad = [/<!DOCTYPE/i, /<html[\s>]/i, /<head[\s>]/i, /<body[\s>]/i, /telegram\.org/];
let problems = 0;
bad.forEach((re) => {
  if (re.test(out)) { console.log('  ПРОБЛЕМА: найдено ' + re); problems++; }
});
console.log('artifact.html — ' + (out.length / 1024).toFixed(1) + ' KB, нарушений контракта: ' + problems);
