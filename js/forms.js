/*
 * Participant-facing pages: device check, information + consent,
 * demographics, setup (sound + full screen), feedback and debrief.
 *
 * ── EDIT ME ── The study information, consent and debrief wording below are
 * starting drafts. Have them checked against your ethics approval.
 */
(function () {
  "use strict";
  const { el, page } = Core;

  const INFO_HTML = `
    <p>Thank you for your interest. This study compares two short attention
    tasks to see which one is more sensitive to a brief period of stress.</p>
    <h3>What you will do (about 20 minutes)</h3>
    <ol>
      <li>A few questions about you (age, vision, sleep, etc.).</li>
      <li>A short computer task where you respond to things on screen with the keyboard.</li>
      <li>Three quick ratings of how you feel right now.</li>
      <li>A timed mental-arithmetic task, with background noise.
          It is <strong>designed to be difficult</strong> and may feel stressful.</li>
      <li>The ratings again, then the computer task again.</li>
      <li>A few feedback questions.</li>
    </ol>
    <h3>What you need</h3>
    <ul>
      <li>A <strong>laptop or desktop computer with a physical keyboard</strong> (phones and tablets will not work).</li>
      <li>A quiet place where you will not be interrupted for 20 minutes.</li>
      <li>Sound switched on at a comfortable level (headphones are best).</li>
      <li>Please close other tabs, silence your phone, and do not switch windows during the tasks.
          The study runs in full screen.</li>
    </ul>
    <h3>Your data</h3>
    <p>Your responses are stored under a random code, not your name. Taking part
    is voluntary, and you can stop at any time by closing this window.
    The data from an unfinished session may still be kept, unless you ask
    %CONTACT% to delete it (quote the code shown at the end or in the
    page corner).</p>`;

  const DEBRIEF_HTML = `
    <p>Thank you, you have finished the study.</p>
    <h3>What the study was about</h3>
    <p>We are comparing two attention tasks, a colour-naming task (emotional
    Stroop) and a digit-judgement task (parity/magnitude switching), to see
    which one changes more after a brief stressor. Each participant does one of
    the two tasks, before and after the stressor.</p>
    <h3>About the arithmetic task</h3>
    <p>The arithmetic task is a standard laboratory stressor (the Montreal
    Imaging Stress Task). It was <strong>deliberately made very hard</strong>:
    the time limit got shorter whenever you did well, so almost everyone ends
    up in the red zone. The "group average" marker was a fixed value, not real
    data from other people. <strong>Your score on it says nothing about your
    ability.</strong> We are sorry for any stress it caused.</p>
    <p>Please do not tell other possible participants about the arithmetic
    task or the group-average marker, as this would affect their results.</p>`;

  // ── Helpers ────────────────────────────────────────────────────────────
  function card(title) {
    Core.showPage();
    const p = page();
    p.innerHTML = "";
    const c = el("div", "card", null, p);
    if (title) el("h1", null, title, c);
    return c;
  }

  function idBadge() {
    const b = el("div", "pid-badge", `Code: ${Core.Data.pid}`, page());
    return b;
  }

  // Field builders. Each returns the wrapper; inputs carry name = key.
  function radioGroup(form, name, label, options, required = true) {
    const fs = el("fieldset", "field", null, form);
    el("legend", null, label, fs);
    for (const [value, text] of options) {
      const l = el("label", "opt", null, fs);
      const i = el("input", null, null, l);
      Object.assign(i, { type: "radio", name, value, required });
      l.appendChild(document.createTextNode(" " + text));
    }
    return fs;
  }
  function scale(form, name, label, lowText, highText, n = 5) {
    const fs = el("fieldset", "field scale", null, form);
    el("legend", null, label, fs);
    const row = el("div", "scale-row", null, fs);
    el("span", "scale-end", lowText, row);
    for (let v = 1; v <= n; v++) {
      const l = el("label", "scale-opt", null, row);
      const i = el("input", null, null, l);
      Object.assign(i, { type: "radio", name, value: String(v), required: true });
      el("span", null, String(v), l);
    }
    el("span", "scale-end", highText, row);
    return fs;
  }
  function numberField(form, name, label, attrs) {
    const w = el("label", "field", null, form);
    el("span", "flabel", label, w);
    const i = el("input", null, null, w);
    Object.assign(i, { type: "number", name, required: true, ...attrs });
    return w;
  }
  function textArea(form, name, label, required = false) {
    const w = el("label", "field", null, form);
    el("span", "flabel", label + (required ? "" : " (optional)"), w);
    const t = el("textarea", null, null, w);
    Object.assign(t, { name, rows: 3, maxLength: 2000, required });
    return w;
  }
  function submitButton(form, text) {
    const b = el("button", "btn", text, form);
    b.type = "submit";
    return b;
  }
  const formValues = (form) => Object.fromEntries(new FormData(form).entries());

  // ── Pages ──────────────────────────────────────────────────────────────
  function deviceProblem() {
    const mobileUA = /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent) ||
      (navigator.userAgentData && navigator.userAgentData.mobile);
    const noFinePointer = window.matchMedia && !window.matchMedia("(any-pointer: fine)").matches;
    if (mobileUA || noFinePointer) return "This study needs a laptop or desktop computer with a physical keyboard. Please open the link on a computer.";
    if (screen.width < CONFIG.MIN_SCREEN_WIDTH || screen.height < CONFIG.MIN_SCREEN_HEIGHT)
      return `Your screen is too small for this study (minimum ${CONFIG.MIN_SCREEN_WIDTH} × ${CONFIG.MIN_SCREEN_HEIGHT}). Please use a laptop or desktop computer.`;
    return null;
  }

  function blocked(message) {
    const c = card(CONFIG.STUDY_TITLE);
    el("p", "warn", message, c);
  }

  function consent() {
    return new Promise((resolve) => {
      const c = card(CONFIG.STUDY_TITLE);
      const info = el("div", "info", null, c);
      info.innerHTML = INFO_HTML.replace("%CONTACT%", CONFIG.RESEARCHER_CONTACT);
      const form = el("form", null, null, c);
      const items = [
        ["age18", "I am 18 years or older."],
        ["agree", "I have read the information above and agree to take part."],
      ];
      for (const [name, text] of items) {
        const l = el("label", "check", null, form);
        const i = el("input", null, null, l);
        Object.assign(i, { type: "checkbox", name, required: true });
        l.appendChild(document.createTextNode(" " + text));
      }
      submitButton(form, "I agree, continue");
      form.onsubmit = (e) => {
        e.preventDefault();
        resolve({ consent_given: 1, consent_time: Core.iso() });
      };
      idBadge();
    });
  }

  function demographics() {
    return new Promise((resolve) => {
      const c = card("About you");
      el("p", "muted", "All questions are needed to interpret the results. Your answers are stored under a random code.", c);
      const form = el("form", null, null, c);
      numberField(form, "age", "Age (years)", { min: 18, max: 100, step: 1 });
      const g = radioGroup(form, "gender", "Gender", [
        ["woman", "Woman"], ["man", "Man"], ["non_binary", "Non-binary"],
        ["self_describe", "Prefer to self-describe"], ["prefer_not", "Prefer not to say"],
      ]);
      const sd = el("input", "inline-text", null, g);
      Object.assign(sd, { type: "text", name: "gender_self_describe", placeholder: "Self-describe (optional)", maxLength: 100 });
      radioGroup(form, "handedness", "Which hand do you write with?", [["right", "Right"], ["left", "Left"], ["ambidextrous", "Both / ambidextrous"]]);
      scale(form, "english_comfort", "How comfortable are you reading and understanding English?",
        "1 = not comfortable", "5 = very comfortable / fluent");
      radioGroup(form, "colour_vision", "Do you have any colour-vision deficiency (colour blindness)?", [["no", "No"], ["yes", "Yes"], ["not_sure", "Not sure"]]);
      radioGroup(form, "vision", "Your eyesight right now", [
        ["normal", "Normal, no glasses or lenses needed"],
        ["corrected_wearing", "I need glasses or lenses and am wearing them"],
        ["corrected_not_wearing", "I need glasses or lenses but am NOT wearing them"],
      ]);
      radioGroup(form, "education", "Current or highest education", [
        ["ug_student", "Undergraduate student"], ["bachelors", "Bachelor's degree"],
        ["masters", "Master's student or degree"], ["phd", "PhD student or degree"], ["other", "Other"],
      ]);
      numberField(form, "sleep_hours", "Hours of sleep last night (approximately)", { min: 0, max: 24, step: 0.5 });
      radioGroup(form, "caffeine_2h", "Have you had caffeine (coffee, tea, energy drink) in the last 2 hours?", [["no", "No"], ["yes", "Yes"]]);
      radioGroup(form, "prior_participation", "Have you taken part in, or helped run, the lab version of this stress experiment?", [["no", "No"], ["yes", "Yes"]]);
      radioGroup(form, "keyboard", "Which keyboard will you use?", [["laptop", "Built-in laptop keyboard"], ["external", "Separate (external) keyboard"]]);
      submitButton(form, "Continue");
      form.onsubmit = (e) => {
        e.preventDefault();
        resolve(formValues(form));
      };
      idBadge();
    });
  }

  // Sound check + enter full screen (both need a click).
  function setup() {
    return new Promise((resolve) => {
      const c = card("Get ready");
      const ol = el("ol", null, null, c);
      el("li", null, "Close other tabs and apps, and silence your phone.", ol);
      el("li", null, "Turn your sound on. Click the button below to play a short sample of the background noise used later, and set your volume so it is clearly audible but comfortable.", ol);
      el("li", null, "When you are ready, click Start. The study will switch to full screen; please stay in full screen until the end.", ol);
      const play = el("button", "btn btn-secondary", "▶ Play sound sample", c);
      play.type = "button";
      play.onclick = () => playSample();
      const heard = el("label", "check", null, c);
      const hc = el("input", null, null, heard);
      hc.type = "checkbox";
      heard.appendChild(document.createTextNode(" I can hear the sound."));
      const start = el("button", "btn", "Start (full screen)", c);
      start.disabled = true;
      hc.onchange = () => (start.disabled = !hc.checked);
      start.onclick = async () => {
        await Core.requestFullscreen();
        if (!Core.isFullscreen() && Core.fsSupported()) Core.fullscreenDeclined = !Core.isFullscreen();
        resolve({ sound_check_confirmed: 1, fullscreen_at_start: Number(Core.isFullscreen()) });
      };
      idBadge();
    });
  }

  function playSample() {
    const ctx = Core.audio;
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    const dur = 2;
    const buf = ctx.createBuffer(2, ctx.sampleRate * dur, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = CONFIG.MIST.WHITE_NOISE_VOLUME;
    src.connect(g).connect(ctx.destination);
    src.start();
  }

  // `task` = "stroop" | "taskswitch": the Stroop-only question and the task's
  // name in the performance-change question depend on it.
  function feedback(task) {
    return new Promise((resolve) => {
      const taskName = task === "stroop" ? "colour-naming task" : "digit task";
      const c = card("A few last questions");
      const form = el("form", null, null, c);
      if (task === "stroop") {
        radioGroup(form, "stroop_thrown_off", "In the colour-naming task, were you thrown off by any of the words?",
          [["no", "No"], ["yes", "Yes"], ["not_sure", "Not sure"]]);
        textArea(form, "stroop_thrown_off_words", "If yes, which word(s)?");
      }
      radioGroup(form, "performance_change",
        `Did you notice any change in how you did on the ${taskName} after the arithmetic task, compared with before it?`,
        [["worse_after", "Yes, I did worse after"], ["no_change", "No change"],
         ["better_after", "Yes, I did better after"], ["not_sure", "Not sure"]]);
      textArea(form, "performance_change_detail", "What did you notice?");
      scale(form, "instructions_clarity", `How clear were the instructions for the ${taskName}?`, "Very unclear", "Very clear");
      scale(form, "effort", "How much effort did you put into the tasks?", "Very little", "Maximum");
      scale(form, "arithmetic_stress", "How stressful was the arithmetic task?", "Not at all", "Extremely");
      radioGroup(form, "heard_noise", "Did you hear background noise during the arithmetic task?", [["yes", "Yes"], ["no", "No"], ["sound_off", "My sound was off"]]);
      radioGroup(form, "distracted", "Were you interrupted or distracted during the tasks?", [["no", "No"], ["briefly", "Briefly"], ["a_lot", "Yes, a lot"]]);
      radioGroup(form, "tech_problems", "Did you have any technical problems (lag, freezing, display or sound issues)?", [["no", "No"], ["yes", "Yes"]]);
      textArea(form, "tech_problems_detail", "If yes, what happened?");
      textArea(form, "purpose_guess", "What do you think this study was testing?");
      textArea(form, "comments", "Any other comments or suggestions?");
      submitButton(form, "Submit");
      form.onsubmit = (e) => {
        e.preventDefault();
        resolve(formValues(form));
      };
      idBadge();
    });
  }

  function uploading() {
    const c = card("Saving your data…");
    el("p", null, "Please keep this window open for a moment.", c);
    el("div", "spinner", null, c);
  }

  function debrief(uploadOk) {
    const c = card("Thank you!");
    const d = el("div", "info", null, c);
    d.innerHTML = DEBRIEF_HTML;
    const box = el("div", uploadOk ? "status ok" : "status bad", null, c);
    if (uploadOk) {
      el("p", null, `Your data has been saved. Your participant code is ${Core.Data.pid}. You can now close this window.`, box);
    } else {
      el("p", null,
        CONFIG.DATA_URL
          ? `We could not upload all of your data (the connection may have dropped). Please click the button below to download it, and send the file to ${CONFIG.RESEARCHER_CONTACT}. Your participant code is ${Core.Data.pid}.`
          : `Pilot mode: no upload address is set. Click below to download the data file. Participant code: ${Core.Data.pid}.`,
        box);
      const b = el("button", "btn", "Download data file", box);
      b.onclick = () => Core.Data.downloadJSON();
      if (CONFIG.DATA_URL) {
        const retry = el("button", "btn btn-secondary", "Try uploading again", box);
        retry.onclick = async () => {
          retry.disabled = true;
          retry.textContent = "Uploading…";
          const ok = await Core.Data.flush();
          if (ok) debrief(true);
          else { retry.disabled = false; retry.textContent = "Try uploading again"; }
        };
      }
    }
  }

  window.Forms = { deviceProblem, blocked, consent, demographics, setup, feedback, uploading, debrief };
})();
