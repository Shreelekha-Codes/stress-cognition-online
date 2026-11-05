/*
 * Parity / Magnitude task switching — port of task_switch.py.
 *
 * First run:  [Practice pure parity] → [Practice pure magnitude] →
 *             [Practice mixed] → Mixed block (50 measured trials)
 * Second run: Mixed block only (50 measured trials)
 *
 * The lab version gives the pure-block practice in a separate baseline
 * session; online there is no such session, so it is folded into the first
 * run (8 + 8 + 8 practice trials, with feedback). Practice rows ARE saved
 * here (block_num = 0, is_practice = 1) — filter them out for analysis.
 *
 * Trial: blank ITI → fixation → cue alone (200 ms CTI) → cue + digit
 *        (until response / 2 s) → feedback (practice) / fixation (test)
 * Keys:  ← = Odd / Lower than 5     → = Even / Bigger than 5
 */
(function () {
  "use strict";
  const C = () => CONFIG.TASKSWITCH;
  const { el, stage, present, sleep, sec } = Core;

  const RESP_ODD_LOWER = "left";
  const RESP_EVEN_BIGGER = "right";
  const DIGITS = [1, 2, 3, 4, 6, 7, 8, 9];
  const DIGIT_CELLS = [[1, 3], [2, 4], [6, 8], [7, 9]];

  const TRIGGERS = {
    block_start_pure_parity: 10, block_start_pure_magnitude: 11, block_start_mixed: 12,
    practice_block_start_pure_parity: 15, practice_block_start_pure_magnitude: 16,
    fixation: 1, cue_parity: 21, cue_magnitude: 22,
    target_first: 30, target_switch: 31, target_repeat: 32,
    response_correct: 41, response_incorrect: 42, response_timeout: 43, block_end: 9,
  };

  const REMINDER = "←  Odd / Lower than 5                  Even / Bigger than 5  →";

  const INSTRUCT_GENERAL = `PARITY AND MAGNITUDE TEST

On each trial a digit (1, 2, 3, 4, 6, 7, 8, or 9) appears on screen.
A cue word above the digit tells you which judgment to make:

  PARITY ?     Is the digit  Odd  or  Even?
  MAGNITUDE ?  Is the digit  Lower than 5  or  Bigger than 5?

The same two keys are used for both tasks:

  ←  Left  arrow  =  Odd  /  Lower than 5
  →  Right arrow  =  Even /  Bigger than 5

Keep one finger on each arrow key.
Respond as quickly and accurately as possible.

Press SPACE to continue.`;

  const INSTRUCT_PURE_PARITY_PRACTICE = `PRACTICE  —  PARITY TASK

For this block, only the PARITY task will appear.

Is the digit  Odd  or  Even?

  ←  Odd          Even  →

Press SPACE to begin practice.`;

  const INSTRUCT_PURE_MAGNITUDE_PRACTICE = `PRACTICE  —  MAGNITUDE TASK

For this block, only the MAGNITUDE task will appear.

Is the digit  Lower than 5  or  Bigger than 5?

  ←  Lower than 5          Bigger than 5  →

Press SPACE to begin practice.`;

  const INSTRUCT_MIXED_PRACTICE = `PRACTICE  —  MIXED TASK

Both PARITY and MAGNITUDE trials will now appear randomly.
Watch the cue on every trial!

  ←  Odd / Lower than 5          Even / Bigger than 5  →

Press SPACE to begin practice.`;

  const INSTRUCT_MIXED = `MIXED TASK

Both PARITY and MAGNITUDE trials appear randomly.
Watch the cue on every trial!

  ←  Odd / Lower than 5          Even / Bigger than 5  →

There is no feedback from now on.

Press SPACE to begin.`;

  const INSTRUCT_RETURN = `PARITY AND MAGNITUDE TEST — again

The same task as before. Watch the cue on every trial!

  PARITY ?     Is the digit  Odd  or  Even?
  MAGNITUDE ?  Is the digit  Lower than 5  or  Bigger than 5?

  ←  Left  arrow  =  Odd  /  Lower than 5
  →  Right arrow  =  Even /  Bigger than 5

Respond as quickly and accurately as possible.

Press SPACE to begin.`;

  const INSTRUCT_END = `Task complete.  Thank you!

Press SPACE to continue.`;

  // ── Sequences (same algorithms as task_switch.py) ──────────────────────
  const correctResp = (task, d) =>
    task === "parity" ? (d % 2 === 1 ? RESP_ODD_LOWER : RESP_EVEN_BIGGER)
                      : (d <= 4 ? RESP_ODD_LOWER : RESP_EVEN_BIGGER);
  const isCongruent = (d) => Number(correctResp("parity", d) === correctResp("magnitude", d));

  function balancedDigits(n) {
    const digits = [];
    for (let i = 0; i < Math.floor(n / DIGITS.length); i++) digits.push(...DIGITS);
    const rem = n % DIGITS.length;
    if (rem) {
      const cells = Core.shuffle(DIGIT_CELLS.map((c) => Core.shuffle(c.slice())));
      for (let i = 0; i < rem; i++) digits.push(cells[i % cells.length][Math.floor(i / cells.length)]);
    }
    return digits;
  }

  function noRepeatOrder(digits, maxAttempts = 1000) {
    for (let a = 0; a < maxAttempts; a++) {
      const pool = Core.shuffle(digits.slice());
      const seq = [];
      while (pool.length) {
        const cands = pool.filter((d) => !seq.length || d !== seq[seq.length - 1]);
        if (!cands.length) break;
        const pick = Core.choice(cands);
        pool.splice(pool.indexOf(pick), 1);
        seq.push(pick);
      }
      if (!pool.length) return seq;
    }
    throw new Error("Could not build a digit sequence without immediate repeats");
  }

  function makePureSequence(task, n) {
    return noRepeatOrder(balancedDigits(n)).map((d) => ({
      task, digit: d, correct_resp: correctResp(task, d), is_switch: null, congruent: isCongruent(d),
    }));
  }

  // 50 % switch probability per trial, digits drawn at random (as in the lab).
  function makeMixedSequence(n, prevTask = null) {
    const trials = [];
    let cur = prevTask;
    for (let i = 0; i < n; i++) {
      let isSwitch;
      if (cur == null) { cur = Core.choice(["parity", "magnitude"]); isSwitch = null; }
      else if (Math.random() < 0.5) { cur = cur === "parity" ? "magnitude" : "parity"; isSwitch = true; }
      else isSwitch = false;
      const d = Core.choice(DIGITS);
      trials.push({ task: cur, digit: d, correct_resp: correctResp(cur, d), is_switch: isSwitch, congruent: isCongruent(d) });
    }
    return trials;
  }

  // ── Display ────────────────────────────────────────────────────────────
  function buildStims() {
    const s = stage();
    s.innerHTML = "";
    return {
      fixation: el("div", "stim fixation", "+", s),
      cue: el("div", "stim ts-cue", "", s),
      digit: el("div", "stim ts-digit", "", s),
      feedback: el("div", "stim feedback-text", "", s),
      reminder: el("div", "stim reminder", REMINDER, s),
    };
  }
  function show(st, which) {
    for (const [k, node] of Object.entries(st)) node.style.visibility = which.includes(k) ? "visible" : "hidden";
  }

  // ── Trial / block ──────────────────────────────────────────────────────
  async function runTrial(st, t) {
    const ev = (code, label) => Core.Events.log("TaskSwitch_Markers", code, label);

    await present(() => show(st, []));
    await sleep(C().ITI_DUR);
    Core.Quality.resetTrial();

    await present(() => show(st, ["fixation", "reminder"]));
    ev(TRIGGERS.fixation, "fixation");
    await sleep(C().FIXATION_DUR);

    await present(() => {
      st.cue.textContent = t.task === "parity" ? "PARITY ?" : "MAGNITUDE ?";
      show(st, ["cue", "reminder"]);
    });
    ev(t.task === "parity" ? TRIGGERS.cue_parity : TRIGGERS.cue_magnitude, "cue_" + t.task);
    await sleep(C().CTI_DUR);

    const onset = await present(() => {
      st.digit.textContent = String(t.digit);
      show(st, ["cue", "digit", "reminder"]);
    });
    const tgt = t.is_switch == null ? "target_first" : t.is_switch ? "target_switch" : "target_repeat";
    ev(TRIGGERS[tgt], tgt);
    const frameMs = Core.lastFrameMs;

    const r = await Core.waitForKey(["left", "right"], { timeout: C().TARGET_TIMEOUT, onset });
    if (r.timedOut) ev(TRIGGERS.response_timeout, "response_timeout");
    else if (r.key === t.correct_resp) ev(TRIGGERS.response_correct, "response_correct");
    else ev(TRIGGERS.response_incorrect, "response_incorrect");
    return { ...r, onset, frameMs };
  }

  async function runBlock(st, trials, blockType, blockNum, trigger, triggerLabel, isPractice, phase) {
    Core.Events.log("TaskSwitch_Markers", trigger, triggerLabel);
    const rows = [];
    for (let i = 0; i < trials.length; i++) {
      const t = trials[i];
      const r = await runTrial(st, t);
      const outcome = r.timedOut ? "missed" : r.key === t.correct_resp ? "correct" : "incorrect";

      if (isPractice) {
        await present(() => {
          st.feedback.textContent = r.timedOut ? "Too Slow" : outcome === "correct" ? "Correct" : "Incorrect";
          st.feedback.style.color = r.timedOut ? "orange" : outcome === "correct" ? "rgb(0,128,0)" : "red";
          show(st, ["feedback"]);
        });
      } else {
        await present(() => show(st, ["fixation"]));
      }
      await sleep(C().FEEDBACK_DUR);

      rows.push({
        participant_id: Core.Data.pid,
        session: Core.Data.session,
        phase,
        block_type: blockType,
        block_num: blockNum,
        trial: i + 1,
        task: t.task,
        digit: t.digit,
        correct_response: t.correct_resp,
        participant_response: r.key || "",
        outcome,
        accuracy: r.timedOut ? "" : Number(outcome === "correct"),
        rt: r.timedOut ? "" : Math.round(r.rt * 10000) / 10000,
        timed_out: Number(r.timedOut),
        is_switch: t.is_switch == null ? "" : Number(t.is_switch),
        congruent: t.congruent,
        trial_onset_time: sec(r.onset),
        // online-only columns
        is_practice: Number(isPractice),
        onset_frame_ms: r.frameMs,
        focus_lost: Number(Core.Quality.trialFlags.focusLost),
        fullscreen: Number(Core.isFullscreen()),
      });
    }
    Core.Events.log("TaskSwitch_Markers", TRIGGERS.block_end, "block_end");
    return rows;
  }

  async function run({ phase, firstRun }) {
    Core.phase = phase;
    let rows = [];
    const P = C();
    if (firstRun) {
      await Core.instructions(INSTRUCT_GENERAL);
      if (P.N_PRACTICE_PURE > 0) {
        await Core.instructions(INSTRUCT_PURE_PARITY_PRACTICE);
        Core.showStage();
        rows = rows.concat(await runBlock(buildStims(), makePureSequence("parity", P.N_PRACTICE_PURE),
          "pure_parity", 0, TRIGGERS.practice_block_start_pure_parity, "practice_block_start_pure_parity", true, phase));
        await Core.instructions(INSTRUCT_PURE_MAGNITUDE_PRACTICE);
        Core.showStage();
        rows = rows.concat(await runBlock(buildStims(), makePureSequence("magnitude", P.N_PRACTICE_PURE),
          "pure_magnitude", 0, TRIGGERS.practice_block_start_pure_magnitude, "practice_block_start_pure_magnitude", true, phase));
      }
      if (P.N_PRACTICE_MIXED > 0) {
        await Core.instructions(INSTRUCT_MIXED_PRACTICE);
        Core.showStage();
        rows = rows.concat(await runBlock(buildStims(), makeMixedSequence(P.N_PRACTICE_MIXED),
          "mixed", 0, TRIGGERS.block_start_mixed, "block_start_mixed", true, phase));
      }
      await Core.instructions(INSTRUCT_MIXED);
    } else {
      await Core.instructions(INSTRUCT_RETURN);
    }
    Core.showStage();
    rows = rows.concat(await runBlock(buildStims(), makeMixedSequence(P.N_MIXED_TRIALS),
      "mixed", 1, TRIGGERS.block_start_mixed, "block_start_mixed", false, phase));
    await Core.instructions(INSTRUCT_END);
    return rows;
  }

  window.TaskSwitch = { run, makePureSequence, makeMixedSequence, balancedDigits, noRepeatOrder, correctResp, isCongruent, TRIGGERS };
})();
