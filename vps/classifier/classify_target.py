#!/usr/bin/env python3
"""Classify the three one-shot grayscale views with OpenCV.

The built-in model is deliberately conservative: OpenCV HOG/face detectors
veto people, then a sharp motion ROI is accepted as a drone candidate. The VPS
performs the final strict 2/3 vote. A dedicated drone ONNX model can replace
this backend later without changing the Pi capture protocol.
"""

import base64
import json
import sys

import cv2
import numpy as np


def finite_number(value):
    return isinstance(value, (int, float)) and np.isfinite(value)


def decode_jpeg(encoded):
    try:
        raw = base64.b64decode(encoded, validate=True)
        return cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    except (ValueError, TypeError):
        return None


def resized_for_people(gray):
    if gray.shape[1] <= 960:
        return gray, 1.0
    scale = 960.0 / gray.shape[1]
    return (
        cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA),
        scale,
    )


def valid_roi(view, gray):
    values = [view.get(key) for key in ("x0", "y0", "x1", "y1")]
    if not all(finite_number(value) for value in values):
        return None
    height, width = gray.shape[:2]
    x0, y0, x1, y1 = (int(value) for value in values)
    if x1 <= x0 or y1 <= y0:
        return None
    tight_x0 = max(0, min(width - 1, x0))
    tight_y0 = max(0, min(height - 1, y0))
    tight_x1 = max(0, min(width - 1, x1))
    tight_y1 = max(0, min(height - 1, y1))
    pad = max(12, int(max(x1 - x0, y1 - y0) * 0.4))
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(width - 1, x1 + pad)
    y1 = min(height - 1, y1 + pad)
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None
    box = {
        "x": tight_x0,
        "y": tight_y0,
        "width": max(1, tight_x1 - tight_x0 + 1),
        "height": max(1, tight_y1 - tight_y0 + 1),
    }
    return gray[y0 : y1 + 1, x0 : x1 + 1], box


def make_vote(camera_id, label, confidence, reason, gray=None, boxes=None):
    height, width = gray.shape[:2] if gray is not None else (0, 0)
    return {
        "cameraId": camera_id,
        "label": label,
        "confidence": float(confidence),
        "reason": reason,
        "imageWidth": int(width),
        "imageHeight": int(height),
        "boxes": boxes or [],
    }


def build_face_detector():
    try:
        path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        detector = cv2.CascadeClassifier(path)
        return None if detector.empty() else detector
    except (AttributeError, cv2.error):
        return None


def classify_view(view, hog, face_detector):
    camera_id = str(view.get("cameraId", ""))
    gray = decode_jpeg(view.get("jpegBase64", ""))
    if gray is None or gray.size == 0:
        return make_vote(camera_id, "unknown", 0.0, "jpeg_invalid")

    people_image, people_scale = resized_for_people(gray)
    people, weights = hog.detectMultiScale(
        people_image, winStride=(8, 8), padding=(16, 16), scale=1.05
    )
    if len(people):
        boxes = []
        confidences = []
        for index, (x, y, width, height) in enumerate(people):
            weight = float(weights[index]) if index < len(weights) else 0.0
            confidence = float(np.clip(0.72 + 0.08 * weight, 0.72, 0.98))
            confidences.append(confidence)
            boxes.append({
                "label": "human",
                "confidence": confidence,
                "x": int(round(x / people_scale)),
                "y": int(round(y / people_scale)),
                "width": int(round(width / people_scale)),
                "height": int(round(height / people_scale)),
            })
        return make_vote(
            camera_id, "human", max(confidences), "hog_person", gray, boxes
        )

    if face_detector is not None:
        faces = face_detector.detectMultiScale(
            people_image, scaleFactor=1.1, minNeighbors=5, minSize=(32, 32)
        )
        if len(faces):
            boxes = [{
                "label": "human",
                "confidence": 0.78,
                "x": int(round(x / people_scale)),
                "y": int(round(y / people_scale)),
                "width": int(round(width / people_scale)),
                "height": int(round(height / people_scale)),
            } for x, y, width, height in faces]
            return make_vote(camera_id, "human", 0.78, "face", gray, boxes)

    roi_result = valid_roi(view, gray)
    if roi_result is None:
        return make_vote(camera_id, "unknown", 0.0, "motion_roi_missing", gray)
    roi, motion_box = roi_result
    contrast = float(np.std(roi))
    focus = float(cv2.Laplacian(roi, cv2.CV_64F).var())
    if contrast < 6.0 or focus < 4.0:
        motion_box.update({"label": "unknown", "confidence": 0.25})
        return make_vote(
            camera_id, "unknown", 0.25, "motion_roi_blurry", gray, [motion_box]
        )
    confidence = float(np.clip(0.52 + contrast / 180.0 + focus / 3000.0, 0.52, 0.82))
    motion_box.update({"label": "drone", "confidence": confidence})
    return make_vote(
        camera_id, "drone", confidence, "non_human_sharp_motion", gray,
        [motion_box]
    )


def main():
    payload = json.load(sys.stdin)
    views = payload.get("views", [])
    hog = cv2.HOGDescriptor()
    hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
    face_detector = build_face_detector()
    votes = [classify_view(view, hog, face_detector) for view in views]
    json.dump({"votes": votes}, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
