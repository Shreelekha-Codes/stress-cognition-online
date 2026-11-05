/*
 * MIST stressor — port of mist_l5.py (+ the shared pieces of mist.py).
 *
 *   Intro → Practice (5 timed trials, feedback, no performance bar) →
 *   Experimental (35 trials: countdown, rigged-feeling performance bar,
 *   adaptive time limit ±10 %, adaptive ITI) → End
 *
 * Responding: number keys 0–9 select a digit on the dial (re-pressing
 * replaces it, BACKSPACE clears); ENTER submits. When the countdown reaches
 * zero the trial is a timeout (counted incorrect). Background white noise
 * plays for the whole MIST, as in the lab.
 *
 * Differences from the lab version
 *  - No per-participant staircase: level and starting time limit come from
 *    CONFIG.MIST (mist_l5.py standalone defaults: level 4, 5 s).
 *  - `time_limit` is the limit in force on that trial; the lab CSV wrote the
 *    post-adaptation value there. The post-adaptation value is in
 *    `next_time_limit`. For timeouts `rt` is that trial's limit.
 */
(function () {
  "use strict";
  const C = () => CONFIG.MIST;
  const { el, stage, present, sleep, sec, iso, now } = Core;

  const TRIGGERS = { block_start_exp: 20, trial_onset: 1, response: 2, feedback_onset: 3, block_end: 9 };
  const DIGIT_KEYS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

  const INSTRUCT_INTRO = `MENTAL ARITHMETIC TEST

You will now solve arithmetic problems.
Every answer is a single digit from 0 to 9.

Type the answer with the NUMBER KEYS at the top of your keyboard.
Your choice lights up on the dial on the right.
Press ENTER to submit. BACKSPACE clears your choice.

If the timer runs out, the problem counts as wrong.

This part plays background noise — please keep your sound on.

Press SPACE to continue.`;

  const INSTRUCT_PRACTICE = `PRACTICE

You will now solve a few problems with the countdown timer active.
Select your answer on the dial and press ENTER before time runs out.

Feedback will be shown after each trial.

Press SPACE to begin.`;

  const INSTRUCT_END = `The task is complete. Thank you!

Press SPACE to continue.`;

  // ── Problems ───────────────────────────────────────────────────────────
  let bank = [], bankPos = 0;
  function nextProblem() {
    if (!bank.length || bankPos >= bank.length) {
      bank = Core.shuffle((window.MIST_BANK[String(C().LEVEL)] || window.MIST_BANK["4"]).slice());
      bankPos = 0;
    }
    const [display, answer] = bank[bankPos++];
    return { display, answer };
  }

  const adaptiveITI = (lastRt, timeLimit) =>
    lastRt == null ? C().ITI_BASE : Math.max(C().ITI_MIN, Math.min(C().ITI_MAX, C().ITI_BASE + (timeLimit - lastRt)));

  // ── White noise (Web Audio) ────────────────────────────────────────────
  let noiseNode = null;
  function startNoise() {
    if (!C().WHITE_NOISE || !Core.audio) return;
    try {
      const ctx = Core.audio;
      if (ctx.state === "suspended") ctx.resume();
      const len = ctx.sampleRate * 4;
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = C().WHITE_NOISE_VOLUME;
      src.connect(gain).connect(ctx.destination);
      src.start();
      noiseNode = src;
      Core.Events.log("MIST_Markers", 0, "white_noise_start");
    } catch (e) {
      console.warn("White noise unavailable", e);
    }
  }
  function stopNoise() {
    if (noiseNode) {
      try { noiseNode.stop(); } catch (_) {}
      noiseNode = null;
      Core.Events.log("MIST_Markers", 0, "white_noise_stop");
    }
  }

  // ── Display ────────────────────────────────────────────────────────────
  function buildPerfBar(parent) {
    const bar = el("div", "perf-bar", null, parent);
    el("div", "zone zone-red", null, bar);
    el("div", "zone zone-white", null, bar);
    el("div", "zone zone-green", null, bar);
    const avg = el("div", "tri tri-down", null, bar);
    avg.style.left = C().TARGET_ACCURACY * 100 + "%";
    const me = el("div", "tri tri-up", null, bar);
    me.style.left = "0%";
    return { bar, set: (pct) => (me.style.left = Math.max(0, Math.min(1, pct)) * 100 + "%") };
  }

  function buildDial(parent) {
    const dial = el("div", "dial", null, parent);
    const btns = [];
    for (let d = 0; d < 10; d++) {
      const cw = (d * 36 - 36 + 360) % 360;
      const th = ((90 - cw) * Math.PI) / 180;
      const b = el("div", "dial-btn", String(d), dial);
      // Positions in vh relative to the dial centre (see .dial in style.css).
      b.style.left = `calc(${16 * Math.cos(th)}vh - 4vh)`;
      b.style.top = `calc(${-16 * Math.sin(th)}vh - 4vh)`;
      btns.push(b);
    }
    let flashTimer = null;
    return {
      dial,
      select(d) {
        btns.forEach((b, i) => { b.classList.toggle("selected", i === d); b.classList.remove("flash"); });
        btns[d].classList.add("flash");
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => btns[d].classList.remove("flash"), 120);
      },
      clear() { btns.forEach((b) => b.classList.remove("selected", "flash")); },
    };
  }

  function buildStims(withBar) {
    const s = stage();
    s.innerHTML = "";
    const st = {
      screen: el("div", "mist-screen", null, s),
      feedback: el("div", "mist-feedback", null, s),
    };
    st.perf = withBar ? buildPerfBar(st.screen) : null;
    st.problemBox = el("div", "mist-problem", null, st.screen);
    st.timer = el("div", "mist-timer", "00:00", st.screen);
    st.dial = buildDial(st.screen);
    st.feedbackText = el("span", null, "", st.feedback);
    return st;
  }

  const fmt = (t) => {
    const s = Math.max(0, Math.floor(t));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  // ── Trial ──────────────────────────────────────────────────────────────
  async function runTrial(st, problem, timeLimit) {
    const ev = (code, label) => Core.Events.log("MIST_Markers", code, label);
    let selected = null;
    st.dial.clear();
    st.problemBox.textContent = problem.display + " = ?";
    st.timer.textContent = fmt(timeLimit);

    const trialStart = iso();
    Core.Quality.resetTrial();
    const onset = await present(() => {
      st.feedback.style.visibility = "hidden";
      st.screen.style.visibility = "visible";
    });
    ev(TRIGGERS.trial_onset, "trial_onset");
    const frameMs = Core.lastFrameMs;

    // Countdown display, refreshed every frame.
    let running = true;
    (function tick() {
      if (!running) return;
      st.timer.textContent = fmt(timeLimit - (now() - onset) / 1000);
      requestAnimationFrame(tick);
    })();

    const r = await Core.waitForKey([...DIGIT_KEYS, "backspace", "return"], {
      timeout: timeLimit * 1000,
      onset,
      onKey(k) {
        if (k === "return") return selected != null;    // submit only with a selection
        if (k === "backspace") { selected = null; st.dial.clear(); return false; }
        selected = k; st.dial.select(Number(k)); return false;
      },
    });
    running = false;
    ev(TRIGGERS.response, "response");

    const answer = selected || "";
    const timedOut = r.timedOut;
    const correct = !timedOut && answer !== "" && Number(answer) === problem.answer;
    return { onset, frameMs, trialStart, trialEnd: iso(), answer, timedOut, correct, rt: timedOut ? timeLimit : r.rt };
  }

  async function showFeedback(st, correct, timedOut) {
    await present(() => {
      st.screen.style.visibility = "hidden";
      st.feedbackText.textContent = timedOut ? "Too Slow!" : correct ? "CORRECT" : "INCORRECT";
      st.feedbackText.style.color = timedOut ? "orange" : correct ? "rgb(0,128,0)" : "red";
      st.feedback.style.visibility = "visible";
    });
    Core.Events.log("MIST_Markers", TRIGGERS.feedback_onset, "feedback_onset");
    await sleep(C().FEEDBACK_DUR);
  }

  function row(block, n, problem, res, timeLimit, nextLimit) {
    return {
      participant_id: Core.Data.pid,
      session: Core.Data.session,
      block,
      trial: n,
      level: C().LEVEL,
      problem: problem.display,
      correct_answer: problem.answer,
      participant_answer: res.answer,
      accuracy: Number(res.correct),
      answered: Number(!res.timedOut && res.answer !== ""),
      rt: Math.round(res.rt * 10000) / 10000,
      time_limit: Math.round(timeLimit * 10000) / 10000,
      trial_start_time: res.trialStart,
      trial_end_time: res.trialEnd,
      // online-only columns
      phase: "stressor",
      outcome: res.timedOut ? "missed" : res.correct ? "correct" : "incorrect",
      timed_out: Number(res.timedOut),
      next_time_limit: Math.round(nextLimit * 10000) / 10000,
      trial_onset_time: sec(res.onset),
      onset_frame_ms: res.frameMs,
      focus_lost: Number(Core.Quality.trialFlags.focusLost),
      fullscreen: Number(Core.isFullscreen()),
    };
  }

  async function runPractice() {
    const rows = [];
    const st = buildStims(false);
    const limit = C().TIME_LIMIT;
    for (let i = 0; i < C().N_PRACTICE_TRIALS; i++) {
      const p = nextProblem();
      await present(() => { st.screen.style.visibility = "hidden"; st.feedback.style.visibility = "hidden"; });
      await sleep(C().ITI_BASE * 1000);
      const res = await runTrial(st, p, limit);
      await showFeedback(st, res.correct, res.timedOut);
      rows.push(row("practice", i + 1, p, res, limit, limit));
    }
    return rows;
  }

  async function runExperimental() {
    const rows = [];
    const st = buildStims(true);
    const window10 = [];
    const adaptiveBuf = [];
    let timeLimit = C().TIME_LIMIT;
    let prevRt = null;
    Core.Events.log("MIST_Markers", TRIGGERS.block_start_exp, "block_start_exp");

    for (let i = 0; i < C().N_EXP_TRIALS; i++) {
      const p = nextProblem();
      const iti = adaptiveITI(prevRt, timeLimit);
      await present(() => { st.screen.style.visibility = "hidden"; st.feedback.style.visibility = "hidden"; });
      await sleep(iti * 1000);

      const usedLimit = timeLimit;
      const res = await runTrial(st, p, usedLimit);

      window10.push(Number(res.correct));
      if (window10.length > 10) window10.shift();
      st.perf.set(window10.reduce((a, b) => a + b, 0) / window10.length);

      adaptiveBuf.push(res.correct);
      if (adaptiveBuf.length >= C().ADAPTIVE_WINDOW) {
        const recent = adaptiveBuf.slice(-C().ADAPTIVE_WINDOW);
        if (recent.every(Boolean)) timeLimit *= 1 - C().ADAPTIVE_STEP;
        else if (!recent.some(Boolean)) timeLimit *= 1 + C().ADAPTIVE_STEP;
      }

      await showFeedback(st, res.correct, res.timedOut);
      prevRt = res.timedOut ? usedLimit : res.rt;
      rows.push(row("experimental", i + 1, p, res, usedLimit, timeLimit));
    }
    Core.Events.log("MIST_Markers", TRIGGERS.block_end, "block_end");
    return rows;
  }

  // Annotated performance-bar instructions (mist.show_exp_instructions).
  function expInstructionsExtra() {
    const wrap = el("div", "exp-instruct");
    const p = buildPerfBar(wrap);
    p.bar.classList.add("perf-bar-static");
    p.set(0.4);
    const zones = el("div", "zone-labels", null, wrap);
    el("div", "zl zl-red", "Below average\n(0 – 60 %)", zones);
    el("div", "zl zl-white", "Average\n(60 – 80 %)", zones);
    el("div", "zl zl-green", "Above average\n(80 – 100 %)", zones);
    el("div", "legend", "Upward marker (below the bar)   =  Your score\nDownward marker (above the bar) =  Group average", wrap);
    el("div", "legend-instr",
      "Solve problems as quickly and accurately as possible.\n" +
      "A countdown timer appears on screen. Select your answer on the dial and press ENTER.\n\n" +
      "Press SPACE to begin.", wrap);
    return wrap;
  }

  async function run() {
    Core.phase = "stressor";
    let rows = [];
    try {
      await Core.instructions(INSTRUCT_INTRO);
      startNoise();
      if (C().N_PRACTICE_TRIALS > 0) {
        await Core.instructions(INSTRUCT_PRACTICE);
        Core.showStage();
        rows = rows.concat(await runPractice());
      }
      await Core.instructions("STRESS TEST", { extra: expInstructionsExtra() });
      Core.showStage();
      rows = rows.concat(await runExperimental());
    } finally {
      stopNoise();
    }
    await Core.instructions(INSTRUCT_END);
    return rows;
  }

  window.MIST = { run, nextProblem, adaptiveITI, TRIGGERS };
})();
