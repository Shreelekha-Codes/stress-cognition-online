/*
 * Core engine: timing, keyboard, screens, event log, data-quality tracking
 * and data upload. Shared by every task.
 *
 * Timing
 *   Stimuli are drawn inside a requestAnimationFrame callback, and the onset
 *   is the timestamp of the NEXT frame — the closest a browser gets to
 *   PsychoPy's flip-locked onset. RTs are keydown event.timeStamp − onset;
 *   both are on the performance.now() clock, so RT precision is ~1 ms plus
 *   keyboard latency (typically 5–30 ms on laptops, constant within a person,
 *   so pre/post comparisons are unaffected).
 */
(function () {
  "use strict";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const now = () => performance.now();
  const sec = (ms) => Math.round(ms) / 1000; // ms → s, 3 dp
  const iso = () => new Date().toISOString();

  // Draw `render` on the next frame; resolve with the timestamp of the frame
  // after that, i.e. when the drawn frame reached the screen.
  // Also records the duration of the frame that carried the stimulus
  // (Core.lastFrameMs): ≈ 1000/refresh normally, larger if a frame was
  // dropped at onset. Tasks save it per trial as `onset_frame_ms`.
  async function present(render) {
    const t1 = await frame();
    render();
    const t2 = await frame();
    window.Core.lastFrameMs = Math.round((t2 - t1) * 100) / 100;
    return t2;
  }

  // ── Random helpers ─────────────────────────────────────────────────────
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const choice = (a) => a[Math.floor(Math.random() * a.length)];

  // ── Keyboard ───────────────────────────────────────────────────────────
  // Physical-key names, matching PsychoPy key names used in the originals.
  function keyName(e) {
    if (/^[0-9]$/.test(e.key)) return e.key;
    const c = e.code || "";
    if (/^Key[A-Z]$/.test(c)) return c.slice(3).toLowerCase();
    if (/^(Digit|Numpad)[0-9]$/.test(c)) return c.slice(-1);
    switch (c) {
      case "ArrowLeft": return "left";
      case "ArrowRight": return "right";
      case "Space": return "space";
      case "Enter": case "NumpadEnter": return "return";
      case "Backspace": return "backspace";
    }
    if (e.key === " ") return "space";
    if (e.key === "Enter") return "return";
    if (e.key === "Backspace") return "backspace";
    return (e.key || "").toLowerCase();
  }

  function eventTime(e) {
    // event.timeStamp is a performance.now()-clock value in all current
    // browsers; very old ones used epoch ms, so fall back if it looks wrong.
    const t = e.timeStamp;
    return t > 0 && t < 1e11 ? t : now();
  }

  /*
   * Wait for one of `keys`. With `timeout` (ms), resolves {timedOut:true}
   * if nothing arrives within `timeout` of `onset` (or of the call).
   * Returns {key, t, rt (s from onset), timedOut}.
   */
  function waitForKey(keys, opts = {}) {
    const { timeout = null, onset = null, onKey = null } = opts;
    const t0 = onset != null ? onset : now();
    return new Promise((resolve) => {
      let timer = null;
      const done = (val) => {
        window.removeEventListener("keydown", handler, true);
        if (timer) clearTimeout(timer);
        resolve(val);
      };
      function handler(e) {
        const k = keyName(e);
        if (["space", "left", "right", "backspace"].includes(k)) e.preventDefault();
        if (e.repeat || !keys.includes(k)) return;
        const t = eventTime(e);
        if (timeout != null && t - t0 > timeout) return; // arrived after deadline
        if (onKey && onKey(k, t) === false) return;      // consumed, keep waiting
        done({ key: k, t, rt: (t - t0) / 1000, timedOut: false });
      }
      window.addEventListener("keydown", handler, true);
      if (timeout != null) {
        timer = setTimeout(
          () => done({ key: null, t: null, rt: null, timedOut: true }),
          Math.max(0, t0 + timeout - now())
        );
      }
    });
  }

  // ── Screen ─────────────────────────────────────────────────────────────
  const stage = () => document.getElementById("stage");
  const page = () => document.getElementById("page");

  function showStage() {
    page().hidden = true;
    stage().hidden = false;
    document.body.classList.add("task-mode");
  }
  function showPage() {
    stage().hidden = true;
    page().hidden = false;
    document.body.classList.remove("task-mode");
    window.scrollTo(0, 0);
  }
  function clearStage() { stage().innerHTML = ""; }

  function el(tag, cls, text, parent) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }

  // Full-screen instruction text (PsychoPy-style) that waits for SPACE.
  async function instructions(text, opts = {}) {
    showStage();
    await ensureFullscreen();
    clearStage();
    const box = el("div", "instruct", null, stage());
    box.textContent = text;
    if (opts.extra) box.appendChild(opts.extra);
    await frame();
    await waitForKey(opts.keys || ["space"]);
    clearStage();
  }

  async function blank(ms) {
    await present(clearStage);
    await sleep(ms);
  }

  // ── Fullscreen ─────────────────────────────────────────────────────────
  const fsSupported = () =>
    !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

  async function requestFullscreen() {
    const d = document.documentElement;
    try {
      if (d.requestFullscreen) await d.requestFullscreen({ navigationUI: "hide" });
      else if (d.webkitRequestFullscreen) d.webkitRequestFullscreen();
    } catch (_) { /* denied — carry on windowed */ }
  }

  // Between blocks, ask the participant to go back to full screen if they
  // left it. Needs a click (browsers only allow fullscreen on a gesture).
  function ensureFullscreen() {
    if (!fsSupported() || isFullscreen() || Core.fullscreenDeclined) return Promise.resolve();
    return new Promise((resolve) => {
      const ov = el("div", "overlay", null, document.body);
      const card = el("div", "overlay-card", null, ov);
      el("p", null, "The study needs to run in full screen. Please click the button to continue.", card);
      const btn = el("button", "btn", "Return to full screen", card);
      btn.onclick = async () => {
        await requestFullscreen();
        if (!isFullscreen()) Core.fullscreenDeclined = true; // browser refused
        ov.remove();
        resolve();
      };
    });
  }

  // ── Event-marker log (same codes as the LSL triggers in the lab) ────────
  const Events = {
    rows: [],
    log(stream, code, label, extra) {
      const r = {
        participant_id: Data.pid, session: Data.session, phase: Core.phase || "",
        stream, code, label, time: sec(now()), wall_time: iso(),
      };
      if (extra) r.detail = extra;
      this.rows.push(r);
    },
    take() { const r = this.rows; this.rows = []; return r; },
  };

  // ── Data-quality tracking ──────────────────────────────────────────────
  // `trialFlags.focusLost` is set if the page lost focus or was hidden at
  // any point during the current trial; tasks copy it into each row.
  const Quality = {
    blurCount: 0, hiddenCount: 0, fullscreenExits: 0,
    trialFlags: { focusLost: false },
    resetTrial() { this.trialFlags.focusLost = false; },
  };
  window.addEventListener("blur", () => {
    Quality.blurCount++; Quality.trialFlags.focusLost = true;
    Events.log("Browser", 0, "window_blur");
  });
  window.addEventListener("focus", () => Events.log("Browser", 0, "window_focus"));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { Quality.hiddenCount++; Quality.trialFlags.focusLost = true; }
    Events.log("Browser", 0, document.hidden ? "tab_hidden" : "tab_visible");
  });
  const onFs = () => {
    if (!isFullscreen()) { Quality.fullscreenExits++; Quality.trialFlags.focusLost = true; }
    Events.log("Browser", 0, isFullscreen() ? "fullscreen_enter" : "fullscreen_exit");
  };
  document.addEventListener("fullscreenchange", onFs);
  document.addEventListener("webkitfullscreenchange", onFs);

  // ── Data store + upload ────────────────────────────────────────────────
  const LS_KEY = "stress_cog_online_backup";

  const Data = {
    pid: "", session: 1, task: "",
    store: {},     // sheet → all rows (local copy of everything)
    pending: [],   // batches not yet confirmed by the server
    uploading: Promise.resolve(),

    save(sheet, rows) {
      if (!rows || !rows.length) return;
      (this.store[sheet] = this.store[sheet] || []).push(...rows);
      this.backup();
      const batch = { batch_id: `${this.pid}-${sheet}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, sheet, rows };
      this.pending.push(batch);
      // Chain uploads so batches go one at a time, in order.
      this.uploading = this.uploading.then(() => this.trySend(batch));
      return this.uploading;
    },

    async trySend(batch, attempts = 3) {
      if (!CONFIG.DATA_URL) return false;
      for (let i = 0; i < attempts; i++) {
        try {
          const res = await fetchWithTimeout(CONFIG.DATA_URL, {
            method: "POST",
            // text/plain keeps this a CORS "simple request" (no preflight),
            // which Apps Script web apps require.
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "append", participant_id: this.pid, ...batch }),
          }, 20000);
          const j = await res.json();
          if (j.ok) {
            this.pending = this.pending.filter((b) => b !== batch);
            this.backup();
            return true;
          }
          console.warn("Upload rejected", j);
        } catch (err) {
          console.warn("Upload failed", err);
        }
        await sleep(1000 * (i + 1) * 2);
      }
      return false;
    },

    // Retry everything still pending; true when nothing is left.
    async flush() {
      await this.uploading;
      if (!CONFIG.DATA_URL) return false;
      for (const b of [...this.pending]) await this.trySend(b, 4);
      return this.pending.length === 0;
    },

    backup() {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ pid: this.pid, saved: iso(), store: this.store, pendingCount: this.pending.length }));
      } catch (_) { /* storage full / blocked — upload is the primary path */ }
    },

    downloadJSON() {
      const blob = new Blob([JSON.stringify({ participant_id: this.pid, exported: iso(), data: this.store }, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `stress_cog_${this.pid}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
  };

  async function fetchWithTimeout(url, opts, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ctl.signal, redirect: "follow" }); }
    finally { clearTimeout(t); }
  }

  // ── Device info ────────────────────────────────────────────────────────
  // Display refresh: median/mean/SD frame interval over `nFrames` frames, and
  // the share of frames that took > 1.5× the median (dropped frames).
  async function measureFrames(nFrames = 120) {
    const ts = [];
    for (let i = 0; i < nFrames; i++) ts.push(await frame());
    const d = ts.slice(1).map((t, i) => t - ts[i]);
    const s = d.slice().sort((a, b) => a - b);
    const median = s[Math.floor(s.length / 2)];
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / (d.length - 1));
    const r2 = (x) => Math.round(x * 100) / 100;
    return {
      refresh_rate_hz: median > 0 ? Math.round(1000 / median) : null,
      frame_ms_median: r2(median), frame_ms_mean: r2(mean), frame_ms_sd: r2(sd),
      frames_dropped_pct: r2((100 * d.filter((x) => x > 1.5 * median).length) / d.length),
    };
  }
  const estimateRefreshRate = async (n = 60) => (await measureFrames(n)).refresh_rate_hz;

  // Smallest step of performance.now() (browsers coarsen it: ~0.1 ms in
  // Chrome/Edge, 1 ms in Firefox/Safari) — the floor of RT precision.
  function timerResolution() {
    let best = Infinity;
    for (let i = 0; i < 50; i++) {
      const a = performance.now();
      let b = a;
      while (b === a) b = performance.now();
      best = Math.min(best, b - a);
    }
    return Math.round(best * 1000) / 1000;
  }

  function browserName() {
    const ua = navigator.userAgent;
    const m = ua.match(/Edg\/([\d.]+)/) ? ["Edge", ua.match(/Edg\/([\d.]+)/)[1]]
      : ua.match(/OPR\/([\d.]+)/) ? ["Opera", ua.match(/OPR\/([\d.]+)/)[1]]
      : ua.match(/Firefox\/([\d.]+)/) ? ["Firefox", ua.match(/Firefox\/([\d.]+)/)[1]]
      : ua.match(/Chrome\/([\d.]+)/) ? ["Chrome", ua.match(/Chrome\/([\d.]+)/)[1]]
      : ua.match(/Version\/([\d.]+).*Safari/) ? ["Safari", ua.match(/Version\/([\d.]+)/)[1]]
      : ["other", ""];
    const os = /Windows NT 10/.test(ua) ? "Windows 10/11" : /Windows/.test(ua) ? "Windows"
      : /Mac OS X/.test(ua) ? "macOS" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "other";
    return { browser: m[0], browser_version: m[1], os };
  }

  // Everything about the display, timing and audio, measured once the page
  // is full screen (call after the participant clicks Start).
  async function deviceInfo() {
    const dpr = window.devicePixelRatio || 1;
    const frames = await measureFrames(120);
    const a = window.Core.audio;
    return {
      ...browserName(),
      screen_w: screen.width, screen_h: screen.height,                       // CSS pixels
      screen_w_px: Math.round(screen.width * dpr), screen_h_px: Math.round(screen.height * dpr), // physical pixels
      device_pixel_ratio: dpr,
      window_w: innerWidth, window_h: innerHeight,                          // area the tasks drew in
      color_depth: screen.colorDepth,
      fullscreen_active: Number(isFullscreen()),
      ...frames,
      timer_resolution_ms: timerResolution(),
      audio_sample_rate_hz: a ? a.sampleRate : "",
      audio_base_latency_ms: a && a.baseLatency != null ? Math.round(a.baseLatency * 10000) / 10 : "",
      audio_output_latency_ms: a && a.outputLatency ? Math.round(a.outputLatency * 10000) / 10 : "",
      cpu_cores: navigator.hardwareConcurrency || "",
      device_memory_gb: navigator.deviceMemory || "",
      max_touch_points: navigator.maxTouchPoints || 0,
      user_agent: navigator.userAgent,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
    };
  }

  function newParticipantId() {
    const p = new URLSearchParams(location.search).get("pid");
    if (p) {
      const clean = p.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
      if (clean) return clean;
    }
    const a = new Uint8Array(4);
    crypto.getRandomValues(a);
    return "P" + Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("").toUpperCase().slice(0, 7);
  }

  window.Core = {
    sleep, frame, now, sec, iso, present, shuffle, choice,
    keyName, waitForKey, showStage, showPage, clearStage, el, stage, page,
    instructions, blank, requestFullscreen, ensureFullscreen, isFullscreen, fsSupported,
    estimateRefreshRate, measureFrames, deviceInfo, newParticipantId, fetchWithTimeout,
    lastFrameMs: null,
    Events, Quality, Data,
    phase: "", fullscreenDeclined: false,
  };
})();
