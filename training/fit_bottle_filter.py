"""Fit a bottle candidate filter on annotated photos, then check held-out counts."""

import argparse
import json
from pathlib import Path

import mediapipe as mp
import numpy as np
from PIL import Image, ImageEnhance, ImageOps


CANDIDATE_SCORE = 0.12
MINIMUM_SCORE = 0.32
AGREEMENT_SCORE = 0.25
DECISION_LOGIT = float(np.log(0.2 / 0.8))
MODEL_SIZE = 320
FRAME_SIZE = 1024
MIN_IOU = 0.3
VIEWS = ("square", "native", "bright")


def load_frame(path):
    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.thumbnail((FRAME_SIZE, FRAME_SIZE), Image.Resampling.BILINEAR)
        return image


def letterbox(frame):
    width, height = frame.size
    ratio = MODEL_SIZE / max(width, height)
    size = (round(width * ratio), round(height * ratio))
    x, y = (MODEL_SIZE - size[0]) // 2, (MODEL_SIZE - size[1]) // 2
    image = Image.new("RGB", (MODEL_SIZE, MODEL_SIZE), (115, 118, 115))
    image.paste(frame.resize(size, Image.Resampling.BILINEAR), (x, y))
    return image, (x, y, *size)


def candidates(detector, image, bounds):
    x0, y0, width, height = bounds
    source = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.array(image))
    output = []
    for detection in detector.detect(source).detections:
        box = detection.bounding_box
        x1 = max(0, min(1, (box.origin_x - x0) / width))
        y1 = max(0, min(1, (box.origin_y - y0) / height))
        x2 = max(0, min(1, (box.origin_x + box.width - x0) / width))
        y2 = max(0, min(1, (box.origin_y + box.height - y0) / height))
        if x2 > x1 and y2 > y1:
            output.append((detection.categories[0].score, (x1, y1, x2 - x1, y2 - y1)))
    return output


def load_samples(manifest_path, detector):
    manifest = json.loads(manifest_path.read_text())
    for sample in manifest:
        frame = load_frame(manifest_path.parent / sample["filename"])
        adjusted, bounds = letterbox(frame)
        bright = adjusted.copy()
        x, y, width, height = bounds
        area = adjusted.crop((x, y, x + width, y + height))
        bright.paste(ImageEnhance.Brightness(area).enhance(1.22), (x, y))
        yield {
            **sample,
            "square": candidates(detector, adjusted, bounds),
            "native": candidates(detector, frame, (0, 0, *frame.size)),
            "bright": candidates(detector, bright, bounds),
        }


def iou(first, second):
    x1, y1, w1, h1 = first
    x2, y2, w2, h2 = second
    overlap = (
        max(0, min(x1 + w1, x2 + w2) - max(x1, x2))
        * max(0, min(y1 + h1, y2 + h2) - max(y1, y2))
    )
    return overlap / (w1 * h1 + w2 * h2 - overlap)


def feature(candidate):
    score, (_, _, width, height) = candidate
    return [1, np.log(max(0.001, score) / max(0.001, 1 - score)),
            np.log(max(0.0001, width * height))]


def fit(samples):
    rows = [(feature(candidate), any(iou(candidate[1], box) >= MIN_IOU for box in sample["boxes"]))
            for sample in samples for view in VIEWS for candidate in sample[view]]
    matrix = np.array([row[0] for row in rows])
    labels = np.array([row[1] for row in rows], dtype=float)
    center = np.array([0, *matrix[:, 1:].mean(axis=0)])
    scale = np.array([1, *matrix[:, 1:].std(axis=0)])
    normalized = (matrix - center) / scale
    weights = np.zeros(matrix.shape[1])
    for _ in range(1600):
        prediction = 1 / (1 + np.exp(-np.clip(normalized @ weights, -30, 30)))
        regularization = 0.015 * weights
        regularization[0] = 0
        weights -= 0.18 * ((normalized.T @ (prediction - labels)) / labels.size + regularization)
    weights /= scale
    weights[0] -= weights @ center
    return weights


def count(sample, weights, cutoff):
    def matches(view, minimum_score):
        return [box for score, box in sample[view]
                if score >= minimum_score and np.dot(weights, feature((score, box))) >= cutoff]

    for view in VIEWS:
        strong = matches(view, MINIMUM_SCORE)
        if strong:
            return len(strong)
    square, bright = (matches(view, AGREEMENT_SCORE) for view in ("square", "bright"))
    return int(len(square) == len(bright) == 1 and iou(square[0], bright[0]) >= 0.5)


def evaluate(name, samples, weights, cutoff):
    print(name)
    for sample in samples:
        actual = count(sample, weights, cutoff)
        if name == "Water photo fixtures" or actual != sample["expected_count"]:
            print(f'  {sample["filename"]}: {actual}/{sample["expected_count"]}')
    correct = sum(count(sample, weights, cutoff) == sample["expected_count"] for sample in samples)
    print(f"  Exact counts: {correct}/{len(samples)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", type=Path)
    parser.add_argument("annotations", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--fixtures", type=Path)
    args = parser.parse_args()
    options = mp.tasks.vision.ObjectDetectorOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(args.model)),
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
        category_allowlist=["bottle"],
        score_threshold=CANDIDATE_SCORE,
    )
    with mp.tasks.vision.ObjectDetector.create_from_options(options) as detector:
        samples = list(load_samples(args.annotations, detector))
        training = [sample for sample in samples if sample["split"] == "train"]
        test = [sample for sample in samples if sample["split"] == "test"]
        weights = fit(training)
        cutoff = DECISION_LOGIT
        output = {
            "candidateScore": AGREEMENT_SCORE,
            "minimumScore": MINIMUM_SCORE,
            "agreementScore": AGREEMENT_SCORE,
            "intercept": round(float(weights[0]), 8),
            "scoreWeight": round(float(weights[1]), 8),
            "areaWeight": round(float(weights[2]), 8),
            "decisionLogit": round(cutoff, 8),
        }
        args.output.write_text(json.dumps(output, indent=2) + "\n")
        print(json.dumps(output))
        evaluate("Training", training, weights, cutoff)
        evaluate("Held-out calibration photos", test, weights, cutoff)
        if args.fixtures:
            evaluate("Water photo fixtures", list(load_samples(args.fixtures, detector)), weights, cutoff)


if __name__ == "__main__":
    main()
