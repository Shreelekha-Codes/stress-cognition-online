# Stress & Cognition — online version

A short, browser-based version of the `stress-recovery-exp-with-stroop` lab
protocol. You send people a link, they do it on their own laptop in about
20 minutes, and every trial lands in a Google Sheet.

**Question:** which cognitive task is more sensitive to an acute stressor,
**emotional Stroop** or **parity/magnitude task switching**?

```
Consent → Demographics → Setup (sound check, full screen)
  → Cognitive task  (pre_stress)          ~3 min
  → VAS             (pre_mist)            ~20 s   ← on by default, see below
  → MIST stressor   (+ white noise)       ~4–5 min
  → VAS             (post_mist)           ~20 s
  → Cognitive task  (post_stress)         ~2.5 min
→ Feedback → Debrief
```

Each participant is assigned **one** task, Stroop or task switching, used
for both runs. This is between-subjects, as in the lab study. Assignment is
balanced: each new person gets whichever task has fewer participants.

> **Why a pre-stress VAS?** Your requested flow was Task → Stressor → VAS →
> Task. With a single VAS you can't show the stressor raised stress, which
> any reviewer will ask about. The extra VAS takes 20 s. To turn it off, set
> `VAS_PRE_STRESS: false` in [js/config.js](js/config.js).

---

## 1. Try it locally (2 minutes)

Double-click `index.html`, or open it in Chrome. Useful URL options:

| Add to the URL | Effect |
|---|---|
| `?quick=1` | Very short blocks, for checking the flow. Sessions are flagged `quick_mode=1`. |
| `?task=stroop` / `?task=taskswitch` | Force a task (piloting). |
| `?pid=AB12` | Use your own participant code instead of a random one. |
| `?skipcheck=1` | Skip the laptop/screen-size check. |

Example: `index.html?quick=1&task=stroop`

With no `DATA_URL` set, the last screen offers a **Download data file**
button (JSON) instead of uploading.

## 2. Data collection setup (Google Sheet, ~10 minutes, free)

1. Create a new Google Sheet, e.g. "Stress Cognition Online — data".
   Use an institutional account if your ethics approval requires it.
2. In the Sheet: **Extensions → Apps Script**. Delete the sample code, paste
   the whole of [apps_script/Code.gs](apps_script/Code.gs), and save.
3. Optional check: pick `testSetup` in the function list and click **Run**.
   Authorise it. A `sessions` tab with a TEST row should appear; delete it.
4. **Deploy → New deployment** → type **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**. This lets participants' browsers send data
     without a Google login. They can only append rows; they cannot read
     the Sheet.
5. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).
6. Paste it into [js/config.js](js/config.js):
   ```js
   DATA_URL: "https://script.google.com/macros/s/AKfy.../exec",
   ```
   Also set `RESEARCHER_CONTACT`, e.g. `"Your Name (you@university.edu)"`.
   Participants see it if an upload fails.

> If you later edit `Code.gs`, use **Deploy → Manage deployments → Edit →
> Version: New version**. This keeps the same URL. A *new deployment* gives
> a new URL.

Tabs are created automatically the first time data arrives. Reload the
Sheet once after pasting the script: a **Study** menu appears with
*Refresh dashboard* and *Create / show export key* (section "Analysis").

## Trial counts

| Part | Practice (with feedback) | Measured | ≈ Time |
|---|---|---|---|
| Stroop, pre-stress | 12 × "XXXXX" | 60 words (20 negative, 20 positive, 20 neutral) | 3 min |
| Stroop, post-stress | – | 60 words | 2.3 min |
| Switching, pre-stress | 8 parity + 8 magnitude + 8 mixed | 50 mixed | 3.5 min |
| Switching, post-stress | – | 50 mixed | 2.1 min |
| MIST | 5 | 35 (5 s start, ±10 % adaptive) | 4.5 min |
| VAS | – | 3 items × 2 | 20 s each |

Measured counts and trial timings match the lab's post-stress runs.

## 3. Put it online (GitHub Pages, free)

1. Create a GitHub repository, e.g. `stress-cognition-online`. Public
   repositories get free Pages; the code contains no data.
2. Upload the contents of this folder (`index.html`, `css/`, `js/`; the
   `analysis/` and `apps_script/` folders are harmless to include).
3. Repository **Settings → Pages → Source: Deploy from a branch → main / (root)**.
4. After about a minute your link is
   `https://<your-username>.github.io/stress-cognition-online/`.

**Before you send it out:** run through it once with `?quick=1`. Check that
rows appear in the Sheet. Then delete those rows, or filter on
`quick_mode = 1` later.

## 4. Piloting checklist

- [ ] One full-length run per task (`?task=stroop`, `?task=taskswitch`) on a
      typical lab laptop. Note the duration in the `sessions` tab.
- [ ] Check the white noise plays and the volume is reasonable.
- [ ] Check the consent and debrief wording in [js/forms.js](js/forms.js)
      against your ethics approval. The texts are marked **EDIT ME**.
