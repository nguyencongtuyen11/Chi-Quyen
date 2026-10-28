const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM,VirtualConsole} = require('jsdom');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
async function fixture(email='admin@openmusic.vn') {
  const errors=[];
  const virtualConsole=new VirtualConsole();
  virtualConsole.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'https://openmusic.test/?demo=1',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
  const w=dom.window;
  const NativeDate=w.Date;
  w.Date=class extends NativeDate { constructor(...args){super(...(args.length?args:['2026-10-28T10:00:00+07:00']));}static now(){return new NativeDate('2026-10-28T10:00:00+07:00').getTime();} };
  w.matchMedia=q=>({matches:q.includes('max-width')||q.includes('prefers-reduced-motion'),media:q,addEventListener(){},removeEventListener(){}});
  w.confirm=()=>true;w.alert=()=>{};w.HTMLElement.prototype.scrollIntoView=function(){};
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
  w.setInterval=()=>0;
  w.eval(fs.readFileSync(path.join(root,'backend.js'),'utf8'));
  const exposed=['traceDataLoad','loadGlobals','switchView','setAttDate','setViewDate','startOfToday','ymd','dmyToYmd','courseBreakdown','calculateTuition','courseFeeQuote','setMoneyInput','readMoneyInput','openCourseModal','saveCourse','runSalary','runProfit','shiftReportMonth','renderTeachers','openPageSearch','renderPageSearch','markTeacher','openSidebar','closeSidebar','openScheduleModal','saveSchedule'];
  w.eval(source.replace('document.addEventListener("DOMContentLoaded", init);',`window.__test={${exposed.join(',')}};document.addEventListener("DOMContentLoaded", init);`));
  await settle();
  await w.Backend.signIn(email,'123456');
  await settle();
  return {w,doc:w.document,api:w.__test,backend:w.Backend,errors,close:()=>dom.window.close()};
}
async function settle(){for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));}

