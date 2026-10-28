// Run locally once. Private keys remain in ignored files, never in frontend assets.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const envPath=path.join(root,'.env.push');
if(!fs.existsSync(envPath)){
 const {privateKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const key=privateKey.export({format:'jwk'});
 const publicKey=Buffer.concat([Buffer.from([4]),Buffer.from(key.x,'base64url'),Buffer.from(key.y,'base64url')]).toString('base64url');
 fs.writeFileSync(envPath,`WEB_PUSH_PUBLIC_KEY=${publicKey}\nWEB_PUSH_PRIVATE_KEY=${key.d}\nWEB_PUSH_SUBJECT=https://chi-quyen.vercel.app\nWEB_PUSH_CRON_SECRET=${crypto.randomBytes(32).toString('hex')}\n`,{mode:0o600});
}
const env=Object.fromEntries(fs.readFileSync(envPath,'utf8').trim().split(/\r?\n/).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
const secret=env.WEB_PUSH_CRON_SECRET;
if(!/^[a-f0-9]{64}$/.test(secret))throw Error('Invalid private cron secret');
const sql=`create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
do $setup$ declare secret_id uuid; begin
 select id into secret_id from vault.secrets where name='openmusic_push_cron';
 if secret_id is null then perform vault.create_secret('${secret}','openmusic_push_cron');
 else perform vault.update_secret(secret_id,'${secret}'); end if;
end $setup$;
select cron.unschedule(jobid) from cron.job where jobname='openmusic-push-every-minute';
select cron.schedule('openmusic-push-every-minute','* * * * *',$job$
 select net.http_post(
  url:='https://ivilqvnljoucbsxzdvwf.supabase.co/functions/v1/web-push',
  headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='openmusic_push_cron')),
  body:='{"action":"dispatch"}'::jsonb,timeout_milliseconds:=100000);
$job$);
`;
fs.writeFileSync(path.join(root,'supabase/push-activate.local.sql'),sql,{mode:0o600});
console.log('Private push configuration prepared. No secret values printed.');
