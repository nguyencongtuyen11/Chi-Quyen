const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
let count = 0;
for (const name of ['app.js','backend.js','config.js','sw.js']) {
  const source = fs.readFileSync(path.join(root,name),'utf8');
  acorn.parse(source,{ecmaVersion:'latest',sourceType:'script',locations:true});
  count += source.split('\n').length;
}
const doc = new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8')).window.document;
const ids = new Set();
for (const el of doc.querySelectorAll('[id]')) {
  if(ids.has(el.id)) throw Error('Duplicate HTML id: '+el.id);
  ids.add(el.id);
}
const app = fs.readFileSync(path.join(root,'app.js'),'utf8');
for(const match of app.matchAll(/\$\("([\w-]+)"\)/g)) {
  if(!ids.has(match[1]) && !['logoutBtn'].includes(match[1])) throw Error('Missing static element: '+match[1]);
}
for(const el of doc.querySelectorAll('script[src],link[href],img[src]')) {
  const value=el.getAttribute('src')||el.getAttribute('href');
  if(value&&!/^(https?:|data:|#)/.test(value)&&!fs.existsSync(path.join(root,value))) throw Error('Missing local asset: '+value);
}
const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
for(const icon of manifest.icons||[]) if(!fs.existsSync(path.join(root,icon.src)))throw Error('Missing PWA icon: '+icon.src);
console.log(`Parsed ${count} JavaScript lines; checked ${ids.size} unique HTML IDs, referenced elements, local assets and PWA manifest.`);
