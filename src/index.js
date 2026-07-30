const AXES = ['similar', 'suki', 'tpo'];
const AXIS_LABELS = { similar: '似合う', suki: '好き', tpo: 'TPO' };

const TYPE_LABELS = {
  jikoryu: '自己流タイプ',
  yutosei: '優等生タイプ',
  itten: '一点集中タイプ',
  jikoryu_yutosei: '自己流×優等生タイプ',
  jikoryu_itten: '自己流×一点集中タイプ',
  yutosei_itten: '優等生×一点集中タイプ',
  jikoryu_yutosei_itten: '自己流×優等生×一点集中タイプ',
  allround: 'オールラウンド基準タイプ',
};

// public/index.html の QUESTIONS と対応（設問ごとのYes/No集計に使う）
const QUESTIONS = [
  { text: 'パーソナルカラーを知っていて、似合う色が選べる', axis: 'similar' },
  { text: '自分の好きなテイストがはっきりわかっている', axis: 'suki' },
  { text: '行く場所で選べる服を持っている（ママ友とのランチ会・ちょっといいお店）', axis: 'tpo' },
  { text: '骨格タイプを知っていて、スタイルがよく見える服が選べる', axis: 'similar' },
  { text: 'クローゼットを見て、好きな服が多いと感じる', axis: 'suki' },
  { text: '会う人に合わせて服を選べている', axis: 'tpo' },
  { text: '顔タイプを知っていて、似合うテイストのブランドが選べる', axis: 'similar' },
  { text: '好きなブランドのお店が2つ以上ある', axis: 'suki' },
  { text: 'クローゼットを開けて、5秒で「今日はコレ」と選べる', axis: 'tpo' },
];

