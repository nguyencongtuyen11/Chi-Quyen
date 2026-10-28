import webpush from 'npm:web-push@3.6.7';
import {randomBytes} from 'node:crypto';
Deno.test('Web Push encryption creates an encrypted Apple push request',()=>{
 const app=webpush.generateVAPIDKeys(),device=webpush.generateVAPIDKeys();
 webpush.setVapidDetails('https://chi-quyen.vercel.app',app.publicKey,app.privateKey);
 const request=webpush.generateRequestDetails({endpoint:'https://web.push.apple.com/test-only-not-sent',keys:{p256dh:device.publicKey,auth:randomBytes(16).toString('base64url')}},JSON.stringify({title:'OPENMUSIC'}));
 if(!request.body || request.body.length<32 || !request.headers.Authorization)throw new Error('Push encryption failed');
});
