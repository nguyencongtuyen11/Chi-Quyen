import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import webpush from 'npm:web-push@3.6.7';
import {reminderFor,validateSubscription} from '../_shared/push-core.mjs';
const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-cron-secret','Access-Control-Allow-Methods':'POST, OPTIONS'};
const reply = (body:unknown,status=200) => Response.json(body,{status,headers});
function required(name:string){const value=Deno.env.get(name);if(!value)throw new Error('Thiếu cấu hình máy chủ: '+name);return value;}
function checked(result:any){if(result.error)throw result.error;return result.data;}
async function pages(db:any,table:string,columns='*') {const rows=[];for(let offset=0;;offset+=1000){const page=checked(await db.from(table).select(columns).order('id').range(offset,offset+999));rows.push(...page);if(page.length<1000)return rows;}}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 try{
  const body=await req.json();
  const publicKey=required('WEB_PUSH_PUBLIC_KEY');
  if(body.action==='config')return reply({publicKey});
  webpush.setVapidDetails(required('WEB_PUSH_SUBJECT'),publicKey,required('WEB_PUSH_PRIVATE_KEY'));
  const db=createClient(required('SUPABASE_URL'),required('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
  if(body.action==='dispatch'){
   const supplied=req.headers.get('x-cron-secret') || '';
   if(supplied.length<32 || supplied!==required('WEB_PUSH_CRON_SECRET'))return reply({error:'Unauthorized'},401);
   const now=new Date(), vn=new Date(now.getTime()+7*3600000), from=vn.toISOString().slice(0,10), to=new Date(vn.getTime()+86400000).toISOString().slice(0,10);
   const [subs,profiles,teachers]=await Promise.all([pages(db,'push_subscriptions'),pages(db,'profiles','id,role'),pages(db,'teachers','id,user_id')]);
   const schedules=[];
   for(let offset=0;;offset+=1000){const batch=checked(await db.from('schedules').select('id,teacher_id,schedule_date,start_time,subject,room,teacher_present').gte('schedule_date',from).lte('schedule_date',to).order('id').range(offset,offset+999));schedules.push(...batch);if(batch.length<1000)break;}
   let sent=0,failed=0;
   const jobs=[];
   for(const schedule of schedules){for(const sub of subs){
    const payload=reminderFor(schedule,sub,teachers.find(t=>t.id===schedule.teacher_id),profiles.find(p=>p.id===sub.user_id)?.role,now);
    if(payload)jobs.push({schedule,sub,payload});
   }}
   // Bound each invocation and send at most five in parallel.
   for(let offset=0;offset<Math.min(jobs.length,50);offset+=5){
    await Promise.all(jobs.slice(offset,Math.min(offset+5,50)).map(async ({schedule,sub,payload})=>{
     if(!checked(await db.rpc('claim_push_delivery',{p_sub:sub.id,p_schedule:schedule.id,p_start:payload.start_at})))return;
     try{
      await webpush.sendNotification({endpoint:sub.endpoint,keys:sub.keys},JSON.stringify(payload),{TTL:300,timeout:8000,urgency:'high'});
      checked(await db.from('push_deliveries').update({status:'sent',sent_at:new Date().toISOString()}).eq('subscription_id',sub.id).eq('schedule_id',schedule.id).eq('start_at',payload.start_at));sent++;
     }catch(error:any){
      failed++;
      if([404,410].includes(error.statusCode))checked(await db.from('push_subscriptions').delete().eq('id',sub.id));
      else checked(await db.from('push_deliveries').update({status:'failed'}).eq('subscription_id',sub.id).eq('schedule_id',schedule.id).eq('start_at',payload.start_at));
      console.error('Push delivery failed',{status:error.statusCode || 0});
     }
    }));
   }
   return reply({sent,failed});
  }
  const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  const {data:auth,error:authError}=await db.auth.getUser(token);
  if(authError||!auth.user)return reply({error:'Bạn cần đăng nhập lại.'},401);
  const uid=auth.user.id;
  const subscription=validateSubscription(body.subscription);
  const existing=checked(await db.from('push_subscriptions').select('id,user_id,last_test_at').eq('endpoint',subscription.endpoint).maybeSingle());
  if(existing && existing.user_id!==uid)return reply({error:'Thiết bị đang gắn với tài khoản khác. Hãy tắt thông báo ở tài khoản đó trước.'},409);
  if(body.action==='subscribe'){
   const lead=Number(body.leadMinutes);
   if(!Number.isInteger(lead)||lead<0||lead>1440)return reply({error:'Số phút nhắc phải từ 0 đến 1440.'},400);
   checked(await db.from('push_subscriptions').upsert({user_id:uid,...subscription,lead_minutes:lead,updated_at:new Date().toISOString()},{onConflict:'endpoint'}));
   return reply({subscribed:true});
  }
  if(body.action==='unsubscribe'){
   checked(await db.from('push_subscriptions').delete().eq('endpoint',subscription.endpoint).eq('user_id',uid));return reply({subscribed:false});
  }
  if(body.action==='test'){
   if(!existing)return reply({error:'Hãy bật thông báo trên thiết bị này trước.'},400);
   const cutoff=new Date(Date.now()-30000).toISOString();
   const claimed=checked(await db.from('push_subscriptions').update({last_test_at:new Date().toISOString()}).eq('id',existing.id).or(`last_test_at.is.null,last_test_at.lt.${cutoff}`).select('id'));
   if(!claimed.length)return reply({error:'Chờ 30 giây trước khi thử lại.'},429);
   await webpush.sendNotification(subscription,JSON.stringify({title:'OPENMUSIC',body:'Thiết bị đã nhận được thông báo từ máy chủ.',tag:'openmusic-test',url:'/'}),{TTL:60,timeout:8000});return reply({sent:true});
  }
  return reply({error:'Thao tác không hợp lệ.'},400);
 }catch(error:any){console.error('Web push error:',error.message);return reply({error:'Không thể xử lý thông báo. Kiểm tra cấu hình Web Push trên Supabase.'},500);}
});
