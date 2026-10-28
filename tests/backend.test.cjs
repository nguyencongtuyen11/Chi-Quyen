const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function fixture(rows, failAt=Infinity){
 const calls=[];
 const client={auth:{},from(table){
  let lo=0, hi=999, filter=null;
  const query={select(){return this;},order(){return this;},gte(){return this;},lte(){return this;},eq(){return this;},in(column,ids){filter={column,ids};return this;},range(from,to){lo=from;hi=to;return this;},then(resolve,reject){calls.push({table,lo,hi,filter});return Promise.resolve(lo>=failAt?{data:null,error:{message:'Page failed'}}:{data:(filter?rows.filter(r=>filter.ids.includes(r[filter.column])):rows).slice(lo,hi+1),error:null}).then(resolve,reject);}};
  return query;
 }};
 const context={window:{APP_CONFIG:{SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'public'},supabase:{createClient:()=>client}},location:{search:'',hash:''},localStorage:{getItem:()=>null},URLSearchParams,console};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../backend.js'),'utf8'),context);
 return {b:context.window.Backend,calls};
}
test('Supabase list methods retrieve rows beyond the first 1000',async()=>{
 const rows=Array.from({length:2101},(_,i)=>({id:String(i),student_id:'student',present:true,teacher_id:'teacher',teacher_present:true,key:String(i),value:i}));
 const {b}=fixture(rows);
 for(const method of ['listProfiles','listTeachers','listStudents','listPayments','listCourses'])assert.equal((await b[method]()).data.length,2101,method);
 assert.equal((await b.listSchedules({from:'2026-01-01',to:'2026-12-31'})).data.length,2101);
 assert.equal((await b.countPresentByStudent()).data.student,2101);
 assert.equal((await b.teacherStats()).data.teacher.taught,2101);
 assert.equal(Object.keys((await b.getSettings()).data).length,2101);
});
test('pagination discards partial results when any page fails',async()=>{
 const {b}=fixture(Array.from({length:1100},(_,i)=>({id:String(i)})),1000);
 const result=await b.listPayments();assert.equal(result.data,null);assert.equal(result.error.message,'Page failed');
});
test('attendance ID queries are chunked and include all matching rows',async()=>{
 const rows=Array.from({length:205},(_,i)=>({id:String(i),schedule_id:'schedule-'+i}));
 const {b,calls}=fixture(rows);const result=await b.listAttendanceBySchedules(rows.map(r=>r.schedule_id));
 assert.equal(result.data.length,205);assert.equal(calls.length,3);assert.ok(calls.every(c=>c.filter.ids.length<=100));
});

test('configured production fails closed if the Supabase client cannot load',()=>{
 const context={window:{APP_CONFIG:{SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'public'}},location:{search:''},localStorage:{getItem:()=>null},URLSearchParams};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../backend.js'),'utf8'),context);
 assert.equal(context.window.Backend.mode,'unavailable');
});

test('auth consumer starts after Supabase releases its callback',()=>{
 let listener; const queued=[],events=[];
 const context={window:{APP_CONFIG:{SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'public'},supabase:{createClient:()=>({auth:{onAuthStateChange(cb){listener=cb;}}})}},location:{search:''},localStorage:{getItem:()=>null},URLSearchParams,setTimeout:cb=>queued.push(cb)};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../backend.js'),'utf8'),context);
 context.window.Backend.onAuthChange((event,user)=>events.push({event,user}));
 listener('SIGNED_IN',{user:{id:'teacher'}});assert.equal(events.length,0);assert.equal(queued.length,1);
 queued.shift()();assert.equal(events[0].event,'SIGNED_IN');assert.equal(events[0].user.id,'teacher');
});
