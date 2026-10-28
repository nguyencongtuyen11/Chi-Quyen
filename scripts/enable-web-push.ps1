$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$pushProjectRef = 'ivilqvnljoucbsxzdvwf'
node scripts/prepare-push.cjs
if ($LASTEXITCODE -ne 0) { throw 'Cannot prepare push keys.' }
npx --yes supabase projects list
if ($LASTEXITCODE -ne 0) { throw 'Run npx --yes supabase login, sign in to your Supabase account, then run this script again.' }
npx --yes supabase db query --linked --project-ref $pushProjectRef --file supabase/migrations/20261028061428_web_push_reminders.sql
if ($LASTEXITCODE -ne 0) { throw 'Push schema migration failed.' }
npx --yes supabase secrets set --project-ref $pushProjectRef --env-file .env.push
if ($LASTEXITCODE -ne 0) { throw 'Setting private push secrets failed.' }
npx --yes supabase functions deploy web-push --project-ref $pushProjectRef --use-api
if ($LASTEXITCODE -ne 0) { throw 'Push function deployment failed.' }
npx --yes supabase db query --linked --project-ref $pushProjectRef --file supabase/push-activate.local.sql
if ($LASTEXITCODE -ne 0) { throw 'Push scheduler activation failed.' }
npx --yes supabase db query --linked --project-ref $pushProjectRef "select jobname,schedule,active from cron.job where jobname='openmusic-push-every-minute';"
if ($LASTEXITCODE -ne 0) { throw 'Could not verify the scheduler.' }
Write-Host 'Server configured. On iPhone: open Home Screen app, tap bell > enable notifications > Send test.'
