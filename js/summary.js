/*
 * Per-participant summary row (sheet "summary"): pre / post / delta for each
 * measure, so results can be eyeballed in the Sheet without analysis code.
 * analysis/analyze.py recomputes everything from the trial data with the
 * same rules — treat the trial sheets as the source of truth.
 *
 * Rules: measured (non-practice) trials only. RT measures use correct trials
 * with rt >= 0.2 s (faster = anticipation). accuracy = correct / responded;
 * accuracy_all = correct / all trials (misses count as errors).
 */
(function () {
  "use strict";
  const MIN_RT = 0.2;

  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const median = (a) => {
    if (!a.length) return null;
    const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const sd = (a) => {
    if (a.length < 2) return null;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
  };
  const r4 = (x) => (x == null || Number.isNaN(x) ? "" : Math.round(x * 10000) / 10000);
  const diff = (a, b) => (a === "" || b === "" ? "" : r4(a - b));

  const rtsOf = (rows) => rows.filter((r) => r.outcome === "correct" && r.rt !== "" && r.rt >= MIN_RT).map((r) => r.rt);
  const meanRt = (rows) => r4(mean(rtsOf(rows)));
  const acc = (rows) => {
    const responded = rows.filter((r) => r.outcome !== "missed");
    return responded.length ? r4(responded.filter((r) => r.outcome === "correct").length / responded.length) : "";
  };

  function basic(rows) {
    const rts = rtsOf(rows);
    return {
      n_trials: rows.length,
      n_correct: rows.filter((r) => r.outcome === "correct").length,
      n_incorrect: rows.filter((r) => r.outcome === "incorrect").length,
      n_missed: rows.filter((r) => r.outcome === "missed").length,
      accuracy: acc(rows),
      accuracy_all: rows.length ? r4(rows.filter((r) => r.outcome === "correct").length / rows.length) : "",
      mean_rt: r4(mean(rts)),
      median_rt: r4(median(rts)),
      sd_rt: r4(sd(rts)),
      n_focus_lost: rows.filter((r) => r.focus_lost === 1).length,
      n_late_onset: lateLimit ? rows.filter((r) => r.onset_frame_ms > lateLimit).length : "",
    };
  }
  let lateLimit = null;

  function stroopMeasures(rows) {
    const by = (c) => rows.filter((r) => r.word_category === c);
    const neg = meanRt(by("negative")), pos = meanRt(by("positive")), neu = meanRt(by("neutral"));
    return {
      ...basic(rows),
      rt_negative: neg, rt_positive: pos, rt_neutral: neu,
      acc_negative: acc(by("negative")), acc_positive: acc(by("positive")), acc_neutral: acc(by("neutral")),
      interference_neg_neu: diff(neg, neu),
      interference_neg_pos: diff(neg, pos),
    };
  }

  function switchMeasures(rows) {
    const sw = rows.filter((r) => r.is_switch === 1), rep = rows.filter((r) => r.is_switch === 0);
    const con = rows.filter((r) => r.congruent === 1), inc = rows.filter((r) => r.congruent === 0);
    const rs = meanRt(sw), rr = meanRt(rep), rc = meanRt(con), ri = meanRt(inc);
    const as = acc(sw), ar = acc(rep);
    return {
      ...basic(rows),
      rt_switch: rs, rt_repeat: rr, switch_cost_rt: diff(rs, rr),
      acc_switch: as, acc_repeat: ar, switch_cost_acc: diff(ar, as),
      rt_congruent: rc, rt_incongruent: ri, congruency_cost_rt: diff(ri, rc),
    };
  }

  function vasMeasures(rows, timepoint) {
    const get = (m) => { const r = rows.find((x) => x.timepoint === timepoint && x.measure === m); return r ? r.rating : ""; };
    const s = get("stressed"), t = get("tense"), c = get("calm");
    return { stressed: s, tense: t, calm: c, composite: s === "" || t === "" || c === "" ? "" : r4((s + t + (100 - c)) / 3) };
  }

  function build({ task, cogRows, mistRows, vasRows, frameMs }) {
    const out = { participant_id: Core.Data.pid, task };
    // Trials whose stimulus frame took > 1.5× the normal frame (onset delayed by a dropped frame).
    lateLimit = frameMs ? 1.5 * frameMs : null;
    const measured = cogRows.filter((r) => r.is_practice === 0);
    const f = task === "stroop" ? stroopMeasures : switchMeasures;
    const pre = f(measured.filter((r) => r.phase === "pre_stress"));
    const post = f(measured.filter((r) => r.phase === "post_stress"));
    for (const k of Object.keys(pre)) {
      out["pre_" + k] = pre[k];
      out["post_" + k] = post[k];
      if (typeof pre[k] === "number" && typeof post[k] === "number") out["delta_" + k] = r4(post[k] - pre[k]);
    }
    const exp = mistRows.filter((r) => r.block === "experimental");
    out.mist_n_trials = exp.length;
    out.mist_accuracy = exp.length ? r4(exp.filter((r) => r.accuracy === 1).length / exp.length) : "";
    out.mist_n_timeouts = exp.filter((r) => r.timed_out === 1).length;
    out.mist_mean_rt_correct = r4(mean(exp.filter((r) => r.accuracy === 1).map((r) => r.rt)));
    out.mist_final_time_limit = exp.length ? exp[exp.length - 1].next_time_limit : "";
    for (const tp of ["pre_mist", "post_mist"]) {
      const v = vasMeasures(vasRows, tp);
      for (const k of Object.keys(v)) out[`vas_${tp}_${k}`] = v[k];
    }
    const a = out.vas_pre_mist_composite, b = out.vas_post_mist_composite;
    out.vas_delta_composite = a === "" || b === "" ? "" : r4(b - a);
    return out;
  }

  window.Summary = { build, stroopMeasures, switchMeasures, MIN_RT };
})();
