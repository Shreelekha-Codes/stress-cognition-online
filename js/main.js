/*
 * Session flow:
 *
 *   Device check → Info + consent → Demographics → Setup (sound, full screen)
 *   → Cognitive task (pre_stress) → [VAS pre_stress] → MIST stressor
 *   → VAS post_stress → Cognitive task (post_stress) → Feedback → Debrief
 *
 * The cognitive task (Stroop or parity/magnitude switching) is assigned once
 * per participant and used for both runs. Data are uploaded after each
 * section, so a participant who quits half-way still leaves usable data.
 */
(function () {
  "use strict";
  const D = Core.Data;
  const VERSION = "1.0.0";

  const TASKS = { stroop: () => Stroop, taskswitch: () => TaskSwitch };

  async function assignTask() {
    const forced = new URLSearchParams(location.search).get("task");
    if (forced && TASKS[forced]) return { task: forced, method: "url" };
    if (CONFIG.TASK_ASSIGNMENT === "balanced" && CONFIG.DATA_URL) {
      try {
        const u = `${CONFIG.DATA_URL}?action=assign&participant_id=${encodeURIComponent(D.pid)}`;
        const res = await Core.fetchWithTimeout(u, {}, 10000);
        const j = await res.json();
        if (j.ok && TASKS[j.task]) return { task: j.task, method: "balanced" };
      } catch (e) {
        console.warn("Balanced assignment unavailable, using random", e);
      }
    }
    return { task: Math.random() < 0.5 ? "stroop" : "taskswitch", method: "random" };
  }

  function saveEvents() { D.save("events", Core.Events.take()); }

  function warnOnLeave(e) { e.preventDefault(); e.returnValue = ""; }

  async function main() {
    D.pid = Core.newParticipantId();
    const params = new URLSearchParams(location.search);

    const problem = Forms.deviceProblem();
    if (problem && params.get("skipcheck") !== "1") { Forms.blocked(problem); return; }

    // ── Consent ──────────────────────────────────────────────────────────
    const consent = await Forms.consent();
    // Audio must be created on a user gesture (the consent click).
    try { Core.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { Core.audio = null; }
    const assignment = assignTask(); // runs while they fill in demographics
    window.addEventListener("beforeunload", warnOnLeave);

    // ── Demographics ─────────────────────────────────────────────────────
    const demo = await Forms.demographics();
    const { task, method } = await assignment;
    D.task = task;
    const startedAt = Core.iso();
    D.save("demographics", [{ participant_id: D.pid, task, ...consent, ...demo, submitted: Core.iso() }]);

    // ── Setup ────────────────────────────────────────────────────────────
    const setup = await Forms.setup();
    Core.Events.log("Session", 0, "tasks_start", JSON.stringify(setup));

    // Display / timing / audio, measured in full screen just before the tasks.
    Core.showStage();
    Core.clearStage();
    const device = await Core.deviceInfo();
    const sessionInfo = {
      participant_id: D.pid, status: "started", task, assignment_method: method,
      start_time: startedAt, app_version: VERSION, quick_mode: Number(!!CONFIG.QUICK_MODE),
      url_params: location.search, ...setup, ...device,
    };
    D.save("sessions", [sessionInfo]);

    const Task = TASKS[task]();
    const cogSheet = task === "stroop" ? "stroop_trials" : "taskswitch_trials";

    // ── 1. Cognitive task, pre-stress ────────────────────────────────────
    const pre = await Task.run({ phase: "pre_stress", firstRun: true });
    D.save(cogSheet, pre); saveEvents();

    // ── 2. VAS before the stressor (optional, on by default) ─────────────
    let vasRows = [];
    if (CONFIG.VAS_PRE_STRESS) {
      const v = await VAS.run("pre_mist");     // same timepoint names as the lab
      vasRows = vasRows.concat(v);
      D.save("vas", v); saveEvents();
    }

    // ── 3. Stressor ──────────────────────────────────────────────────────
    const mist = await MIST.run();
    D.save("mist_trials", mist); saveEvents();

    // ── 4. VAS after the stressor ────────────────────────────────────────
    const v2 = await VAS.run("post_mist");
    vasRows = vasRows.concat(v2);
    D.save("vas", v2); saveEvents();

    // ── 5. Cognitive task, post-stress ───────────────────────────────────
    const post = await Task.run({ phase: "post_stress", firstRun: false });
    D.save(cogSheet, post); saveEvents();

    // Frame timing again at the end (did the machine slow down?).
    const endFrames = await Core.measureFrames(60);

    // ── Feedback ─────────────────────────────────────────────────────────
    if (Core.isFullscreen()) { try { await document.exitFullscreen(); } catch (_) {} }
    Core.phase = "feedback";
    const fb = await Forms.feedback(task);
    D.save("feedback", [{ participant_id: D.pid, task, ...fb, submitted: Core.iso() }]);

    const summary = Summary.build({ task, cogRows: pre.concat(post), mistRows: mist, vasRows, frameMs: device.frame_ms_median });
    D.save("summary", [{ ...summary, quick_mode: Number(!!CONFIG.QUICK_MODE) }]);

    const end = Core.iso();
    D.save("sessions", [{
      ...sessionInfo, status: "completed", end_time: end,
      duration_min: Math.round((Date.parse(end) - Date.parse(startedAt)) / 600) / 100,
      window_blur_count: Core.Quality.blurCount, tab_hidden_count: Core.Quality.hiddenCount,
      fullscreen_exit_count: Core.Quality.fullscreenExits,
      end_refresh_rate_hz: endFrames.refresh_rate_hz, end_frame_ms_sd: endFrames.frame_ms_sd,
      end_frames_dropped_pct: endFrames.frames_dropped_pct,
    }]);
    saveEvents();

    // ── Upload + debrief ─────────────────────────────────────────────────
    Forms.uploading();
    let ok = await D.flush();
    if (ok && CONFIG.DATA_URL) {
      // Tell the server this participant finished (balances assignment).
      try {
        await Core.fetchWithTimeout(CONFIG.DATA_URL, {
          method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ action: "complete", participant_id: D.pid, task }),
        }, 15000);
      } catch (_) { /* not critical */ }
    }
    window.removeEventListener("beforeunload", warnOnLeave);
    Forms.debrief(ok);
  }

  window.addEventListener("DOMContentLoaded", () => {
    main().catch((err) => {
      console.error(err);
      Core.Events.log("Session", 0, "error", String(err && err.stack || err));
      try { saveEvents(); } catch (_) {}
      Core.showPage();
      Core.page().innerHTML = "";
      const c = Core.el("div", "card", null, Core.page());
      Core.el("h1", null, "Something went wrong", c);
      Core.el("p", null, `Sorry, the study hit an error. Please contact ${CONFIG.RESEARCHER_CONTACT} and quote code ${D.pid}.`, c);
      Core.el("pre", "error", String(err && err.message || err), c);
      const b = Core.el("button", "btn", "Download data collected so far", c);
      b.onclick = () => D.downloadJSON();
    });
  });

  window.App = { VERSION };
})();
