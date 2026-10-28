const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '../index.html'),'utf8');
for (const stored of [null, 'light', 'dark', 'invalid']) {
 test('installed app chrome is correct before app startup: '+stored,()=>{
  const dom = new JSDOM(html,{url:'https://openmusic.test',runScripts:'outside-only'});
  try {
   const w=dom.window;
   if(stored) w.localStorage.setItem('om-theme',stored);
   w.eval(w.document.querySelector('#themeBoot').textContent);
   const theme=stored==='dark'?'dark':'light';
   assert.equal(w.document.documentElement.dataset.theme,theme);
   assert.equal(w.document.documentElement.style.colorScheme,theme);
   assert.equal(w.document.querySelector('meta[name="theme-color"]').content,theme==='dark'?'#0b1a18':'#e7efeb');
   assert.equal(w.document.documentElement.style.backgroundColor,theme==='dark'?'rgb(11, 26, 24)':'rgb(231, 239, 235)');
   assert.equal(w.Backend,undefined); // This runs before the data client and application initialize.
  } finally { dom.window.close(); }
 });
}
test('theme startup survives unavailable browser storage',()=>{
 const dom=new JSDOM(html,{runScripts:'outside-only'});
 try {dom.window.eval(dom.window.document.querySelector('#themeBoot').textContent);assert.equal(dom.window.document.documentElement.dataset.theme,'light');} finally {dom.window.close();}
});
