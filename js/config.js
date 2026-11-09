/*
 * Study configuration — edit this file, nothing else, for normal use.
 *
 * Timings are in milliseconds. Values mirror the PsychoPy originals in
 * stress-recovery-exp-with-stroop (stroop.py, task_switch.py, mist_l5.py,
 * mist.py, vas.py) unless a comment says otherwise.
 */
window.CONFIG = {
  STUDY_TITLE: "Stress and Attention Study",

  // Google Apps Script web-app URL (ends in /exec). See README → "Data
  // collection setup". Leave "" to run without uploading (data can still be
  // downloaded as JSON on the last screen — useful for piloting).
  DATA_URL: "https://script.google.com/macros/s/AKfycbwwxBb0CKQxFpHnAyZeRXrcLJFRl73Rme-cQO6dAvlqTWHxZXwVZgKKwPMPEcfYSik-Ig/exec",

  // Shown to participants if their upload fails, so they can send the file.
  RESEARCHER_CONTACT: "Shreelekha B S, shreelekha.basavaraja@student.uts.edu.au",

  // Which cognitive task a participant gets (between-subjects, as in the lab
  // study). "balanced" asks the Apps Script for the task with fewer
  // participants so far (falls back to random if it can't be reached);
  // "random" flips a coin. A ?task=stroop or ?task=taskswitch URL parameter
  // always wins (useful for piloting each task).
  TASK_ASSIGNMENT: "balanced",

  // Pre-stressor VAS. The requested protocol is Task → Stressor → VAS → Task;
  // without a VAS before the stressor there is nothing to compare the
  // post-stressor rating with, so a pre-stress VAS is on by default.
  VAS_PRE_STRESS: true,

  // Minimum screen size; smaller screens (phones, tablets) are turned away.
  MIN_SCREEN_WIDTH: 900,
  MIN_SCREEN_HEIGHT: 500,

  STROOP: {
    N_PRACTICE_TRIALS: 12,   // "XXXXX" strings before the first test run only
    WORDS_PER_CATEGORY: 20,  // all 20 → 60-trial test run (multiple of 4)
    FIXATION_DUR: 500,
    WORD_TIMEOUT: 2000,
    FEEDBACK_DUR: 500,       // practice feedback / test post-response fixation
    ITI_DUR: 500,
    MAX_INK_RUN: 2,
    MAX_CATEGORY_RUN: 3,
  },

  TASKSWITCH: {
    // The lab protocol gives practice in a separate baseline session. Online
    // there is none, so the first run starts with short practice blocks
    // (with feedback): pure parity → pure magnitude → mixed. The second run
    // has no practice.
    N_PRACTICE_PURE: 8,
    N_PRACTICE_MIXED: 8,
    N_MIXED_TRIALS: 50,      // measured trials per run (task_switch.N_MIXED_TRIALS)
    FIXATION_DUR: 500,
    CTI_DUR: 200,
    TARGET_TIMEOUT: 2000,
    FEEDBACK_DUR: 500,
    ITI_DUR: 500,
  },

  MIST: {
    // Online there is no session-1 staircase, so every participant gets the
    // same starting level and time limit (mist_l5.py standalone defaults).
    // The time limit still adapts ±10 % trial by trial, as in the lab.
    LEVEL: 4,                // 3, 4 or 5 (5 adds integer division)
    N_PRACTICE_TRIALS: 5,
    N_EXP_TRIALS: 35,
    TIME_LIMIT: 5.0,         // starting limit, seconds
    ADAPTIVE_WINDOW: 3,
    ADAPTIVE_STEP: 0.10,
    TARGET_ACCURACY: 0.85,   // "group average" marker on the performance bar
    FEEDBACK_DUR: 500,
    ITI_BASE: 1.0,           // seconds (adaptive ITI, mist.compute_adaptive_iti)
    ITI_MIN: 0.5,
    ITI_MAX: 3.0,
    WHITE_NOISE: true,
    WHITE_NOISE_VOLUME: 0.1, // 0–1, same as the lab
  },
};

// ?quick=1 shortens every block for a fast run-through while piloting. The
// session is flagged quick_mode=1 in the data so it is easy to exclude.
(function applyQuickMode() {
  const p = new URLSearchParams(location.search);
  if (p.get("quick") !== "1") return;
  const c = window.CONFIG;
  c.QUICK_MODE = true;
  c.STROOP.N_PRACTICE_TRIALS = 4;
  c.STROOP.WORDS_PER_CATEGORY = 4;
  c.TASKSWITCH.N_PRACTICE_PURE = 2;
  c.TASKSWITCH.N_PRACTICE_MIXED = 2;
  c.TASKSWITCH.N_MIXED_TRIALS = 8;
  c.MIST.N_PRACTICE_TRIALS = 2;
  c.MIST.N_EXP_TRIALS = 5;
})();