function determineType(similar, suki, tpo) {
  const total = similar + suki + tpo;
  if (total === 9) return 'allround';
  const scores = { similar, suki, tpo };
  const min = Math.min(similar, suki, tpo);
  const minAxes = AXES.filter((k) => scores[k] === min);
  if (minAxes.length === 1) {
    if (minAxes[0] === 'similar') return 'jikoryu';
    if (minAxes[0] === 'suki') return 'yutosei';
    return 'itten';
  }
  if (minAxes.length === 2) {
    const set = minAxes.join(',');
    if (set === 'similar,suki') return 'jikoryu_yutosei';
    if (set === 'similar,tpo') return 'jikoryu_itten';
    return 'yutosei_itten';
  }
  return 'jikoryu_yutosei_itten';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/result' && request.method === 'POST') {
      return submitResult(request, env);
    }
    if (url.pathname === '/api/stats' && request.method === 'GET') {
      return getStats(request, env);
    }
    if (url.pathname === '/api/export' && request.method === 'GET') {
      return exportCsv(request, env);
    }
    if (url.pathname === '/admin') {
      return adminPage(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

function hasValidKey(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  return Boolean(env.ADMIN_KEY) && key === env.ADMIN_KEY;
}

async function submitResult(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const answers = body && body.answers;
  if (!Array.isArray(answers) || answers.length !== QUESTIONS.length || !answers.every((a) => a === 0 || a === 1)) {
    return new Response('Invalid answers', { status: 400 });
  }

  const scores = { similar: 0, suki: 0, tpo: 0 };
  QUESTIONS.forEach((q, i) => {
    scores[q.axis] += answers[i];
  });

  const resultType = determineType(scores.similar, scores.suki, scores.tpo);

  await env.DB.prepare(
    `INSERT INTO responses (created_at, result_type, answers, similar_score, suki_score, tpo_score)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(new Date().toISOString(), resultType, JSON.stringify(answers), scores.similar, scores.suki, scores.tpo)
    .run();

  return new Response(JSON.stringify({ ok: true, resultType }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function fetchAllRows(env) {
  const rows = await env.DB.prepare(
    'SELECT created_at, result_type, answers, similar_score, suki_score, tpo_score FROM responses ORDER BY id ASC'
  ).all();
  return rows.results.map((row) => ({
    created_at: row.created_at,
    result_type: row.result_type,
    answers: JSON.parse(row.answers),
    similar_score: row.similar_score,
    suki_score: row.suki_score,
    tpo_score: row.tpo_score,
  }));
}

function buildPerQuestionBreakdown(rows) {
  const total = rows.length;
  return QUESTIONS.map((q, qIndex) => {
    let yes = 0;
    rows.forEach((r) => {
      if (r.answers[qIndex] === 1) yes++;
    });
    const no = total - yes;
    return {
      text: q.text,
      yes,
      no,
      yesPct: total ? Math.round((yes / total) * 1000) / 10 : 0,
      noPct: total ? Math.round((no / total) * 1000) / 10 : 0,
    };
  });
}

function buildByType(rows) {
  const counts = {};
  rows.forEach((r) => {
    counts[r.result_type] = (counts[r.result_type] || 0) + 1;
  });
  return Object.keys(TYPE_LABELS)
    .filter((k) => counts[k])
    .map((k) => ({ key: k, label: TYPE_LABELS[k], count: counts[k] }))
    .sort((a, b) => b.count - a.count);
}

function buildAxisAverages(rows) {
  const total = rows.length;
  if (!total) return { similar: 0, suki: 0, tpo: 0 };
  const sums = { similar: 0, suki: 0, tpo: 0 };
  rows.forEach((r) => {
    sums.similar += r.similar_score;
    sums.suki += r.suki_score;
    sums.tpo += r.tpo_score;
  });
  return {
    similar: Math.round((sums.similar / total) * 100) / 100,
    suki: Math.round((sums.suki / total) * 100) / 100,
    tpo: Math.round((sums.tpo / total) * 100) / 100,
  };
}

async function getStats(request, env) {
  if (!hasValidKey(request, env)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const rows = await fetchAllRows(env);
  const total = rows.length;

  const daily = await env.DB.prepare(
    "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c FROM responses GROUP BY day ORDER BY day DESC LIMIT 30"
  ).all();

  const recent = rows
    .slice(-50)
    .reverse()
    .map((r) => ({
      created_at: r.created_at,
      result_label: TYPE_LABELS[r.result_type] || r.result_type,
      similar_score: r.similar_score,
      suki_score: r.suki_score,
      tpo_score: r.tpo_score,
    }));

  return new Response(
    JSON.stringify({
      total,
      axisAverages: buildAxisAverages(rows),
      perQuestion: buildPerQuestionBreakdown(rows),
      byType: buildByType(rows),
      daily: daily.results,
      recent,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

function csvField(value) {
  const s = String(value == null ? '' : value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

async function exportCsv(request, env) {
  if (!hasValidKey(request, env)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const rows = await fetchAllRows(env);

  const header = ['日時', '結果タイプ', '似合う', '好き', 'TPO', ...QUESTIONS.map((_, i) => `Q${i + 1}`)];
  const lines = [header.map(csvField).join(',')];

  rows.forEach((r) => {
    const answerLabels = r.answers.map((a) => (a === 1 ? 'はい' : 'いいえ'));
    const line = [
      r.created_at.replace('T', ' ').slice(0, 19),
      TYPE_LABELS[r.result_type] || r.result_type,
      r.similar_score,
      r.suki_score,
      r.tpo_score,
      ...answerLabels,
    ];
    lines.push(line.map(csvField).join(','));
  });

  const csv = '﻿' + lines.join('\r\n') + '\r\n';

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="nobishiro-shindan-results.csv"',
    },
  });
}

async function adminPage(request, env) {
  if (!hasValidKey(request, env)) {
    return new Response('Unauthorized. Add ?key=... to the URL.', { status: 401 });
  }

  const url = new URL(request.url);
  const key = url.searchParams.get('key');

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>伸びしろ診断 - 集計</title>
<style>
  body { font-family: "Hiragino Sans", "Yu Gothic", sans-serif; background: #FDF6F4; color: #4a3b32; padding: 32px 20px; max-width: 880px; margin: 0 auto; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .sub { color: #a98890; font-size: 13px; margin-bottom: 24px; }
  h2 { font-size: 15px; margin: 32px 0 12px; color: #c6577a; }
  h3 { font-size: 13.5px; margin: 20px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; background: #fff; border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid rgba(74,59,50,0.1); }
  th { color: #a98890; font-weight: 500; font-size: 12px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
  .card { background: #fff; border-radius: 10px; padding: 14px; }
  .card .num { font-size: 24px; font-weight: 600; }
  .card .label { font-size: 12px; color: #a98890; }
  .loading { color: #a98890; }
  .question-block { margin-bottom: 20px; background: #fff; border-radius: 10px; padding: 14px 16px; }
  .export-btn { display: inline-block; margin-bottom: 8px; background: #c6577a; color: #fff; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-size: 13.5px; }
</style>
</head>
<body>
  <h1>伸びしろ診断 - 集計</h1>
  <div class="sub">回答結果の集計データです</div>
  <a class="export-btn" href="/api/export?key=${encodeURIComponent(key)}">CSVダウンロード</a>
  <div id="app" class="loading">読み込み中...</div>

<script>
  fetch('/api/stats?key=${encodeURIComponent(key)}')
    .then((r) => r.json())
    .then(render)
    .catch(() => { document.getElementById('app').textContent = '読み込みに失敗しました'; });

  function render(data) {
    const app = document.getElementById('app');
    const avg = data.axisAverages || { similar: 0, suki: 0, tpo: 0 };
    const total = data.total || 0;

    const cards =
      '<div class="card"><div class="num">' + avg.similar + '</div><div class="label">似合う 平均 (/3)</div></div>' +
      '<div class="card"><div class="num">' + avg.suki + '</div><div class="label">好き 平均 (/3)</div></div>' +
      '<div class="card"><div class="num">' + avg.tpo + '</div><div class="label">TPO 平均 (/3)</div></div>';

    const byTypeRows = (data.byType || []).map((row) =>
      '<tr><td>' + row.label + '</td><td>' + row.count + '</td></tr>'
    ).join('');

    const dailyRows = (data.daily || []).map((row) =>
      '<tr><td>' + row.day + '</td><td>' + row.c + '</td></tr>'
    ).join('');

    const recentRows = (data.recent || []).map((row) =>
      '<tr><td>' + row.created_at.replace('T', ' ').slice(0, 16) + '</td><td>' + row.result_label + '</td><td>似合う' + row.similar_score + ' / 好き' + row.suki_score + ' / TPO' + row.tpo_score + '</td></tr>'
    ).join('');

    const questionBlocks = (data.perQuestion || []).map((q, i) => {
      return '<div class="question-block"><h3>Q' + (i + 1) + '. ' + q.text + '</h3>' +
        '<table><tr><th>回答</th><th>件数</th><th>割合</th></tr>' +
        '<tr><td>はい</td><td>' + q.yes + '件</td><td>' + q.yesPct + '%</td></tr>' +
        '<tr><td>いいえ</td><td>' + q.no + '件</td><td>' + q.noPct + '%</td></tr>' +
        '</table></div>';
    }).join('');

    app.className = '';
    app.innerHTML =
      '<h2>総回答数: ' + total + '件</h2>' +
      '<h2>軸別の平均スコア</h2>' +
      '<div class="cards">' + cards + '</div>' +
      '<h2>設問ごとの回答内訳</h2>' +
      questionBlocks +
      '<h2>タイプ別の件数</h2>' +
      '<table><tr><th>タイプ</th><th>件数</th></tr>' + byTypeRows + '</table>' +
      '<h2>日別の回答数（直近30日）</h2>' +
      '<table><tr><th>日付</th><th>件数</th></tr>' + dailyRows + '</table>' +
      '<h2>直近の回答（最大50件）</h2>' +
      '<table><tr><th>日時</th><th>タイプ</th><th>軸スコア</th></tr>' + recentRows + '</table>';
  }
</script>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
}