- [ ] Delete pilot rows (or keep them flagged) before real data collection.
- [ ] Remind people: laptop, quiet room, 20 minutes, sound on, no tab switching.

---

## Data — one Sheet tab per type

Trial columns match the lab CSVs, so existing scripts can be reused. Extra
online-only columns are marked †.

### `stroop_trials` (same as `Stroop_*.csv`)
`participant_id, session, phase, block_type, trial, word, word_category,
ink_color, correct_response, participant_response, outcome, accuracy, rt,
timed_out, trial_onset_time`, plus † `is_practice, onset_frame_ms,
focus_lost, fullscreen, received_at`.

- `onset_frame_ms` (all three tasks): how long the frame that showed the
  stimulus took. About 16.7 ms at 60 Hz; more than 1.5 times the normal frame
  means a dropped frame delayed the onset.

- `phase`: `pre_stress` / `post_stress`. `block_type`: `practice` (first run
  only) / `test`.
- `outcome`: `correct` / `incorrect` / `missed`. `accuracy` and `rt` are empty
  for missed trials, as in the lab.
- `rt` in seconds from word onset. `trial_onset_time` is seconds since page load.

### `taskswitch_trials` (same as `TaskSwitch_*.csv`)
`participant_id, session, phase, block_type, block_num, trial, task, digit,
correct_response, participant_response, outcome, accuracy, rt, timed_out,
is_switch, congruent, trial_onset_time`, plus † `is_practice, focus_lost,
fullscreen`.

- Practice rows have `block_num = 0` and `is_practice = 1`. Practice only
  happens before the first run: 8 pure parity, 8 pure magnitude, 8 mixed.
- `is_switch` is empty for the first trial of a block.

### `mist_trials` (same as `MIST_*.csv`)
`participant_id, session, block (practice/experimental), trial, level, problem,
correct_answer, participant_answer, accuracy, answered, rt, time_limit,
trial_start_time, trial_end_time`, plus † `phase, outcome, timed_out,
next_time_limit, trial_onset_time, focus_lost, fullscreen`.

- `time_limit` is the limit **in force on that trial**. The lab CSV wrote the
  post-adaptation value; here that is `next_time_limit`.

### `vas` (same as `VAS_*.csv`)
`participant_id, session, timepoint (pre_mist/post_mist, the lab's labels), measure
(stressed/tense/calm), reverse_scored, rating (0–100), rt, timestamp`.
`calm` is reverse-scored.

### `events` (the LSL marker stream, as a table)
One row per event, using **the same trigger codes as the lab**
(`Stroop_Markers` 13/14/1/70–73/41–43/9, `TaskSwitch_Markers` 10–16/1/21/22/30–32/41–43/9,
`MIST_Markers` 20/1/2/3/9, `VAS_Markers` 60/61), with `time` in seconds on
the same clock as `trial_onset_time`. Also logs browser events (`Browser`,
code 0): `tab_hidden`, `window_blur`, `fullscreen_exit`, and so on.

### `summary` (one row per participant, for a quick look)
`pre_*`, `post_*` and `delta_*` for: `n_trials, n_correct, n_incorrect,
n_missed, accuracy` (correct ÷ responded), `accuracy_all` (correct ÷ all),
`mean_rt, median_rt, sd_rt` (correct trials, RT ≥ 0.2 s), and:
- Stroop: `rt_negative/positive/neutral`, `interference_neg_neu`,
  `interference_neg_pos`.
- Task switch: `rt_switch/repeat`, `switch_cost_rt`, `switch_cost_acc`,
  `congruency_cost_rt`.
- MIST accuracy, timeouts and final time limit.
- VAS items and a composite (mean of stressed, tense and 100 − calm), pre,
  post and delta.

### `sessions`, `demographics`, `feedback`, `assignments`
- `sessions`: a `started` row and a `completed` row per person. The
  `started` row is measured in full screen just before the first task:
  - display: `screen_w/h` (CSS px), `screen_w_px/h_px` (physical px),
    `device_pixel_ratio`, `window_w/h`, `color_depth`;
  - timing: `refresh_rate_hz`, `frame_ms_median/mean/sd`,
    `frames_dropped_pct`, `timer_resolution_ms`;
  - system: `browser`, `browser_version`, `os`, `cpu_cores`,
    `device_memory_gb`, `audio_sample_rate_hz`, `audio_base_latency_ms`,
    `user_agent`, `timezone`.

  The `completed` row adds the duration, counts of tab switches, blurs and
  fullscreen exits, and the frame timing measured again at the end.
  A browser has no fixed sampling rate: stimuli are drawn on screen
  refreshes (`refresh_rate_hz`), and key presses are time-stamped at
  `timer_resolution_ms` (≈ 0.1 ms in Chrome and Edge).
- `demographics`: age, gender, handedness, comfort with English
  (`english_comfort`, 1–5, 5 = fluent), colour vision, eyesight, education,
  sleep, caffeine, prior participation in the lab study, keyboard type.
