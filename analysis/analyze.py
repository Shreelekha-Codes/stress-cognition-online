"""
Which cognitive task is more sensitive to the stressor?

Run it whenever new data arrive — it works from n = 1 upward. With few
people per task it prints each person's change (read those, not p-values);
from about 5 per task the group statistics become meaningful, and
running_effects.csv shows how the effect sizes settle as people are added.

Input, either:
  - straight from the Sheet (no download): --url <web app /exec URL> --key <export key>
    (key: in the Sheet, Study → Create / show export key), or set the
    STUDY_URL and STUDY_KEY environment variables once;
  - the Sheet downloaded as File → Download → Microsoft Excel (.xlsx);
  - a folder of CSVs named <tab>.csv.

    python analyze.py --url https://script.google.com/macros/s/.../exec --key abc123 --plots
    python analyze.py stress_cognition.xlsx --exclude        # apply exclusion flags

Steps
  1. Keep completed sessions (not ?quick=1 pilots).
  2. Per participant × phase (pre_stress / post_stress), from measured trials:
     accuracy, accuracy_all, n correct / incorrect / missed, mean & median RT
     (correct trials, rt >= 0.2 s), plus task-specific effects
       Stroop:      interference_neg_neu, interference_neg_pos
       Task switch: switch_cost_rt, switch_cost_acc, congruency_cost_rt
  3. Manipulation check: VAS stress composite pre vs post the stressor.
  4. Sensitivity: post − pre change per metric, paired t, Wilcoxon,
     Cohen's dz (mean change / SD of change) with a bootstrap 95 % CI, and
     the correlation of each change with the VAS change.
  5. Head-to-head: dz(Stroop) vs dz(Task switch) for comparable metrics,
     with a bootstrap CI on the difference in |dz|.

Outputs go to ./results/ (or --out).
"""

from __future__ import annotations

import argparse
import json
import os
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

MIN_RT = 0.2
RNG = np.random.default_rng(2026)
N_BOOT = 5000

# Exclusion flags (applied with --exclude; always reported).
MIN_ACCURACY_ALL = 0.60   # pre-stress accuracy incl. misses — below = not doing the task
MAX_FOCUS_LOST = 0.10     # share of measured trials with a tab switch / blur
MIN_EFFORT = 3            # feedback "effort" 1–5
MAX_LATE_ONSET = 0.10     # share of measured trials whose stimulus frame was > 1.5× normal
MIN_N_STATS = 5           # below this many per task, group statistics are not reported as findings

# Primary effect per task, used for the running-effect table.
PRIMARY = {"stroop": ["mean_rt", "accuracy_all", "interference_neg_neu"],
           "taskswitch": ["mean_rt", "accuracy_all", "switch_cost_rt"]}

# Metrics compared across tasks (same name in both) and task-specific ones.
COMMON = ["mean_rt", "median_rt", "accuracy", "accuracy_all", "n_missed"]
SPECIFIC = {
    "stroop": ["interference_neg_neu", "interference_neg_pos"],
    "taskswitch": ["switch_cost_rt", "switch_cost_acc", "congruency_cost_rt"],
}


# ── Loading ─────────────────────────────────────────────────────────────────
def load(src: Path | None, url: str | None = None, key: str | None = None) -> dict[str, pd.DataFrame]:
    if url:
        with urllib.request.urlopen(f"{url}?action=export&key={key}", timeout=120) as r:
            j = json.load(r)
        if not j.get("ok"):
            raise SystemExit(f"Export refused: {j.get('error')} (check --key)")
        print(f"Downloaded from the Sheet at {j['exported_at']}")
        return {k: pd.DataFrame(v) for k, v in j["sheets"].items() if v}
    if src.is_dir():
        return {p.stem: pd.read_csv(p) for p in src.glob("*.csv")}
    return pd.read_excel(src, sheet_name=None)


# ── Per-phase metrics (same rules as js/summary.js) ────────────────────────
def _rt(df: pd.DataFrame) -> pd.Series:
    ok = df[(df.outcome == "correct") & (pd.to_numeric(df.rt, errors="coerce") >= MIN_RT)]
    return pd.to_numeric(ok.rt)


def _acc(df: pd.DataFrame) -> float:
    resp = df[df.outcome != "missed"]
    return (resp.outcome == "correct").mean() if len(resp) else np.nan


