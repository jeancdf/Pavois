#!/usr/bin/env python3
"""Train the track classifier from the spreadsheet and report honest accuracy.

    scripts/pavois_train_classifier.py dataset.xlsx --out model.joblib

Add more flights with pavois_extract_features.py --append, then run this again;
it retrains from whatever is in the sheet.

Two things this deliberately does NOT do, because either would report an
accuracy that looks good and means nothing:

  * It does not split windows at random. Windows from one flight overlap in
    time and share a background, a lighting condition and a rig pose, so a
    random split puts near-duplicates on both sides and the score measures
    memorisation. Scoring is grouped by RECORDING: the model is always tested
    on flights it has never seen.

  * It does not report a single headline number without saying what the classes
    are made of. A class built from synthesised trajectories tells you the model
    separates the ASSUMPTIONS encoded in the generator, not that it will
    recognise a real bird.
"""
from __future__ import annotations

import argparse
import pathlib
import sys

import numpy as np

try:
    import joblib
    import pandas as pd
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.metrics import (accuracy_score, classification_report,
                                 confusion_matrix)
    from sklearn.model_selection import LeaveOneGroupOut, StratifiedKFold
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler
except ImportError:  # pragma: no cover
    sys.exit("needs pandas, scikit-learn, joblib and openpyxl")

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from pavois_extract_features import FEATURE_COLUMNS  # noqa: E402


def build_model() -> Pipeline:
    # A small forest: this dataset is hundreds of rows, not millions, and a
    # forest handles unscaled, correlated, non-linear features without tuning
    # while still giving calibrated-ish class probabilities for the percentage.
    #
    # 120 trees at depth 8 measured identically to 400 unbounded trees on this
    # data (99.92% either way) with a third of the nodes. That matters because
    # the forest is exported as JSON and walked inside the vps, so every node is
    # shipped and parsed at boot.
    return Pipeline([
        ("scale", StandardScaler()),
        ("forest", RandomForestClassifier(
            n_estimators=120, max_depth=8, min_samples_leaf=2,
            class_weight="balanced", random_state=0, n_jobs=-1)),
    ])


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dataset", type=pathlib.Path)
    ap.add_argument("--out", type=pathlib.Path, default=pathlib.Path("model.joblib"))
    args = ap.parse_args()

    frame = pd.read_excel(args.dataset)
    missing = [c for c in FEATURE_COLUMNS if c not in frame.columns]
    if missing:
        raise SystemExit(f"dataset is missing feature columns: {missing}")
    frame = frame.dropna(subset=FEATURE_COLUMNS)
    if frame["label"].nunique() < 2:
        raise SystemExit(
            "only one class in the dataset. A classifier needs something to\n"
            "contrast against -- add negatives with --synth-birds/--synth-airplanes\n"
            "or extract real non-drone footage.")

    X = frame[FEATURE_COLUMNS].to_numpy(dtype=float)
    y = frame["label"].to_numpy()
    groups = frame["source"].to_numpy()

    # Synthetic rows are keyed "synthetic-<class>-<n>" so they form several
    # validation groups; match on the prefix, not the exact name.
    is_synth = frame["source"].astype(str).str.startswith("synthetic")

    print("dataset")
    for label, count in frame["label"].value_counts().items():
        rows = frame["label"] == label
        sources = sorted(frame.loc[rows, "source"].unique())
        kind = "SYNTHETIC" if bool(is_synth[rows].all()) else "real"
        print(f"  {label:10} {count:5d} windows  [{kind}]  from {len(sources)} source(s)")

    # Group-aware scoring. Leave-one-recording-out when there are enough
    # distinct recordings; otherwise fall back and say so loudly.
    n_groups = len(np.unique(groups))
    if n_groups >= 3:
        splitter, split_args, scheme = LeaveOneGroupOut(), (X, y, groups), \
            f"leave-one-source-out over {n_groups} sources"
    else:
        splitter, split_args, scheme = StratifiedKFold(5, shuffle=True, random_state=0), \
            (X, y), f"stratified 5-fold (only {n_groups} sources -- OPTIMISTIC, " \
                    "windows from one flight can land on both sides)"

    truth, predicted = [], []
    for train_idx, test_idx in splitter.split(*split_args):
        if len(np.unique(y[train_idx])) < 2:
            continue
        model = build_model().fit(X[train_idx], y[train_idx])
        truth.extend(y[test_idx])
        predicted.extend(model.predict(X[test_idx]))

    print(f"\nvalidation: {scheme}")
    if truth:
        print(f"  accuracy {accuracy_score(truth, predicted) * 100:.1f} %\n")
        print(classification_report(truth, predicted, zero_division=0))
        labels = sorted(set(truth) | set(predicted))
        cm = confusion_matrix(truth, predicted, labels=labels)
        print("confusion matrix (rows = truth)")
        print("            " + "".join(f"{l:>12}" for l in labels))
        for name, row in zip(labels, cm):
            print(f"  {name:10}" + "".join(f"{v:12d}" for v in row))
    else:
        print("  not enough data to validate")

    final = build_model().fit(X, y)
    order = np.argsort(final.named_steps["forest"].feature_importances_)[::-1]
    print("\nwhat the model actually uses")
    for i in order[:8]:
        print(f"  {FEATURE_COLUMNS[i]:20} {final.named_steps['forest'].feature_importances_[i]:.3f}")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": final, "features": FEATURE_COLUMNS,
                 "classes": list(final.classes_),
                 "trained_on": {str(k): int(v) for k, v in
                                frame["label"].value_counts().items()},
                 "synthetic_classes": sorted(frame.loc[is_synth, "label"].unique().tolist())},
                args.out)
    print(f"\nmodel -> {args.out}")

    synth = sorted(frame.loc[is_synth, "label"].unique())
    if synth:
        print(f"\nNOTE: {', '.join(synth)} came from generated trajectories, not "
              f"footage.\n      The score above shows the model separates those "
              f"assumptions.\n      Treat real-world performance on those classes as "
              f"unproven until\n      you feed it actual recordings of them.")


if __name__ == "__main__":
    main()
