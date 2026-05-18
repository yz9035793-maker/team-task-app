// v1
import { createClient } from "jsr:@supabase/supabase-js@2";

const VAPID_PUBLIC = 'BIEq7AFKTGoqecCwoEF1nvmfMopaq2za_PbYsye-LROfCLDMO-mF83AcsrI1PZkRi3ah46LeYQJembcie-gejUE';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = 'mailto:admin@nagasakikamasho.com';

// Base64url helpers
function base64urlToUint8(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function uint8ToBase64url(arr: Uint8Array): string {
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function getVapidAuthHeader(audience: string): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 43200, sub: VAPID_SUBJECT };

  const enc = new TextEncoder();
  const toSign = uint8ToBase64url(enc.encode(JSON.stringify(header))) + '.' +
    uint8ToBase64url(enc.encode(JSON.stringify(payload)));

  const privKeyData = base64urlToUint8(VAPID_PRIVATE);
  const privateKey = await crypto.subtle.importKey(
    'raw', privKeyData,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  );

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    enc.encode(toSign)
  );

  const jwt = toSign + '.' + uint8ToBase64url(new Uint8Array(sig));
  return `vapid t=${jwt},k=${VAPID_PUBLIC}`;
}

async function sendPushNotification(subscription: any, title: string, body: string): Promise<void> {
  const endpoint: string = subscription.endpoint;
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;

  const authHeader = await getVapidAuthHeader(audience);
  const payload = JSON.stringify({ title, body, icon: '/icon.png' });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'TTL': '86400',
    },
    body: payload,
  });

  if (!response.ok) {
    console.error(`Push failed: ${response.status} ${await response.text()}`);
  }
}

Deno.serve(async (_req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 明日の日付を計算
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // 明日が期日で完了以外のタスクを取得
    const { data: tasks, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('due', tomorrowStr)
      .neq('status', 'done');

    if (taskError) throw taskError;
    if (!tasks || tasks.length === 0) {
      return new Response(JSON.stringify({ message: '対象タスクなし' }), { status: 200 });
    }

    // メンバーごとに通知
    const results = [];
    for (const task of tasks) {
      // 担当者のメールアドレスを取得
      const { data: users } = await supabase.auth.admin.listUsers();
      const memberEmail = users?.users?.find(u => {
        const local = u.email?.split('@')[0].toLowerCase() ?? '';
        const memberMap: Record<string, string> = {
          'oshio': '小塩', 'takeda': '竹田', 'nakashima': '中嶋',
          'matsukawa': '松川', 'sasaki': '佐々木', 'nakashita': '中下'
        };
        for (const [key, name] of Object.entries(memberMap)) {
          if ((local === key || local.endsWith('-' + key) || local.startsWith(key + '-')) && name === task.member) return true;
        }
        return false;
      })?.email;

      if (!memberEmail) continue;

      // 購読情報を取得
      const { data: sub } = await supabase
        .from('push_subscriptions')
        .select('subscription')
        .eq('user_email', memberEmail)
        .single();

      if (!sub?.subscription) continue;

      await sendPushNotification(
        sub.subscription,
        '📅 明日の期日リマインド',
        `明日「${task.title}」の期日です`
      );

      results.push({ task: task.title, member: task.member, sent: true });
    }

    return new Response(JSON.stringify({ sent: results.length, results }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
