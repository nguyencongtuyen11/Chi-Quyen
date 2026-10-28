export function validateSubscription(value) {
  const endpoint = new URL(value?.endpoint || '');
  const host = endpoint.hostname;
  const trusted = ['web.push.apple.com','fcm.googleapis.com','updates.push.services.mozilla.com'].includes(host) || host.endsWith('.notify.windows.com');
  if (endpoint.protocol !== 'https:' || endpoint.port || endpoint.username || endpoint.password || !trusted) throw new Error('Thiết bị gửi địa chỉ push không hợp lệ.');
  const key = value?.keys?.p256dh, auth = value?.keys?.auth;
  if (!/^[A-Za-z0-9_-]{87}=?$/.test(key || '') || !/^[A-Za-z0-9_-]{22}={0,2}$/.test(auth || '')) throw new Error('Khóa thiết bị không hợp lệ.');
  return {endpoint: endpoint.href, keys: {p256dh:key,auth}};
}
export function reminderFor(schedule, subscription, teacher, role, now = new Date()) {
  if (role !== 'admin' && teacher?.user_id !== subscription.user_id) return null;
  if (schedule.teacher_present === false) return null;
  const lead = Number(subscription.lead_minutes);
  if (!Number.isInteger(lead) || lead < 0 || lead > 1440) return null;
  const start = new Date(`${schedule.schedule_date}T${schedule.start_time}+07:00`);
  const due = start.getTime() - lead * 60000;
  // Catch a brief scheduler delay, but never send a lesson reminder after class starts.
  if (!Number.isFinite(due) || now.getTime() < due || now.getTime() - due >= 300000 || (lead > 0 && now >= start)) return null;
  return {start_at:start.toISOString(), title:'OPENMUSIC — Sắp đến giờ lớp', body:`${schedule.start_time.slice(0,5)} — ${schedule.subject}${schedule.room ? ' — '+schedule.room : ''}`, tag:`lesson-${schedule.id}-${start.toISOString()}`, url:'/?view=today'};
}