- `feedback`:
  - Stroop only: `stroop_thrown_off` (yes / no / not sure) and
    `stroop_thrown_off_words` (which words);
  - both tasks: `performance_change` (worse after / no change / better after
    / not sure, compared before vs after the arithmetic) and
    `performance_change_detail`;
  - then instruction clarity, effort and arithmetic stress (1–5), heard the
    noise, distraction, technical problems, guessed purpose, comments.
- `assignments`: used by the balancer.

## Analysis — as data arrive

**Automatic: the `dashboard` tab.** Every time someone finishes, the Apps
Script rebuilds a `dashboard` tab in the Sheet. Pilot runs and `test*` IDs
are left out. It has four parts:

1. VAS pre vs post the MIST, per group.
2. Pre → post change per measure, with n, means, dz, 95 % CI, n up and
   n down.
3. Which task moved more (|dz| side by side).
4. One row per participant.

With fewer than 5 people per task, read the up/down counts and the rows,
not the CIs. You can also rebuild it any time from **Study → Refresh dashboard**.

**On demand: `analysis/analyze.py`.** It pulls straight from the Sheet:

1. In the Sheet, click **Study → Create / show export key**. Keep the key
   private.
2. Run:
   ```bash
   cd analysis
   python analyze.py --url "https://script.google.com/macros/s/.../exec" --key <key> --plots
   ```
   Or set the `STUDY_URL` and `STUDY_KEY` environment variables once and
   run `python analyze.py --plots`. A downloaded `.xlsx` also works:
   `python analyze.py file.xlsx`.

It works from the first participant. It prints each person's change, which
is the main read at small n. `running_effects.csv` and `running_effects.png`
show how dz moves as each person is added. Bootstrap CIs and the
head-to-head comparison start at 5 per task.

The script recomputes everything from the trial tabs and writes to `results/`:
- `participant_metrics.csv`: pre, post and delta per person, plus
  exclusion flags:
  - pre accuracy < 60 %;
  - more than 10 % of trials with a tab switch;
  - more than 10 % of trials with a dropped onset frame;
  - effort < 3;
  - colour-blind in the Stroop group.
- `individual_changes.csv`: each person's post − pre for the main measures.
- `running_effects.csv` / `.png`: dz recomputed as each participant is added.
- `manipulation_check.csv`: VAS stress composite, pre vs post stressor.
- `sensitivity.csv`: for every metric, mean change, 95 % CI, paired t,
  Wilcoxon, **Cohen's dz** with bootstrap CI, and Spearman ρ with the VAS
  change.
- `head_to_head.csv`: |dz| Stroop − |dz| task switch for the shared
  metrics (RT, accuracy, misses), with a bootstrap CI.

"More sensitive" = larger |dz| for the pre→post change. A stronger link
with the VAS change supports it further. With about 15–20 people per task,
expect wide CIs; treat this as a pilot that informs the main study.

## Differences from the lab protocol (for your methods section)

| | Lab | Online |
|---|---|---|
| Design | 4 sessions, EEG, image conditions | 1 session, behaviour only |
| Flow | Blank → VAS → MIST → VAS → Task → Images → Blank → VAS → Task | Task → VAS → MIST → VAS → Task |
| Practice | Separate baseline session | Folded into the first run (Stroop 12 × XXXXX; task switch 8 + 8 + 8) |
| MIST level | Individual (staircase in session 1) | Fixed: level 4, 5 s start, adaptive ±10 % (`mist_l5.py` defaults) |
| Task-switch run | 50 mixed trials | Same |
| Stroop run | 60 words | Same |
| Timing | PsychoPy, flip-locked | requestAnimationFrame-locked onsets, high-resolution key timestamps; ±1 frame plus keyboard latency (constant within a person) |
| Setting | Experimenter present (social-evaluative) | Alone; weaker stressor expected |

All task parameters live in [js/config.js](js/config.js).

## Files

```
index.html            page shell
css/style.css         layout (PsychoPy norm units converted to vh/vw)
js/config.js          ← all settings
js/core.js            timing, keyboard, event log, upload with retry + local backup
js/stroop.js          emotional Stroop          (port of stroop.py)
js/taskswitch.js      parity/magnitude switching (port of task_switch.py)
js/mist.js            MIST stressor             (port of mist_l5.py / mist.py)
js/mist_bank.js       400 verified problems per level 3–5 from question_bank.json
js/vas.js             VAS                       (port of vas.py)
js/forms.js           consent, demographics, setup, feedback, debrief  ← EDIT ME texts
js/summary.js         per-participant summary row
js/main.js            session flow
apps_script/Code.gs   Google Apps Script receiver (paste into the Sheet)
analysis/analyze.py   sensitivity analysis
```

## Privacy notes

- No names or emails are collected. People are identified by a random code
  (or your `?pid=`).
- The Apps Script URL is write-only and public, so anyone with it could add
  junk rows. Don't post it publicly; the participant link is enough.
  Unknown tab names are rejected.
- If an upload fails, data stays in the participant's browser and they are
  asked to download it and send it to you.
