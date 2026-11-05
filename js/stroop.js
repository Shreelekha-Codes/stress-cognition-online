/*
 * Emotional Stroop — port of stroop.py.
 *
 *   [Practice: "XXXXX" strings, first run only]  →  Test block (60 words)
 *   Trial: blank ITI → fixation → word (until response / 2 s) →
 *          fixation (test) / white feedback (practice)
 *   Keys:  D = RED   F = GREEN   J = BLUE   K = YELLOW
 *
 * Word list, ink colours, ordering constraints, trigger codes and CSV
 * columns are identical to the lab version (see doc/stroop.md there).
 */
(function () {
  "use strict";
  const C = () => CONFIG.STROOP;
  const { el, stage, present, sleep, sec, now } = Core;

  const INK_RGB = {
    red: "rgb(165,0,0)",
    green: "rgb(0,230,0)",
    blue: "rgb(0,0,200)",
    yellow: "rgb(255,255,0)",
  };
  const INKS = Object.keys(INK_RGB);
  const KEY_FOR_INK = { red: "d", green: "f", blue: "j", yellow: "k" };
  const RESP_KEYS = Object.values(KEY_FOR_INK);
  const PRACTICE_STRING = "XXXXX";

  const TRIGGERS = {
    block_start: 13, practice_block_start: 14, fixation: 1,
    word_practice: 70, word_neutral: 71, word_negative: 72, word_positive: 73,
    response_correct: 41, response_incorrect: 42, response_timeout: 43, block_end: 9,
  };

  const WORDS = {
    negative: [
      "panic", "failure", "worry", "afraid", "fear",
      "scared", "threat", "crisis", "shame", "stress",
      "trouble", "mistake", "tense", "chaos", "disaster",
      "anxiety", "struggle", "terror", "ruin", "dumb",
    ],
    positive: [
      "happy", "party", "cheer", "lucky", "surprise",
      "proud", "amazing", "music", "joke", "weekend",
      "genius", "freedom", "reward", "success", "victory",
      "prize", "award", "awesome", "magic", "travel",
    ],
    neutral: [
      "door", "table", "floor", "building", "glass",
      "bottle", "shirt", "coat", "wall", "street",
      "station", "bathroom", "corner", "bridge", "stairs",
      "closet", "shoulder", "basket", "drawer", "ceiling",
    ],
  };

  const REMINDER = "D = RED        F = GREEN        J = BLUE        K = YELLOW";

  const INSTRUCT_GENERAL = `COLOUR NAMING TEST

On each trial a word appears on screen, printed in one of four colours.

Press the key for the COLOUR OF THE LETTERS.
Ignore what the word says.

  D  =  RED
  F  =  GREEN
  J  =  BLUE
  K  =  YELLOW

Keep two fingers of each hand on D F and J K.
Respond as quickly and accurately as possible.

Press SPACE to continue.`;

  const INSTRUCT_PRACTICE = `PRACTICE

First, a short practice with rows of X's.

Press the key for the colour of the letters.

  D = RED     F = GREEN     J = BLUE     K = YELLOW

Press SPACE to begin practice.`;

  const INSTRUCT_TEST = `COLOUR NAMING TEST

Now real words will appear.
Ignore the word — respond only to its COLOUR.

  D = RED     F = GREEN     J = BLUE     K = YELLOW

Press SPACE to begin.`;

  const INSTRUCT_RETURN = `COLOUR NAMING TEST — again

The same task as before.
Press the key for the COLOUR OF THE LETTERS and ignore the word.

  D  =  RED
  F  =  GREEN
  J  =  BLUE
  K  =  YELLOW

Keep two fingers of each hand on D F and J K.
Respond as quickly and accurately as possible.

Press SPACE to begin.`;

  const INSTRUCT_END = `Task complete.  Thank you!

Press SPACE to continue.`;

  // ── Sequences (same algorithm as stroop._constrained_order) ────────────
  function runOk(seq, item, attr, maxRun) {
    if (maxRun == null || seq.length < maxRun) return true;
    return seq.slice(-maxRun).some((t) => t[attr] !== item[attr]);
  }

  function constrainedOrder(trials, maxInkRun, maxCatRun, maxAttempts = 1000) {
    for (let a = 0; a < maxAttempts; a++) {
      const pool = Core.shuffle(trials.slice());
      const seq = [];
      while (pool.length) {
        const cands = pool.filter((t) => runOk(seq, t, "ink", maxInkRun) && runOk(seq, t, "category", maxCatRun));
        if (!cands.length) break;
        const pick = Core.choice(cands);
        pool.splice(pool.indexOf(pick), 1);
        seq.push(pick);
      }
      if (!pool.length) return seq;
    }
    throw new Error("Could not build a Stroop sequence satisfying the ordering constraints");
  }

  const makeTrial = (word, category, ink) => ({ word: word.toUpperCase(), category, ink, correct_resp: KEY_FOR_INK[ink] });

  // Each word once; word→ink re-randomised every run, equal inks per category.
  function makeTestSequence() {
    const n = C().WORDS_PER_CATEGORY;
    let trials = [];
    for (const [cat, words] of Object.entries(WORDS)) {
      const shuffled = Core.shuffle(words.slice()).slice(0, n);
      const inks = [];
      for (let i = 0; i < Math.floor(shuffled.length / INKS.length); i++) inks.push(...INKS);
      trials = trials.concat(shuffled.map((w, i) => makeTrial(w, cat, inks[i])));
    }
    return constrainedOrder(trials, C().MAX_INK_RUN, C().MAX_CATEGORY_RUN);
  }

  function makePracticeSequence(n) {
    const inks = [];
    for (let i = 0; i < Math.floor(n / INKS.length); i++) inks.push(...INKS);
    return constrainedOrder(inks.map((ink) => makeTrial(PRACTICE_STRING, "practice", ink)), C().MAX_INK_RUN, null);
  }

  // ── Display ────────────────────────────────────────────────────────────
  function buildStims() {
    const s = stage();
    s.innerHTML = "";
    return {
      fixation: el("div", "stim fixation", "+", s),
      word: el("div", "stim stroop-word", "", s),
      feedback: el("div", "stim feedback-text", "", s),
      reminder: el("div", "stim reminder", REMINDER, s),
    };
  }
  function show(st, which) {
    for (const [k, node] of Object.entries(st)) node.style.visibility = which.includes(k) ? "visible" : "hidden";
  }

  // ── Trial / block ──────────────────────────────────────────────────────
  async function runTrial(st, trial) {
    const ev = (code, label) => Core.Events.log("Stroop_Markers", code, label);

    await present(() => show(st, []));                       // blank ITI
    await sleep(C().ITI_DUR);
    Core.Quality.resetTrial();

    await present(() => show(st, ["fixation", "reminder"])); // fixation
    ev(TRIGGERS.fixation, "fixation");
    await sleep(C().FIXATION_DUR);

    const onset = await present(() => {                      // word
      st.word.textContent = trial.word;
      st.word.style.color = INK_RGB[trial.ink];
      show(st, ["word", "reminder"]);
    });
    ev(TRIGGERS["word_" + trial.category], "word_" + trial.category);
    const frameMs = Core.lastFrameMs;

    const r = await Core.waitForKey(RESP_KEYS, { timeout: C().WORD_TIMEOUT, onset });
    if (r.timedOut) ev(TRIGGERS.response_timeout, "response_timeout");
    else if (r.key === trial.correct_resp) ev(TRIGGERS.response_correct, "response_correct");
    else ev(TRIGGERS.response_incorrect, "response_incorrect");
    return { ...r, onset, frameMs };
  }

  async function runBlock(st, trials, blockType, phase) {
    const isPractice = blockType === "practice";
    Core.Events.log("Stroop_Markers", isPractice ? TRIGGERS.practice_block_start : TRIGGERS.block_start,
      isPractice ? "practice_block_start" : "block_start");
    const rows = [];
    for (let i = 0; i < trials.length; i++) {
      const t = trials[i];
      const r = await runTrial(st, t);
      const outcome = r.timedOut ? "missed" : r.key === t.correct_resp ? "correct" : "incorrect";

      if (isPractice) {
        await present(() => {
          st.feedback.textContent = r.timedOut ? "Too Slow" : outcome === "correct" ? "Correct" : "Incorrect";
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
        trial: i + 1,
        word: t.word,
        word_category: t.category,
        ink_color: t.ink,
        correct_response: t.correct_resp,
        participant_response: r.key || "",
        outcome,
        accuracy: r.timedOut ? "" : Number(outcome === "correct"),
        rt: r.timedOut ? "" : Math.round(r.rt * 10000) / 10000,
        timed_out: Number(r.timedOut),
        trial_onset_time: sec(r.onset),
        // online-only columns
        is_practice: Number(isPractice),
        onset_frame_ms: r.frameMs,
        focus_lost: Number(Core.Quality.trialFlags.focusLost),
        fullscreen: Number(Core.isFullscreen()),
      });
    }
    Core.Events.log("Stroop_Markers", TRIGGERS.block_end, "block_end");
    return rows;
  }

  /*
   * Run one Stroop run. `firstRun` adds the general instructions + practice.
   * Returns all rows (practice + test).
   */
  async function run({ phase, firstRun }) {
    Core.phase = phase;
    let rows = [];
    if (firstRun) {
      await Core.instructions(INSTRUCT_GENERAL);
      if (C().N_PRACTICE_TRIALS > 0) {
        await Core.instructions(INSTRUCT_PRACTICE);
        Core.showStage();
        rows = rows.concat(await runBlock(buildStims(), makePracticeSequence(C().N_PRACTICE_TRIALS), "practice", phase));
      }
      await Core.instructions(INSTRUCT_TEST);
    } else {
      await Core.instructions(INSTRUCT_RETURN);
    }
    Core.showStage();
    rows = rows.concat(await runBlock(buildStims(), makeTestSequence(), "test", phase));
    await Core.instructions(INSTRUCT_END);
    return rows;
  }

  window.Stroop = { run, makeTestSequence, makePracticeSequence, WORDS, INKS, KEY_FOR_INK, TRIGGERS };
})();
