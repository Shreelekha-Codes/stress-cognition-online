/**
 * Data receiver for the online stress–cognition study.
 *
 * Setup (details in README.md → "Data collection setup"):
 *   1. Create a Google Sheet → Extensions → Apps Script → paste this file.
 *   2. Deploy → New deployment → Web app; Execute as: Me;
 *      Who has access: Anyone. Copy the /exec URL into js/config.js (DATA_URL).
 *
 * Endpoints
 *   POST {action:"append", sheet, rows:[{...}], batch_id}   → append rows
 *   POST {action:"complete", participant_id, task}          → mark finished
 *   GET  ?action=assign&participant_id=…                    → balanced task
 *   GET  (no params)                                        → health check
 *
 * Each tab gets its header from the row keys; new keys add new columns.
 */

var SHEETS = [
  'sessions', 'demographics', 'feedback', 'summary', 'vas',
  'stroop_trials', 'taskswitch_trials', 'mist_trials', 'events', 'assignments'
];
var TASKS = ['stroop', 'taskswitch'];
var MAX_ROWS_PER_REQUEST = 5000;
// A participant who started but has not finished within this many minutes
// no longer counts toward balancing (they probably dropped out).
var ACTIVE_WINDOW_MIN = 60;

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'assign') return json_(withLock_(function () { return assign_(p.participant_id || ''); }));
  if (p.action === 'export') return json_(export_(p.key, p.events === '1'));
  return json_({ ok: true, status: 'running' });
}

// Adds a "Study" menu to the Sheet.
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Study')
    .addItem('Refresh dashboard', 'refreshDashboard')
    .addItem('Create / show export key', 'createExportKey')
    .addToUi();
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.action === 'complete') {
      return json_(withLock_(function () { return markComplete_(body.participant_id); }));
    }
    if (body.action === 'append') {
      return json_(withLock_(function () { return append_(body); }));
    }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function append_(body) {
  if (SHEETS.indexOf(body.sheet) < 0) return { ok: false, error: 'unknown sheet ' + body.sheet };
  var rows = body.rows || [];
  if (!rows.length) return { ok: true, n: 0 };
  if (rows.length > MAX_ROWS_PER_REQUEST) return { ok: false, error: 'too many rows' };

  // Retries can resend a batch whose first attempt actually succeeded.
  var cache = CacheService.getScriptCache();
  if (body.batch_id && cache.get('b_' + body.batch_id)) return { ok: true, n: 0, duplicate: true };

  var received = new Date().toISOString();
  rows = rows.map(function (r) { r.received_at = received; return r; });
  writeRows_(body.sheet, rows);

  if (body.batch_id) cache.put('b_' + body.batch_id, '1', 21600); // 6 h
  return { ok: true, n: rows.length };
}

function writeRows_(name, rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var header = sh.getLastColumn() > 0
    ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String)
    : [];
  var added = false;
  rows.forEach(function (r) {
    Object.keys(r).forEach(function (k) {
      if (header.indexOf(k) < 0) { header.push(k); added = true; }
    });
  });
  if (added) {
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  var values = rows.map(function (r) {
    return header.map(function (k) { return cell_(r[k]); });
  });
  sh.getRange(sh.getLastRow() + 1, 1, values.length, header.length).setValues(values);
}

// Strings that look like formulas are prefixed with ' so they stay text.
function cell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

// ── Balanced assignment ─────────────────────────────────────────────────
function assign_(pid) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('assignments');
  var rows = [];
  if (sh && sh.getLastRow() > 1) {
    rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues(); // pid, task, assigned_at, completed
  }
  // Same participant reloading the page keeps their task.
  for (var i = 0; i < rows.length; i++) {
    if (pid && String(rows[i][0]) === pid) return { ok: true, task: String(rows[i][1]), existing: true };
  }
  var cutoff = Date.now() - ACTIVE_WINDOW_MIN * 60000;
  var counts = { stroop: 0, taskswitch: 0 };
  rows.forEach(function (r) {
    var task = String(r[1]);
    if (!(task in counts)) return;
    var done = r[3] === true || String(r[3]).toUpperCase() === 'TRUE';
    var t = new Date(r[2]).getTime();
    if (done || t >= cutoff) counts[task]++;
  });
  var task = counts.stroop === counts.taskswitch
    ? TASKS[Math.floor(Math.random() * 2)]
    : (counts.stroop < counts.taskswitch ? 'stroop' : 'taskswitch');
  if (!sh) {
    sh = ss.insertSheet('assignments');
    sh.getRange(1, 1, 1, 4).setValues([['participant_id', 'task', 'assigned_at', 'completed']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  sh.appendRow([cell_(pid), task, new Date().toISOString(), false]);
  return { ok: true, task: task, counts: counts };
}

function markComplete_(pid) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('assignments');
  if (!sh || sh.getLastRow() < 2 || !pid) return { ok: true, updated: 0 };
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  var updated = 0;
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(pid)) {
      sh.getRange(i + 2, 4).setValue(true);
      updated = 1;
      break;
    }
  }
  try { updateDashboard_(); } catch (err) { Logger.log('dashboard: ' + err); }
  return { ok: true, updated: updated };
}