test('all main admin routes render without runtime errors',async()=>{
 const f=await fixture();try{for(const view of ['today','schedule','students','teachers','salary','tuition','profit','notify','settings']){f.api.switchView(view);await settle();assert.equal(f.doc.querySelector('#view-'+view).hidden,false);assert.ok(f.doc.querySelector('#topViewTitle').textContent);}assert.deepEqual(f.errors,[]);}finally{f.close();}
});
test('dates reject impossible calendar dates',async()=>{
 const f=await fixture();try{assert.equal(f.api.dmyToYmd('31/02/2026'),null);assert.equal(f.api.dmyToYmd('29/02/2028'),'2028-02-29');}finally{f.close();}
});
test('discount calculation validates range and rounds dong once',async()=>{
 const f=await fixture();try{assert.equal(f.api.calculateTuition(200000,10),180000);assert.equal(f.api.calculateTuition(200000,0),200000);assert.equal(f.api.calculateTuition(200000,100),0);assert.equal(f.api.calculateTuition(199999,12.5),174999);assert.throws(()=>f.api.calculateTuition(100,-1));assert.throws(()=>f.api.calculateTuition(100,101));assert.throws(()=>f.api.calculateTuition(NaN,10));}finally{f.close();}
});
test('formatted tuition persists numeric net fee and original percentage',async()=>{
 const f=await fixture();try{
  f.api.openCourseModal('s1',0);
  f.doc.querySelector('#cmFeeMode').value='percent';
  f.doc.querySelector('#cmFeeMode').dispatchEvent(new f.w.Event('change'));
  f.doc.querySelector('#cmBaseFee').value='200000';f.doc.querySelector('#cmBaseFee').dispatchEvent(new f.w.Event('input'));
  f.doc.querySelector('#cmDiscount').value='10';f.doc.querySelector('#cmDiscount').dispatchEvent(new f.w.Event('input'));
  assert.equal(f.doc.querySelector('#cmBaseFee').value,'200.000');assert.equal(f.doc.querySelector('#cmFee').value,'180.000');
  await f.api.saveCourse();await settle();
  const st=(await f.backend.listStudents()).data.find(s=>s.id==='s1');assert.equal(st.tuition_per_session,180000);
  f.api.openCourseModal('s1',0);assert.equal(f.doc.querySelector('#cmFeeMode').value,'percent');assert.equal(f.doc.querySelector('#cmDiscount').value,'10');assert.equal(f.api.readMoneyInput('cmFee'),180000);
  const stored=(await f.backend.getSettings()).data.tuition_adjustment_s1_1;assert.equal(stored.percent,10);assert.equal(stored.net,180000);
 }finally{f.close();}
});
test('search popup filters students and teachers with Vietnamese accents',async()=>{
 const f=await fixture();try{f.api.switchView('students');await settle();f.api.openPageSearch();f.doc.querySelector('#pageSearchInput').value='chau';f.api.renderPageSearch();assert.match(f.doc.querySelector('#pageSearchResults').textContent,/Lê Châu/);assert.equal(f.doc.querySelector('#studentCount').textContent,'1/5 học sinh');f.doc.querySelector('#pageSearchDialog').close();f.api.switchView('teachers');await settle();f.api.openPageSearch();f.doc.querySelector('#pageSearchInput').value='nam';f.api.renderPageSearch();assert.match(f.doc.querySelector('#teacherList').textContent,/Thầy Nam/);assert.doesNotMatch(f.doc.querySelector('#teacherList').textContent,/Cô Lan/);}finally{f.close();}
});
test('calendar renders absent student by name',async()=>{
 const f=await fixture();try{f.api.switchView('schedule');await settle();assert.match(f.doc.querySelector('#weekList').textContent,/Vắng: Phạm Dương/);assert.match(f.doc.querySelector('#weekList').textContent,/Giáo viên/);assert.equal(f.doc.querySelector('#navRange').hidden,true);}finally{f.close();}
});
test('report month navigation handles leap February and year boundaries',async()=>{
 const f=await fixture();try{f.doc.querySelector('#salFrom').value='31/01/2028';f.api.shiftReportMonth('sal',1);assert.equal(f.doc.querySelector('#salFrom').value,'01/02/2028');assert.equal(f.doc.querySelector('#salTo').value,'29/02/2028');await settle();f.doc.querySelector('#proFrom').value='01/12/2026';f.api.shiftReportMonth('pro',1);assert.equal(f.doc.querySelector('#proFrom').value,'01/01/2027');assert.equal(f.doc.querySelector('#proTo').value,'31/01/2027');await settle();}finally{f.close();}
});
test('salary cards and overview table agree and finance totals reconcile',async()=>{
 const f=await fixture();try{f.api.switchView('salary');await settle();await f.api.runSalary();assert.match(f.doc.querySelector('.salary-overview').textContent,/330\.000/);assert.equal(f.doc.querySelectorAll('.salary-card').length,3);assert.equal(f.doc.querySelectorAll('.salary-table tbody tr').length,3);assert.equal(f.doc.querySelector('.salary-all').open,false);f.api.switchView('profit');await settle();await f.api.runProfit();assert.match(f.doc.querySelector('.profit-summary').textContent,/6\.030\.000/);assert.match(f.doc.querySelector('.profit-summary').textContent,/6\.360\.000/);}finally{f.close();}
});
test('teacher may mark a lesson after its end time on the same day',async()=>{
 const f=await fixture('co.lan@openmusic.vn');try{const list=(await f.backend.listSchedules({from:'2026-10-28',to:'2026-10-28'})).data;const s=list.find(s=>s.teacher_id==='t-lan');await f.api.markTeacher(s.id,true);const saved=(await f.backend.listSchedules({from:'2026-10-28',to:'2026-10-28'})).data.find(x=>x.id===s.id);assert.equal(saved.teacher_present,true);assert.deepEqual(f.errors,[]);}finally{f.close();}
});
test('student removal cascades demo attendance, payments and courses',async()=>{
 const f=await fixture();try{await f.backend.addCourse({student_id:'s1',seq:1,total_sessions:12,tuition_per_session:200000});await f.backend.deleteStudent('s1');assert.ok((await f.backend.listCourses()).data.every(c=>c.student_id!=='s1'));assert.ok((await f.backend.listPayments()).data.every(p=>p.student_id!=='s1'));assert.equal((await f.backend.listAttendanceByStudent('s1')).data.length,0);}finally{f.close();}
});
test('course modal preserves zero-fee exceptions',async()=>{
 const f=await fixture();try{f.api.openCourseModal('s1',0);f.doc.querySelector('#cmFeeMode').value='custom';f.api.setMoneyInput('cmFee',0);await f.api.saveCourse();await settle();assert.equal((await f.backend.listStudents()).data.find(s=>s.id==='s1').tuition_per_session,0);f.api.openCourseModal('s1',0);assert.equal(f.api.readMoneyInput('cmFee'),0);}finally{f.close();}
});
test('new course inherits a zero-fee scholarship without replacing it with default pricing',async()=>{
 const f=await fixture();try{f.api.openCourseModal('s1',0);f.doc.querySelector('#cmFeeMode').value='custom';f.api.setMoneyInput('cmFee',0);await f.api.saveCourse();await settle();f.api.openCourseModal('s1');assert.equal(f.api.readMoneyInput('cmFee'),0);}finally{f.close();}
});
test('late response from previous week must not replace the currently selected week',async()=>{
 const f=await fixture();try{const original=f.backend.listSchedules.bind(f.backend);let resolveOld;f.backend.listSchedules=options=>options.from==='2026-10-19'?new Promise(resolve=>{resolveOld=resolve;}):original(options);f.api.setViewDate(new f.w.Date(2026,9,19));f.api.setViewDate(new f.w.Date(2026,9,28));await settle();assert.match(f.doc.querySelector('#weekList').textContent,/Nguyễn An/);resolveOld({data:[],error:null});await settle();assert.match(f.doc.querySelector('#weekList').textContent,/Nguyễn An/);}finally{f.close();}
});
test('profit calculation reports database errors rather than presenting false profit',async()=>{
 const f=await fixture();try{f.api.switchView('profit');await settle();f.backend.listSchedules=async()=>({data:null,error:{message:'Network unavailable'}});await f.api.runProfit();assert.match(f.doc.querySelector('#profitResult').textContent,/Lỗi|Không thể/);assert.equal(f.doc.querySelector('.profit-net'),null);}finally{f.close();}
});
test('sign-out closes native dialogs containing private data',async()=>{
 const f=await fixture();try{f.api.switchView('students');await settle();f.api.openPageSearch();assert.equal(f.doc.querySelector('#pageSearchDialog').open,true);await f.backend.signOut();await settle();assert.equal(f.doc.querySelector('#pageSearchDialog').open,false);assert.equal(f.doc.querySelector('#app').classList.contains('hidden'),true);}finally{f.close();}
});
test('schedule student-sync failure is visible and does not show success',async()=>{
 const f=await fixture();try{await f.api.openScheduleModal(null,'2026-10-28','sang');f.doc.querySelector('#fSubject').value='Piano';f.doc.querySelector('#fOwner').value='t-lan';f.doc.querySelector('#fStart').value='10:00';f.doc.querySelector('#fEnd').value='11:00';f.doc.querySelector('#fStudents input').checked=true;f.backend.setAttendance=async()=>({error:{message:'Attendance write failed'}});await f.api.saveSchedule();assert.match(f.doc.querySelector('#formErr').textContent,/Attendance write failed/);assert.equal(f.doc.querySelector('#modal').classList.contains('hidden'),false);}finally{f.close();}
});