def phase_metrics(df: pd.DataFrame, task: str) -> dict:
    rt = _rt(df)
    m = {
        "n_trials": len(df),
        "n_correct": int((df.outcome == "correct").sum()),
        "n_incorrect": int((df.outcome == "incorrect").sum()),
        "n_missed": int((df.outcome == "missed").sum()),
        "accuracy": _acc(df),
        "accuracy_all": (df.outcome == "correct").mean() if len(df) else np.nan,
        "mean_rt": rt.mean(),
        "median_rt": rt.median(),
        "focus_lost_share": pd.to_numeric(df.get("focus_lost", 0), errors="coerce").fillna(0).mean(),
    }
    if "onset_frame_ms" in df and "frame_ms_median" in df:
        f = pd.to_numeric(df.onset_frame_ms, errors="coerce")
        m["late_onset_share"] = (f > 1.5 * pd.to_numeric(df.frame_ms_median, errors="coerce")).mean()
    if task == "stroop":
        r = {c: _rt(df[df.word_category == c]).mean() for c in ("negative", "positive", "neutral")}
        m.update({f"rt_{c}": v for c, v in r.items()})
        m["interference_neg_neu"] = r["negative"] - r["neutral"]
        m["interference_neg_pos"] = r["negative"] - r["positive"]
    else:
        sw = pd.to_numeric(df.is_switch, errors="coerce")
        cg = pd.to_numeric(df.congruent, errors="coerce")
        m["rt_switch"], m["rt_repeat"] = _rt(df[sw == 1]).mean(), _rt(df[sw == 0]).mean()
        m["switch_cost_rt"] = m["rt_switch"] - m["rt_repeat"]
        m["switch_cost_acc"] = _acc(df[sw == 0]) - _acc(df[sw == 1])
        m["congruency_cost_rt"] = _rt(df[cg == 0]).mean() - _rt(df[cg == 1]).mean()
    return m


