const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const core=()=>import('../supabase/functions/_shared/push-core.mjs');
const lesson={id:'lesson',teacher_id:'t1',schedule_date:'2026-10-28',start_time:'18:30:00',subject:'Piano',room:'P.201',teacher_present:null};
const subscription={user_id:'u1',lead_minutes:120};
test('server reminder uses Vietnam time and respects recipient ownership',async()=>{
 const {reminderFor}=await core();const now=new Date('2026-10-28T09:30:20Z');
 assert.equal(reminderFor(lesson,subscription,{user_id:'u1'},'teacher',now).start_at,'2026-10-28T11:30:00.000Z');
 assert.equal(reminderFor(lesson,subscription,{user_id:'someone-else'},'teacher',now),null);
 assert.ok(reminderFor(lesson,subscription,{user_id:'someone-else'},'admin',now));
});
test('server reminder skips early, stale and cancelled lessons',async()=>{
 const {reminderFor}=await core();const check=(s,time)=>reminderFor(s,subscription,{user_id:'u1'},'teacher',new Date(time));
 assert.equal(check(lesson,'2026-10-28T09:29:59Z'),null);
 assert.equal(check(lesson,'2026-10-28T09:35:00Z'),null);
 assert.equal(check({...lesson,teacher_present:false},'2026-10-28T09:30:00Z'),null);
 assert.ok(reminderFor(lesson,{...subscription,lead_minutes:0},{user_id:'u1'},'teacher',new Date('2026-10-28T11:30:15Z')));
});
test('trial reminder goes only to admins, at the configured lead, in Vietnam time',async()=>{
 const {trialReminderFor}=await core();
 const trial={id:'tr1',full_name:'Bé Khang',phone:'0912',subject:'Piano',start_at:'2026-10-29T09:00:00Z',status:'pending'}; // 16:00 VN
 const due=new Date('2026-10-29T08:00:10Z'); // trước 60 phút
 const p=trialReminderFor(trial,subscription,'admin',60,due);
 assert.equal(p.start_at,'2026-10-29T09:00:00.000Z');assert.match(p.body,/^16:00 — Bé Khang/);assert.equal(p.url,'/?view=trials');
 assert.equal(trialReminderFor(trial,subscription,'teacher',60,due),null);
 assert.equal(trialReminderFor({...trial,status:'cancelled'},subscription,'admin',60,due),null);
 assert.equal(trialReminderFor(trial,subscription,'admin',60,new Date('2026-10-29T07:59:00Z')),null); // quá sớm
 assert.equal(trialReminderFor(trial,subscription,'admin',60,new Date('2026-10-29T08:06:00Z')),null); // cron trễ quá 5 phút
 assert.equal(trialReminderFor(trial,subscription,'admin',60,new Date('2026-10-29T09:00:01Z')),null); // đã tới giờ
 assert.equal(trialReminderFor(trial,subscription,'admin',-5,due),null);
});
test('subscription rejects arbitrary server destinations and malformed device keys',async()=>{
 const {validateSubscription}=await core();const keys={p256dh:'A'.repeat(87),auth:'B'.repeat(22)};
 assert.equal(validateSubscription({endpoint:'https://web.push.apple.com/device',keys}).endpoint,'https://web.push.apple.com/device');
 for(const endpoint of ['https://127.0.0.1/device','https://web.push.apple.com.evil.test/a','http://web.push.apple.com/a','https://user:pass@web.push.apple.com/a'])assert.throws(()=>validateSubscription({endpoint,keys}));
 assert.throws(()=>validateSubscription({endpoint:'https://web.push.apple.com/a',keys:{p256dh:'bad',auth:'bad'}}));
});
function worker(){const handlers={},shown=[],opened=[];const self={location:{origin:'https://chi-quyen.vercel.app'},addEventListener:(name,cb)=>handlers[name]=cb,registration:{showNotification:async(title,options)=>shown.push({title,options})},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8'),{self,URL,Response});return {handlers,shown,opened};}
test('service worker shows visible fallback even for malformed push data',async()=>{
 const w=worker();let work;w.handlers.push({data:{json(){throw Error('invalid');}},waitUntil:p=>work=p});await work;assert.equal(w.shown[0].title,'OPENMUSIC');assert.ok(w.shown[0].options.body);
});
test('notification clicks open the app but cannot redirect to another origin',async()=>{
 const w=worker();let work;const event=url=>({notification:{close(){},data:{url}},waitUntil:p=>work=p});w.handlers.notificationclick(event('/?view=today'));await work;assert.equal(w.opened[0],'https://chi-quyen.vercel.app/?view=today');w.handlers.notificationclick(event('https://evil.test/'));await work;assert.equal(w.opened.length,1);
});
