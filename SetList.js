// ========= CONFIG =========
const CONFIG_FILE  = 'idol-setlist.json';
const MAX_LIST_LEN = 40;
// ==========================

// ---------- utilities ----------
async function readConfig() {
  const fm = FileManager.iCloud();
  const p  = fm.joinPath(fm.documentsDirectory(), CONFIG_FILE);
  if (!fm.fileExists(p)) throw new Error(`${CONFIG_FILE} がありません`);
  if (!fm.isFileDownloaded(p)) await fm.downloadFileFromiCloud(p);
  return JSON.parse(fm.readString(p));
}
async function alertPick(title, items, addBack = true) {
  const a = new Alert();
  a.title = title;
  if (addBack) a.addCancelAction('← 戻る');
  items.forEach(i => a.addAction(i));
  const idx = await a.present();
  return idx === -1 ? null : items[idx];
}
async function inputKeyword() {
  const a = new Alert();
  a.title = '会場名を検索（空欄で全件）';
  a.addTextField('', '例: 渋谷');
  a.addAction('検索');
  a.addCancelAction('← 戻る');
  return (await a.present()) === -1 ? null : a.textFieldValue(0);
}
async function info(msg) { const a = new Alert(); a.message = msg; a.addAction('OK'); await a.present(); }
async function confirm(msg) {
  const a = new Alert();
  a.message = msg;
  a.addAction('はい'); a.addCancelAction('いいえ');
  const r = await a.present();
  return r === -1 ? null : r === 0;
}
// --------------------------------

// ---- ステップ 0: 日付 ----
async function stepDate() {
  if (typeof DatePicker !== 'undefined' && DatePicker.prototype.pickDate) {
    const dp = new DatePicker(); dp.initialDate = new Date();
    return await dp.pickDate();
  }
  const today = new Date();
  const def   = `${today.getFullYear()}/${('0'+(today.getMonth()+1)).slice(-2)}/${('0'+today.getDate()).slice(-2)}`;
  const a = new Alert();
  a.title = '日付を入力 (YYYY/MM/DD)';
  a.addTextField('', def); a.addAction('OK'); a.addCancelAction('← 戻る');
  if (await a.present() === -1) return null;
  const d = new Date(a.textFieldValue(0)); if (isNaN(d)) throw '日付形式エラー';
  return d;
}

// ---- ステップ 1: 会場（改良版）----
async function stepVenue(venues) {
  while (true) {
    const kw = await inputKeyword();
    if (kw === null) return null;
    let pool = venues.filter(v => v.toLowerCase().includes(kw.toLowerCase()));

    if (pool.length === 0) {
      const skip = await confirm('該当なし。\n会場を空欄で進みますか？');
      if (skip === null) continue;
      if (skip) return '';
      continue;
    }

    if (pool.length > MAX_LIST_LEN) {
      // ユーザーが「いいえ」を選ぶと先頭 N 件だけ提示
      const refine = await confirm(`${pool.length} 件ヒット。\nもっと絞り込みますか？`);
      if (refine === null) return null;
      if (refine) continue;

      // 先頭 N 件だけに限定し、さらに絞り込むオプション追加
      pool = pool.slice(0, MAX_LIST_LEN);
      pool.push('（さらに絞り込む）');
    }

    const choice = await alertPick('会場を選択', [...pool, '（空欄で進む）']);
    if (choice === null) continue; 
    if (choice === '（空欄で進む）')      return '';
    if (choice === '（さらに絞り込む）') continue;
    return choice; 
  }
}

// ---- ステップ 2: 曲数 ----
async function stepCount(max) {
  const nums = Array.from({length: max}, (_,i)=>(i+1).toString());
  return await alertPick('何曲歌いましたか？', nums);
}
// ---- ステップ 3-n: 曲選択 ----
async function stepSong(idx, pool) {
  return await alertPick(`曲 ${idx+1} を選択`, pool);
}

// ============ MAIN ============
async function main() {
  try {
    const cfg    = await readConfig();
    const venues = cfg.venues ?? [];
    const songs  = cfg.songs  ?? [];
    if (!venues.length || !songs.length) throw 'venues / songs が空です';

    let tags = [];
    if (Array.isArray(cfg.tags)) tags = cfg.tags;
    else if (typeof cfg.tags === 'string') tags = cfg.tags.trim().split(/\s+/);

    const df = new DateFormatter(); df.dateFormat = 'yyyy/MM/dd (EEE)';

    // ------------- ステートマシン -------------
    let step=0, date, venue, count, setlist=[];
    while (true) {
      switch(step){
        case 0: date  = await stepDate();  if(date===null){step--;break;} step++; break;
        case 1: venue = await stepVenue(venues); if(venue===null){step--;break;} step++; break;
        case 2:
          const c = await stepCount(songs.length);
          if(c===null){step--;break;}
          count=parseInt(c); setlist=[]; step++; break;
        default:
          if(step===3+count){step='DONE';break;}
          const pool = songs.filter(s=>!setlist.includes(s));
          const s = await stepSong(step-3,pool);
          if(s===null){step--; if(step>=3) setlist.pop(); break;}
          setlist.push(s); step++; break;
      }
      if(step==='DONE') break;
      if(step<0) throw 'キャンセルされました';
    }
    // -----------------------------------------

    const tagLine   = tags.length ? '\n\n' + tags.join(' ') : '';
    const venueLine = venue ? `📍 ${venue}\n` : '';
    const post =
`🎤 ${df.string(date)}
${venueLine}
セットリスト (${count} 曲)
${setlist.map((s,i)=>`${i+1}. ${s}`).join('\n')}${tagLine}`;

    Pasteboard.copy(post);

    const a = new Alert();
    a.title='下書きをコピーしました'; a.message=post;
    a.addAction('X アプリで開く');
    a.addAction('ブラウザで開く');
    a.addCancelAction('コピーのみ');
    const idx = await a.present();
    if(idx===0||idx===1){
      const enc = encodeURIComponent(post);
      const url = idx===0
        ? `twitter://post?message=${enc}`
        : `https://twitter.com/intent/tweet?text=${enc}`;
      Safari.open(url);
    }

  } catch(e){
    const er=new Alert(); er.title='エラー'; er.message=e.toString();
    er.addAction('OK'); await er.present();
  }
}
await main();