def participant_table(sheets: dict[str, pd.DataFrame], include_incomplete: bool) -> pd.DataFrame:
    sess = sheets["sessions"].assign(participant_id=lambda d: d.participant_id.astype(str))
    completed = set(sess.loc[sess.status == "completed", "participant_id"])
    quick = set(sess.loc[pd.to_numeric(sess.get("quick_mode", 0), errors="coerce") == 1, "participant_id"])
    # Completion order (for running effects) and each person's normal frame duration.
    done = sess[sess.status == "completed"].drop_duplicates("participant_id", keep="last")
    order = {p: i for i, p in enumerate(done.sort_values("end_time" if "end_time" in done else "participant_id").participant_id)}
    frame = (sess.drop_duplicates("participant_id").set_index("participant_id").get("frame_ms_median")
             if "frame_ms_median" in sess else None)

    rows = []
    for task, tab in (("stroop", "stroop_trials"), ("taskswitch", "taskswitch_trials")):
        if tab not in sheets:
            continue
        trials = sheets[tab].copy()
        trials["participant_id"] = trials.participant_id.astype(str)
        if frame is not None:
            trials["frame_ms_median"] = trials.participant_id.map(frame)
        trials = trials[pd.to_numeric(trials.is_practice, errors="coerce") == 0]
        for pid, g in trials.groupby("participant_id"):
            if pid in quick or (not include_incomplete and pid not in completed):
                continue
            row = {"participant_id": pid, "task": task, "completion_order": order.get(pid, len(order))}
            for phase in ("pre_stress", "post_stress"):
                ph = g[g.phase == phase]
                if len(ph):
                    for k, v in phase_metrics(ph, task).items():
                        row[f"{phase.split('_')[0]}_{k}"] = v
            rows.append(row)
    df = pd.DataFrame(rows)
    if df.empty:
        raise SystemExit("No usable participants found.")

    # VAS composite = mean(stressed, tense, 100 − calm)
    vas = sheets.get("vas")
    if vas is not None and len(vas):
        vas = vas.assign(participant_id=vas.participant_id.astype(str),
                         score=np.where(vas.measure == "calm", 100 - vas.rating, vas.rating))
        comp = vas.pivot_table(index="participant_id", columns="timepoint", values="score", aggfunc="mean")
        comp.columns = [f"vas_{c}" for c in comp.columns]
        df = df.merge(comp, left_on="participant_id", right_index=True, how="left")
        if {"vas_pre_mist", "vas_post_mist"} <= set(df.columns):
            df["vas_change"] = df.vas_post_mist - df.vas_pre_mist

    mist = sheets.get("mist_trials")
    if mist is not None and len(mist):
        e = mist[mist.block == "experimental"].assign(participant_id=lambda d: d.participant_id.astype(str))
        df = df.merge(e.groupby("participant_id").accuracy.mean().rename("mist_accuracy"),
                      left_on="participant_id", right_index=True, how="left")

    for tab, cols in (("demographics", ["age", "gender", "colour_vision", "english_comfort", "prior_participation"]),
                      ("feedback", ["effort", "distracted", "heard_noise", "tech_problems",
                                    "performance_change", "stroop_thrown_off", "stroop_thrown_off_words"])):
        if tab in sheets:
            t = sheets[tab].assign(participant_id=lambda d: d.participant_id.astype(str))
            t = t.drop_duplicates("participant_id", keep="last")
            df = df.merge(t[["participant_id"] + [c for c in cols if c in t]], on="participant_id", how="left")

    # Delta columns
    for c in [c[4:] for c in df.columns if c.startswith("pre_")]:
        if f"post_{c}" in df:
            df[f"delta_{c}"] = df[f"post_{c}"] - df[f"pre_{c}"]

    # Exclusion flags
    flags = pd.DataFrame(index=df.index)
    flags["low_accuracy"] = df.pre_accuracy_all < MIN_ACCURACY_ALL
    flags["unfocused"] = (df.pre_focus_lost_share > MAX_FOCUS_LOST) | (df.get("post_focus_lost_share", 0) > MAX_FOCUS_LOST)
    flags["low_effort"] = (pd.to_numeric(df["effort"], errors="coerce") < MIN_EFFORT) if "effort" in df else False
    if "pre_late_onset_share" in df:
        flags["timing_unreliable"] = (df.pre_late_onset_share > MAX_LATE_ONSET) | (df.get("post_late_onset_share", 0) > MAX_LATE_ONSET)
    flags["colour_blind_stroop"] = (df.task == "stroop") & (df.get("colour_vision") == "yes")
    flags["no_post_run"] = df.get("post_n_trials").isna() if "post_n_trials" in df else True
    df["exclusion_reasons"] = flags.apply(lambda r: ";".join(k for k, v in r.items() if v), axis=1)
    return df


# ── Statistics ─────────────────────────────────────────────────────────────
def dz(x: np.ndarray) -> float:
    return x.mean() / x.std(ddof=1) if len(x) > 1 and x.std(ddof=1) > 0 else np.nan


