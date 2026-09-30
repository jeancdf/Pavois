#!/usr/bin/env python3
"""Export the trained classifier as plain JSON the vps can evaluate.

    scripts/pavois_export_model.py model.joblib --out vps/src/fusion-model.data.json

The vps runs in a hardened, read-only container. Rather than add a native
runtime (onnxruntime) or a second service just to score a few hundred numbers a
second, the forest is written out as arrays and walked by a small TypeScript
function. No native dependency, nothing to keep alive, and the exact same
arithmetic on every machine.

The export also carries a handful of reference vectors with the predictions
scikit-learn produced for them, so the TypeScript side can assert it agrees
with Python instead of hoping.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

import numpy as np

try:
    import joblib
    import pandas as pd
except ImportError:  # pragma: no cover
    sys.exit("needs joblib, pandas, scikit-learn")


def export_tree(tree) -> dict:
    """Flatten one decision tree. -1 in children_left marks a leaf."""
    t = tree.tree_
    # value is (n_nodes, 1, n_classes) counts; store normalised leaf distributions
    values = t.value.reshape(t.node_count, -1)
    totals = values.sum(axis=1, keepdims=True)
    totals[totals == 0] = 1.0
    return {
        "feature": t.feature.astype(int).tolist(),
        "threshold": [round(float(v), 7) for v in t.threshold],
        "left": t.children_left.astype(int).tolist(),
        "right": t.children_right.astype(int).tolist(),
        "value": [[round(float(p), 6) for p in row] for row in (values / totals)],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("model", type=pathlib.Path)
    ap.add_argument("--out", type=pathlib.Path, required=True)
    ap.add_argument("--dataset", type=pathlib.Path,
                    help="spreadsheet to draw reference vectors from")
    ap.add_argument("--reference", type=int, default=12)
    args = ap.parse_args()

    bundle = joblib.load(args.model)
    pipeline = bundle["model"]
    scaler = pipeline.named_steps["scale"]
    forest = pipeline.named_steps["forest"]

    payload = {
        "format": "pavois-forest-1",
        "features": bundle["features"],
        "classes": [str(c) for c in forest.classes_],
        "synthetic_classes": bundle.get("synthetic_classes", []),
        "trained_on": bundle.get("trained_on", {}),
        "scaler": {
            "mean": [round(float(v), 8) for v in scaler.mean_],
            "scale": [round(float(v), 8) for v in scaler.scale_],
        },
        "trees": [export_tree(est) for est in forest.estimators_],
        "reference": [],
    }

    if args.dataset and args.dataset.exists():
        frame = pd.read_excel(args.dataset).dropna(subset=bundle["features"])
        # spread the reference vectors across the classes actually present
        picks = []
        for label in frame["label"].unique():
            rows = frame.index[frame["label"] == label][: max(1, args.reference // max(1, frame["label"].nunique()))]
            picks.extend(rows.tolist())
        sample = frame.loc[picks[: args.reference]]
        X = sample[bundle["features"]].to_numpy(dtype=float)
        proba = pipeline.predict_proba(X)
        pred = pipeline.predict(X)
        for row, p, c in zip(X, proba, pred):
            payload["reference"].append({
                "features": [round(float(v), 8) for v in row],
                "expect": str(c),
                "proba": [round(float(v), 6) for v in p],
            })

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, separators=(",", ":")))
    size_kb = args.out.stat().st_size / 1024
    print(f"{len(payload['trees'])} trees, {len(payload['features'])} features, "
          f"{len(payload['classes'])} classes")
    print(f"{len(payload['reference'])} reference vectors")
    print(f"{args.out}  ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