test('profit uses Vietnam payment date rather than the UTC day',async()=>{
 const f=await fixture();try{f.api.switchView('profit');await settle();f.doc.querySelector('#proFrom').value='28/10/2026';f.doc.querySelector('#proTo').value='28/10/2026';f.backend.listPayments=async()=>({data:[{paid_at:'2026-10-27T17:30:00Z',amount:123456}],error:null});await f.api.runProfit();assert.match(f.doc.querySelector('.profit-summary').textContent,/123\.456/);}finally{f.close();}
});
test('salary does not present a zero wage after attendance lookup fails',async()=>{
 const f=await fixture();try{f.api.switchView('salary');await settle();f.backend.listAttendanceBySchedules=async()=>({data:null,error:{message:'Attendance offline'}});await f.api.runSalary();assert.match(f.doc.querySelector('#salaryResult').textContent,/Không thể tính lương/);assert.equal(f.doc.querySelector('.salary-overview'),null);}finally{f.close();}
});

test('retrying a partially saved schedule updates its existing row',async()=>{
 const f=await fixture();try{await f.api.openScheduleModal(null,'2026-10-28','sang');f.doc.querySelector('#fSubject').value='Piano';f.doc.querySelector('#fOwner').value='t-lan';f.doc.querySelector('#fStart').value='10:00';f.doc.querySelector('#fEnd').value='11:00';f.doc.querySelector('#fStudents input').checked=true;const original=f.backend.setAttendance;f.backend.setAttendance=async()=>({error:{message:'Attendance write failed'}});await f.api.saveSchedule();const savedId=f.doc.querySelector('#schedId').value;assert.ok(savedId);f.backend.setAttendance=original;await f.api.saveSchedule();const rows=(await f.backend.listSchedules({from:'2026-10-28',to:'2026-10-28'})).data;assert.equal(rows.filter(s=>s.start_time==='10:00').length,1);assert.equal(f.doc.querySelector('#modal').classList.contains('hidden'),true);}finally{f.close();}
});


test('startup reads payments and attendance while teacher lookup is still pending',async()=>{
 const f=await fixture();try{
  let finishTeachers; const original=f.backend.listTeachers.bind(f.backend); const teachers=await original();
  f.backend.listTeachers=()=>new Promise(resolve=>{finishTeachers=resolve;});
  let paymentsStarted=false,attendanceStarted=false,duplicateCount=false;
  const pay=f.backend.listPayments.bind(f.backend),att=f.backend.listAttendanceWithDates.bind(f.backend);
  f.backend.listPayments=()=>{paymentsStarted=true;return pay();};
  f.backend.listAttendanceWithDates=()=>{attendanceStarted=true;return att();};
  f.backend.countPresentByStudent=()=>{duplicateCount=true;return {data:{}};};
  const loading=f.api.loadGlobals();
  await Promise.resolve();assert.equal(paymentsStarted,true);assert.equal(attendanceStarted,true);assert.equal(duplicateCount,false);
  finishTeachers(teachers);await loading;
 }finally{f.close();}
});

test('an unresponsive data read has a named error instead of infinite loading',async()=>{
 const f=await fixture();try{await assert.rejects(f.api.traceDataLoad('Lịch sử điểm danh',()=>new Promise(()=>{}),10),/Lịch sử điểm danh.*không phản hồi/);}finally{f.close();}
});