def boot_dz(x: np.ndarray) -> np.ndarray:
    idx = RNG.integers(0, len(x), size=(N_BOOT, len(x)))
    s = x[idx]
    sd = s.std(axis=1, ddof=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(sd > 0, s.mean(axis=1) / sd, np.nan)


def change_stats(d: pd.DataFrame, metric: str) -> dict | None:
    pre, post = f"pre_{metric}", f"post_{metric}"
    if pre not in d or post not in d:
        return None
    x = d[[pre, post]].apply(pd.to_numeric, errors="coerce").dropna()
    n = len(x)
    if n < 3:
        return {"metric": metric, "n": n}
    ch = (x[post] - x[pre]).to_numpy()
    t, p = stats.ttest_rel(x[post], x[pre])
    try:
        w_p = stats.wilcoxon(ch).pvalue if np.any(ch != 0) else np.nan
    except ValueError:
        w_p = np.nan
    # Bootstrap CIs are meaningless with a handful of people (resamples are
    # often all-identical → near-zero SD → absurd dz), so only from MIN_N_STATS.
    b = boot_dz(ch) if n >= MIN_N_STATS else np.array([np.nan])
    out = {
        "metric": metric, "n": n,
        "pre_mean": x[pre].mean(), "post_mean": x[post].mean(),
        "change_mean": ch.mean(), "change_sd": ch.std(ddof=1),
        "change_ci_low": ch.mean() - stats.t.ppf(0.975, n - 1) * ch.std(ddof=1) / np.sqrt(n),
        "change_ci_high": ch.mean() + stats.t.ppf(0.975, n - 1) * ch.std(ddof=1) / np.sqrt(n),
        "t": t, "p_ttest": p, "p_wilcoxon": w_p,
        "dz": dz(ch), "dz_ci_low": np.nanpercentile(b, 2.5), "dz_ci_high": np.nanpercentile(b, 97.5),
    }
    if "vas_change" in d:
        v = d.loc[x.index, "vas_change"]
        ok = v.notna()
        if ok.sum() >= 4:
            r, rp = stats.spearmanr(ch[ok.to_numpy()], v[ok])
            out.update({"rho_with_vas_change": r, "p_rho": rp})
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", type=Path, nargs="?", help=".xlsx export of the Sheet, or a folder of <tab>.csv files")
    ap.add_argument("--url", default=os.environ.get("STUDY_URL"), help="Apps Script web-app URL (or env STUDY_URL)")
    ap.add_argument("--key", default=os.environ.get("STUDY_KEY"), help="export key (or env STUDY_KEY)")
    ap.add_argument("--out", type=Path, default=Path("results"))
    ap.add_argument("--exclude", action="store_true", help="drop participants with any exclusion flag")
    ap.add_argument("--include-incomplete", action="store_true", help="keep sessions without a 'completed' row")
    ap.add_argument("--plots", action="store_true", help="save pre/post plots (needs matplotlib)")
    a = ap.parse_args()
    if not a.source and not a.url:
        ap.error("give a .xlsx/folder, or --url and --key")
    a.out.mkdir(parents=True, exist_ok=True)

    df = participant_table(load(a.source, a.url if not a.source else None, a.key), a.include_incomplete)
    df.to_csv(a.out / "participant_metrics.csv", index=False)
    flagged = df[df.exclusion_reasons != ""]
    print(f"\nParticipants: {len(df)}  (stroop {sum(df.task == 'stroop')}, taskswitch {sum(df.task == 'taskswitch')})")
    if len(flagged):
        print(f"Flagged ({'excluded' if a.exclude else 'kept — use --exclude to drop'}):")
        for _, r in flagged.iterrows():
            print(f"  {r.participant_id:<12} {r.task:<11} {r.exclusion_reasons}")
    if a.exclude:
        df = df[df.exclusion_reasons == ""]

    # Individual changes — the main thing to read while n is small.
    ind_cols = ["participant_id", "task", "delta_mean_rt", "delta_accuracy_all", "delta_n_missed",
                "delta_interference_neg_neu", "delta_switch_cost_rt", "vas_change"]
    ind = df.sort_values(["task", "completion_order"])[[c for c in ind_cols if c in df]]
    ind.to_csv(a.out / "individual_changes.csv", index=False)
    print("\nEach participant, post − pre (RT in s; vas_change in 0–100 points):")
    print(ind.round(3).to_string(index=False))
    small = [t for t, g in df.groupby("task") if len(g) < MIN_N_STATS]
    if small:
        print(f"\nNote: fewer than {MIN_N_STATS} participants for {', '.join(small)} — the group statistics below "
              "are descriptive only; look at direction and consistency of the individual changes.")

    # Running effects: dz recomputed as each participant is added (completion order).
    run = []
    for task, g in df.sort_values("completion_order").groupby("task"):
        for k in range(2, len(g) + 1):
            sub = g.iloc[:k]
            r = {"task": task, "n": k}
            for m in PRIMARY[task] + (["vas"] if "vas_change" in g else []):
                ch = (sub.vas_change if m == "vas" else sub[f"post_{m}"] - sub[f"pre_{m}"]).dropna().to_numpy() \
                    if (m == "vas" or f"pre_{m}" in sub) else np.array([])
                r[f"dz_{m}"] = dz(ch) if len(ch) > 1 else np.nan
            run.append(r)
    if run:
        pd.DataFrame(run).to_csv(a.out / "running_effects.csv", index=False)

    # Manipulation check
    rows = []
    for task, g in [("all", df)] + list(df.groupby("task")):
        if "vas_change" in g:
            s = change_stats(g.rename(columns={"vas_pre_mist": "pre_vas", "vas_post_mist": "post_vas"}), "vas")
            if s:
                rows.append({"task": task, **s})
    if rows:
        mc = pd.DataFrame(rows)
        mc.to_csv(a.out / "manipulation_check.csv", index=False)
        print("\nManipulation check — VAS stress composite (0–100), post − pre stressor:")
        print(mc[["task", "n", "pre_mean", "post_mean", "change_mean", "p_ttest", "dz"]].round(3).to_string(index=False))

    # Sensitivity per task
    res = []
    for task, g in df.groupby("task"):
        for m in COMMON + SPECIFIC[task]:
            s = change_stats(g, m)
            if s:
                res.append({"task": task, **s})
    sens = pd.DataFrame(res)
    sens.to_csv(a.out / "sensitivity.csv", index=False)
    cols = [c for c in ["task", "metric", "n", "pre_mean", "post_mean", "change_mean", "p_ttest", "dz",
                        "dz_ci_low", "dz_ci_high", "rho_with_vas_change"] if c in sens]
    print("\nSensitivity — change from pre- to post-stressor (positive dz = higher after stress):")
    print(sens[cols].round(3).to_string(index=False))

    # Head-to-head on common metrics: bootstrap CI of |dz_stroop| − |dz_switch|
    if df.task.nunique() == 2:
        h2h = []
        for m in COMMON:
            chs = {}
            for task, g in df.groupby("task"):
                x = g[[f"pre_{m}", f"post_{m}"]].apply(pd.to_numeric, errors="coerce").dropna()
                chs[task] = (x[f"post_{m}"] - x[f"pre_{m}"]).to_numpy()
            if min(len(v) for v in chs.values()) < MIN_N_STATS:
                continue
            diff = np.abs(boot_dz(chs["stroop"])) - np.abs(boot_dz(chs["taskswitch"]))
            h2h.append({
                "metric": m, "dz_stroop": dz(chs["stroop"]), "dz_taskswitch": dz(chs["taskswitch"]),
                "abs_dz_diff": abs(dz(chs["stroop"])) - abs(dz(chs["taskswitch"])),
                "diff_ci_low": np.nanpercentile(diff, 2.5), "diff_ci_high": np.nanpercentile(diff, 97.5),
            })
        if h2h:
            h = pd.DataFrame(h2h)
            h.to_csv(a.out / "head_to_head.csv", index=False)
            print("\nHead-to-head — |dz| Stroop minus |dz| Task switch (CI excluding 0 = one task clearly more sensitive):")
            print(h.round(3).to_string(index=False))

    if a.plots:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        for task, g in df.groupby("task"):
            metrics = [m for m in ["mean_rt", "accuracy_all"] + SPECIFIC[task] if f"pre_{m}" in g]
            fig, axes = plt.subplots(1, len(metrics), figsize=(3.2 * len(metrics), 3.4))
            for ax, m in zip(np.atleast_1d(axes), metrics):
                for _, r in g.iterrows():
                    ax.plot([0, 1], [r[f"pre_{m}"], r[f"post_{m}"]], color="0.75", lw=1)
                ax.plot([0, 1], [g[f"pre_{m}"].mean(), g[f"post_{m}"].mean()], color="C0", lw=2.5, marker="o")
                ax.set_xticks([0, 1], ["pre", "post"])
                ax.set_title(m, fontsize=10)
            fig.suptitle(f"{task} (n = {len(g)})")
            fig.tight_layout()
            fig.savefig(a.out / f"prepost_{task}.png", dpi=150)
            plt.close(fig)
        if run:
            rf = pd.DataFrame(run)
            fig, axes = plt.subplots(1, rf.task.nunique(), figsize=(5 * rf.task.nunique(), 3.4), squeeze=False)
            for ax, (task, g) in zip(axes[0], rf.groupby("task")):
                for c in [c for c in g if c.startswith("dz_")]:
                    ax.plot(g.n, g[c], marker="o", ms=3, label=c[3:])
                ax.axhline(0, color="0.6", lw=0.8)
                ax.set_xlabel("participants so far")
                ax.set_ylabel("dz (post − pre)")
                ax.set_title(task)
                ax.legend(fontsize=8)
            fig.tight_layout()
            fig.savefig(a.out / "running_effects.png", dpi=150)
            plt.close(fig)
        print(f"\nPlots saved to {a.out}/")
    print(f"\nTables saved to {a.out}/")


if __name__ == "__main__":
    main()