// ── Live dashboard ──────────────────────────────────────────────────────
// Rebuilt from the "summary" tab every time a participant finishes (and via
// the Study menu). Pilot sessions (quick_mode = 1) and test IDs are skipped.

var DASH_METRICS = {
  stroop: ['mean_rt', 'median_rt', 'accuracy_all', 'n_missed', 'interference_neg_neu', 'interference_neg_pos'],
  taskswitch: ['mean_rt', 'median_rt', 'accuracy_all', 'n_missed', 'switch_cost_rt', 'switch_cost_acc', 'congruency_cost_rt']
};
var COMMON_METRICS = ['mean_rt', 'median_rt', 'accuracy_all', 'n_missed'];
var T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145,
  2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];

function refreshDashboard() { withLock_(updateDashboard_); }

function readTab_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), h = v[0].map(String);
  return v.slice(1).map(function (row) {
    var o = {};
    h.forEach(function (k, i) { o[k] = row[i]; });
    return o;
  });
}

function num_(x) { return x === '' || x === null || x === undefined || isNaN(Number(x)) ? null : Number(x); }
function r3_(x) { return x === null || isNaN(x) ? '' : Math.round(x * 1000) / 1000; }

function changeStats_(rows, pre, post) {
  var ch = [];
  rows.forEach(function (r) { var a = num_(r[pre]), b = num_(r[post]); if (a !== null && b !== null) ch.push({ a: a, b: b, d: b - a }); });
  var n = ch.length;
  if (!n) return null;
  var mean = function (k) { return ch.reduce(function (s, x) { return s + x[k]; }, 0) / n; };
  var md = mean('d');
  var sd = n > 1 ? Math.sqrt(ch.reduce(function (s, x) { return s + Math.pow(x.d - md, 2); }, 0) / (n - 1)) : null;
  var t = n > 1 ? (n - 1 <= 30 ? T975[n - 2] : 2.0) : null;
  var se = sd !== null ? sd / Math.sqrt(n) : null;
  return {
    n: n, pre: mean('a'), post: mean('b'), change: md, sd: sd,
    dz: sd ? md / sd : null,
    lo: se !== null ? md - t * se : null, hi: se !== null ? md + t * se : null,
    up: ch.filter(function (x) { return x.d > 0; }).length,
    down: ch.filter(function (x) { return x.d < 0; }).length
  };
}

