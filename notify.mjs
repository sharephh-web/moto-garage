import fs from 'node:fs';
import crypto from 'node:crypto';
import webpush from 'web-push';

const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const wr = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2));

// 1) 푸시용 키: 처음 한 번만 자동 생성 (이 비공개 저장소에 보관)
let vapid = rd('vapid.json', null);
if (!vapid) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' }), prv = privateKey.export({ format: 'jwk' });
  vapid = {
    publicKey: Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString('base64url'),
    privateKey: prv.d
  };
  wr('vapid.json', vapid);
  console.log('푸시 키를 새로 만들었습니다.');
}
wr('vapid-public.json', { publicKey: vapid.publicKey });
webpush.setVapidDetails('mailto:garage-bot@users.noreply.github.com', vapid.publicKey, vapid.privateKey);

// 2) 알릴 내용 계산 (소모품 사용률 85% 이상, 오늘/내일 일정)
const data = rd('garage-data.json', { bikes: [] });
const kst = new Date(Date.now() + 9 * 3600e3);
const ymd = d => d.toISOString().slice(0, 10);
const today = ymd(kst), tomorrow = ymd(new Date(kst.getTime() + 864e5));
const km = v => Number(v).toLocaleString('ko-KR');
const lines = [];
for (const b of data.bikes || []) {
  for (const c of b.consumables || []) {
    const interval = Number(c.interval) || 0;
    if (!interval) continue;
    const used = Math.max(0, Number(b.odo) - Number(c.lastOdo || 0)), pct = used / interval * 100, remain = interval - used;
    if (pct >= 100) lines.push(`${b.name} · ${c.name}: ${km(Math.abs(remain))}km 초과! 교체가 필요해요`);
    else if (pct >= 85) lines.push(`${b.name} · ${c.name}: ${Math.round(pct)}% 사용 (${km(remain)}km 남음)`);
  }
  for (const e of b.events || []) {
    if (e.done) continue;
    if (e.date === today) lines.push(`오늘 일정: ${e.title}`);
    else if (e.date === tomorrow) lines.push(`내일 일정: ${e.title}`);
  }
}
const test = process.env.FORCE === 'test';
if (!lines.length && !test) { console.log('보낼 알림이 없습니다.'); process.exit(0); }

// 3) 등록된 기기로 발송
const body = lines.length
  ? lines.slice(0, 5).join('\n') + (lines.length > 5 ? `\n외 ${lines.length - 5}건` : '')
  : '알림 서버 연결 확인: 정상 작동 중입니다.';
const payload = JSON.stringify({ title: 'MOTO GARAGE', body, tag: 'garage-daily' });
const subs = rd('push-subs.json', []), alive = [];
for (const s of subs) {
  try { await webpush.sendNotification(s, payload); alive.push(s); console.log('발송 성공'); }
  catch (e) {
    console.log('발송 실패', e.statusCode);
    if (e.statusCode !== 404 && e.statusCode !== 410) alive.push(s);   // 만료된 기기만 정리
  }
}
if (alive.length !== subs.length) wr('push-subs.json', alive);
console.log(`기기 ${subs.length}대, 알림 ${lines.length}건`);
