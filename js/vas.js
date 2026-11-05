/*
 * Visual Analogue Scale — port of vas.py.
 * Three items shown back to back; click (or drag) anywhere on the 0–100
 * line, then click Confirm. "calm" is reverse-scored (recorded per row).
 */
(function () {
  "use strict";
  const { el, stage, present, iso } = Core;

  const QUESTIONS = [
    ["stressed", "Right now, how stressed do you feel?", false],
    ["tense", "Right now, how tense do you feel?", false],
    ["calm", "Right now, how calm do you feel?", true],
  ];
  const TRIGGERS = { vas_onset: 60, vas_response: 61 };

  function askOne(measure, prompt) {
    return new Promise(async (resolve) => {
      const s = stage();
      s.innerHTML = "";
      document.body.classList.add("show-cursor");
      const wrap = el("div", "vas", null, s);
      el("div", "vas-prompt", prompt, wrap);
      const track = el("div", "vas-track", null, wrap);
      el("div", "vas-line", null, track);
      el("div", "vas-tick vas-tick-left", null, track);
      el("div", "vas-tick vas-tick-right", null, track);
      const marker = el("div", "vas-marker", null, track);
      marker.hidden = true;
      el("div", "vas-label vas-label-left", `Not at all ${measure}`, track);
      el("div", "vas-label vas-label-right", `Extremely ${measure}`, track);
      const btn = el("button", "vas-confirm", "Confirm", wrap);
      btn.disabled = true;

      let rating = null;
      let dragging = false;
      const setFromX = (clientX) => {
        const r = track.getBoundingClientRect();
        const v = Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * 100);
        rating = v;
        marker.hidden = false;
        marker.style.left = v + "%";
        btn.disabled = false;
      };
      track.addEventListener("pointerdown", (e) => { dragging = true; track.setPointerCapture(e.pointerId); setFromX(e.clientX); });
      track.addEventListener("pointermove", (e) => { if (dragging) setFromX(e.clientX); });
      track.addEventListener("pointerup", () => { dragging = false; });

      const onset = await present(() => {});
      Core.Events.log("VAS_Markers", TRIGGERS.vas_onset, "vas_onset", measure);

      btn.addEventListener("click", (e) => {
        if (rating == null) return;
        const rt = (performance.now() - onset) / 1000;
        Core.Events.log("VAS_Markers", TRIGGERS.vas_response, "vas_response", measure);
        document.body.classList.remove("show-cursor");
        resolve({ rating, rt });
      });
    });
  }

  async function run(timepoint) {
    Core.phase = "vas_" + timepoint;
    Core.showStage();
    await Core.ensureFullscreen();
    const rows = [];
    for (const [measure, prompt, reverse] of QUESTIONS) {
      const { rating, rt } = await askOne(measure, prompt);
      rows.push({
        participant_id: Core.Data.pid,
        session: Core.Data.session,
        timepoint,
        measure,
        reverse_scored: reverse ? "True" : "False",
        rating,
        rt: Math.round(rt * 10000) / 10000,
        timestamp: iso(),
      });
    }
    Core.clearStage();
    return rows;
  }

  window.VAS = { run, QUESTIONS };
})();