function updateDashboard_() {
  var all = readTab_('summary').filter(function (r) {
    return Number(r.quick_mode) !== 1 && !/^test/i.test(String(r.participant_id));
  });
  var byPid = {};
  all.forEach(function (r) { byPid[String(r.participant_id)] = r; }); // last row per person wins
  var rows = Object.keys(byPid).map(function (k) { return byPid[k]; });
  var started = readTab_('assignments').length;

  var out = [], bold = [];
  var add = function (r, isTitle) { if (isTitle) bold.push(out.length + 1); out.push(r); };
  var tasks = ['stroop', 'taskswitch'];
  var group = function (t) { return rows.filter(function (r) { return r.task === t; }); };

  add(['LIVE RESULTS — updated ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'], true);
  add(['Completed: ' + rows.length + '  (stroop ' + group('stroop').length + ', taskswitch ' + group('taskswitch').length +
       ')   ·   assigned so far: ' + started + '   ·   n < 5 per task: read the "up/down" counts and individual rows, not p-values or CIs.']);
  add(['']);

  add(['1. Did the stressor raise stress?  VAS composite = mean(stressed, tense, 100 − calm), 0–100'], true);
  add(['group', 'n', 'pre_mist', 'post_mist', 'mean change', 'SD change', 'dz', '95% CI low', '95% CI high', 'n up', 'n down'], true);
  [['all', rows]].concat(tasks.map(function (t) { return [t, group(t)]; })).forEach(function (g) {
    var s = changeStats_(g[1], 'vas_pre_mist_composite', 'vas_post_mist_composite');
    if (s) add([g[0], s.n, r3_(s.pre), r3_(s.post), r3_(s.change), r3_(s.sd), r3_(s.dz), r3_(s.lo), r3_(s.hi), s.up, s.down]);
    else add([g[0], 0]);
  });
  add(['']);

  add(['2. Pre → post change per task  (RT in s, correct trials ≥ 0.2 s; accuracy_all = correct ÷ all trials)'], true);
  add(['task', 'metric', 'n', 'pre', 'post', 'mean change', 'SD change', 'dz', '95% CI low', '95% CI high', 'n up', 'n down'], true);
  var dzs = { stroop: {}, taskswitch: {} };
  tasks.forEach(function (t) {
    DASH_METRICS[t].forEach(function (m) {
      var s = changeStats_(group(t), 'pre_' + m, 'post_' + m);
      if (!s) { add([t, m, 0]); return; }
      dzs[t][m] = s.dz;
      add([t, m, s.n, r3_(s.pre), r3_(s.post), r3_(s.change), r3_(s.sd), r3_(s.dz), r3_(s.lo), r3_(s.hi), s.up, s.down]);
    });
  });
  add(['']);

  add(['3. Which task moved more?  |dz| = size of the pre→post change in SD units (0.2 small, 0.5 medium, 0.8 large)'], true);
  add(['metric', 'dz stroop', 'dz taskswitch', 'larger |dz|'], true);
  COMMON_METRICS.forEach(function (m) {
    var a = dzs.stroop[m], b = dzs.taskswitch[m];
    var win = (a == null || b == null) ? 'need ≥ 2 per task' : (Math.abs(a) > Math.abs(b) ? 'stroop' : 'taskswitch');
    add([m, r3_(a), r3_(b), win]);
  });
  add(['Task-specific effects (switch cost, emotional interference) are in table 2; analysis/analyze.py adds bootstrap CIs and plots.']);
  add(['']);

  add(['4. Participants'], true);
  add(['participant_id', 'task', 'Δ mean_rt', 'Δ accuracy_all', 'Δ n_missed', 'Δ main effect', 'Δ VAS', 'MIST accuracy', 'focus lost (pre/post)', 'late onsets (pre/post)'], true);
  rows.forEach(function (r) {
    var eff = r.task === 'stroop' ? 'delta_interference_neg_neu' : 'delta_switch_cost_rt';
    add([r.participant_id, r.task, r3_(num_(r.delta_mean_rt)), r3_(num_(r.delta_accuracy_all)), r3_(num_(r.delta_n_missed)),
         r3_(num_(r[eff])), r3_(num_(r.vas_delta_composite)), r3_(num_(r.mist_accuracy)),
         (r.pre_n_focus_lost || 0) + ' / ' + (r.post_n_focus_lost || 0), (r.pre_n_late_onset || 0) + ' / ' + (r.post_n_late_onset || 0)]);
  });
  add(['Δ main effect = change in interference (negative − neutral RT) for Stroop, in switch cost RT for task switching.']);

  var width = out.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
  out = out.map(function (r) { while (r.length < width) r.push(''); return r; });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('dashboard') || ss.insertSheet('dashboard', 0);
  sh.clear();
  sh.getRange(1, 1, out.length, width).setValues(out);
  bold.forEach(function (i) { sh.getRange(i, 1, 1, width).setFontWeight('bold'); });
  return { ok: true, participants: rows.length };
}

// ── Export for analysis/analyze.py (key-protected) ─────────────────────
function export_(key, withEvents) {
  var stored = PropertiesService.getScriptProperties().getProperty('EXPORT_KEY');
  if (!stored || key !== stored) return { ok: false, error: 'bad key' };
  var data = {};
  SHEETS.forEach(function (name) {
    if (name === 'events' && !withEvents) return;
    data[name] = readTab_(name);
  });
  return { ok: true, exported_at: new Date().toISOString(), sheets: data };
}

/** Run once (or Study → Create / show export key). Keep the key private. */
function createExportKey() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('EXPORT_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('EXPORT_KEY', key);
  }
  var msg = 'Export key: ' + key + '\n\nUse with analysis/analyze.py:\n  python analyze.py --url <web app URL> --key ' + key;
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
  return key;
}

// ── Helpers ─────────────────────────────────────────────────────────────
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to check the sheet is writable. */
function testSetup() {
  writeRows_('sessions', [{ participant_id: 'TEST', status: 'setup_test', start_time: new Date().toISOString() }]);
  Logger.log('OK — a TEST row was written to the "sessions" tab. Delete it before collecting data.');
}
