# Bottle detection calibration

The scanner uses Google's pretrained EfficientDet-Lite0 object detector. A small
logistic model fitted on annotated Open Images predictions filters bottle
candidates using the detector score and the fraction of the frame covered by
the bounding box. The scanner runs in the browser and reports the bottle class
and count from a single image.

`open-images-manifest.json` records the selected photos, normalized bounding
boxes, authors, sources, and the 83 training / 22 test split. Photo files are
separate from the app. When reproducing the fit, place the images at their
listed filenames next to a copy of the manifest.

Install the optional training dependencies with Python 3.12, then run from the repository root:

```sh
python -m pip install -r training/requirements.txt
python training/fit_bottle_filter.py dist/vision/efficientdet-lite0.tflite \
  /path/to/open-images-manifest.json dist/vision/bottle-filter.json
```

The model matched 14 of 22 exact counts on the broader Open Images test split.
It matched 12 of 12 development photo counts and 8 of 8 on a fresh targeted
water-bottle and drinking-glass photo set using the deployed model and filter
settings in Python. Real camera performance depends on the device, lighting,
framing, and occlusion.
