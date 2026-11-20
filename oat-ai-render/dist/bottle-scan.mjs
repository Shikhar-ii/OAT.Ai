const vision = new URL('./vision/', import.meta.url);
let detectorJob;

function loadDetector() {
  if (!detectorJob) {
    detectorJob = Promise.all([
      import(new URL('vision_bundle.mjs', vision)),
      fetch(new URL('bottle-filter.json', vision)).then(response => {
        if (!response.ok) throw new Error('Could not load bottle calibration');
        return response.json();
      })
    ]).then(async ([{FilesetResolver, ObjectDetector}, filter]) => {
      const files = await FilesetResolver.forVisionTasks(new URL('wasm', vision).href);
      const detector = await ObjectDetector.createFromOptions(files, {
        baseOptions: {modelAssetPath: new URL('efficientdet-lite0.tflite', vision).href},
        runningMode: 'IMAGE',
        categoryAllowlist: ['bottle'],
        scoreThreshold: filter.candidateScore
      });
      return {detector,filter};
    }).catch(error => {
      detectorJob = undefined;
      throw error;
    });
  }
  return detectorJob;
}

export function filterDetections(detections, frame, filter, bounds, minimumScore = filter.minimumScore) {
  const {width,height} = frame;
  const [offsetX,offsetY,inputWidth,inputHeight] = bounds;
  const clamp = number => Math.min(1,Math.max(0,number));
  const matches = [];
  for (const {categories,boundingBox:box} of detections) {
    const score = categories.find(category => category.categoryName.toLowerCase() === 'bottle')?.score;
    if (score == null || score < minimumScore || !box) continue;
    const x1 = clamp((box.originX - offsetX) / inputWidth);
    const y1 = clamp((box.originY - offsetY) / inputHeight);
    const x2 = clamp((box.originX + box.width - offsetX) / inputWidth);
    const y2 = clamp((box.originY + box.height - offsetY) / inputHeight);
    const boxFraction = (x2-x1) * (y2-y1);
    if (boxFraction <= 0) continue;
    const scoreLogit = Math.log(Math.max(.001,score) / Math.max(.001,1-score));
    const decision = filter.intercept + filter.scoreWeight * scoreLogit + filter.areaWeight * Math.log(Math.max(.0001,boxFraction));
    if (decision < filter.decisionLogit) continue;
    matches.push({originX:x1*width,originY:y1*height,width:(x2-x1)*width,height:(y2-y1)*height});
  }
  return matches;
}

function overlap(first, second) {
  const width = Math.max(0, Math.min(first.originX+first.width,second.originX+second.width) - Math.max(first.originX,second.originX));
  const height = Math.max(0, Math.min(first.originY+first.height,second.originY+second.height) - Math.max(first.originY,second.originY));
  return width*height / (first.width*first.height + second.width*second.height - width*height);
}

function detectBottles(frame, detector, filter) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 320;
  const ratio = canvas.width / Math.max(frame.width,frame.height);
  const width = Math.round(frame.width * ratio);
  const height = Math.round(frame.height * ratio);
  const x = Math.floor((canvas.width - width) / 2);
  const y = Math.floor((canvas.height - height) / 2);
  const painter = canvas.getContext('2d');
  painter.fillStyle = 'rgb(115 118 115)';
  painter.fillRect(0,0,canvas.width,canvas.height);
  painter.drawImage(frame,x,y,width,height);
  const bounds = [x,y,width,height];
  const squareResults = detector.detect(canvas).detections;
  const matches = filterDetections(squareResults,frame,filter,bounds);
  if (matches.length) return matches;
  const native = filterDetections(detector.detect(frame).detections,frame,filter,[0,0,frame.width,frame.height]);
  if (native.length) return native;

  // Transparent bottles can disappear against a dark background.
  const pixels = painter.getImageData(x,y,width,height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    pixels.data[i] *= 1.22;
    pixels.data[i+1] *= 1.22;
    pixels.data[i+2] *= 1.22;
  }
  painter.putImageData(pixels,x,y);
  const brightResults = detector.detect(canvas).detections;
  const bright = filterDetections(brightResults,frame,filter,bounds);
  if (bright.length) return bright;

  // A weaker detection is usable when both exposures locate the same bottle.
  const squareWeak = filterDetections(squareResults,frame,filter,bounds,filter.agreementScore);
  const brightWeak = filterDetections(brightResults,frame,filter,bounds,filter.agreementScore);
  return squareWeak.length === 1 && brightWeak.length === 1 && overlap(squareWeak[0],brightWeak[0]) >= .5 ? squareWeak : [];
}

function drawFrame(canvas, source, width, height) {
  const scale = Math.min(1, 1024 / Math.max(width,height));
  canvas.width = Math.max(1,Math.round(width * scale));
  canvas.height = Math.max(1,Math.round(height * scale));
  canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);
}

function drawMatches(canvas, detections) {
  const painter = canvas.getContext('2d');
  painter.strokeStyle = '#53efb1';
  painter.lineWidth = Math.max(3,canvas.width / 190);
  for (const box of detections) {
    painter.strokeRect(box.originX,box.originY,box.width,box.height);
  }
}

function loadPhoto(file) {
  return new Promise((resolve,reject)=>{
    const image = new Image();
    const url = URL.createObjectURL(file);
    const release = () => URL.revokeObjectURL(url);
    image.onload = () => { release(); resolve(image); };
    image.onerror = () => { release(); reject(new Error('Unsupported image')); };
    image.src = url;
  });
}

export function mountBottleScanner(root, signal, saveCount) {
  const $ = selector => root.querySelector(selector);
  const video = $('video');
  const canvas = $('canvas');
  const notice = $('.scan-status');
  const placeholder = $('.scanner-placeholder');
  const frame = $('.scanner-frame');
  const result = $('.scan-result');
  const capture = $('#capture-bottle');
  const input = $('#bottle-photo');
  const retry = $('#retry-bottle');
  const save = $('#save-bottle');
  let stream;
  let attempt = 0;
  let detectedCount = 0;
  let busy = false;

  // Warm the detector while the user positions the bottle.
  loadDetector().catch(()=>{});

  function stopCamera() {
    stream?.getTracks().forEach(track=>track.stop());
    stream = undefined;
    video.pause();
    video.srcObject = null;
  }

  function clearResult() {
    detectedCount = 0;
    result.hidden = true;
    save.hidden = true;
    canvas.hidden = true;
  }

  async function startCamera() {
    stopCamera();
    const current = ++attempt;
    busy = false;
    clearResult();
    capture.hidden = false;
    capture.disabled = true;
    input.disabled = false;
    retry.hidden = true;
    video.hidden = true;
    placeholder.hidden = false;
    frame.hidden = false;
    notice.textContent = 'Starting camera…';
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable');
      const candidate = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}},audio:false});
      if (signal.aborted || current !== attempt) {
        candidate.getTracks().forEach(track=>track.stop());
        return;
      }
      stream = candidate;
      video.srcObject = stream;
      await video.play();
      if (signal.aborted || current !== attempt) return;
      video.hidden = false;
      placeholder.hidden = true;
      capture.disabled = false;
      notice.textContent = 'Ready to scan';
    } catch {
      if (signal.aborted || current !== attempt) return;
      stopCamera();
      notice.textContent = 'Camera unavailable. Upload a photo or try the camera again.';
      capture.hidden = true;
      retry.textContent = 'Try camera';
      retry.hidden = false;
    }
  }

  async function analyze(source, width, height, current) {
    drawFrame(canvas, source, width, height);
    stopCamera();
    video.hidden = true;
    canvas.hidden = false;
    placeholder.hidden = true;
    frame.hidden = true;
    notice.textContent = 'Looking for bottles…';
    const {detector,filter} = await loadDetector();
    // Allow the preview and analysis status to paint before synchronous inference.
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    if (signal.aborted || current !== attempt) return;
    const matches = detectBottles(canvas,detector,filter);
    detectedCount = matches.length;
    drawMatches(canvas,matches);
    if (detectedCount) {
      $('#bottle-quantity').textContent = detectedCount;
      result.hidden = false;
      save.hidden = false;
      notice.textContent = detectedCount === 1 ? '1 bottle detected' : detectedCount + ' bottles detected';
    } else {
      notice.textContent = 'No bottle detected. Try a clearer photo with the full bottle in view.';
    }
    busy = false;
    input.disabled = false;
    retry.textContent = 'Scan again';
    retry.hidden = false;
  }

  function beginScan() {
    const current = ++attempt;
    busy = true;
    clearResult();
    capture.hidden = true;
    input.disabled = true;
    retry.hidden = true;
    return current;
  }

  function showError(current, message) {
    if (signal.aborted || current !== attempt) return;
    stopCamera();
    video.hidden = true;
    if (canvas.hidden) placeholder.hidden = false;
    busy = false;
    input.disabled = false;
    retry.textContent = 'Scan again';
    retry.hidden = false;
    notice.textContent = message;
  }

  capture.addEventListener('click', async () => {
    if (busy || signal.aborted) return;
    if (!video.videoWidth) {
      notice.textContent = 'The camera is still getting ready. Try again in a moment.';
      return;
    }
    const current = beginScan();
    try {
      await analyze(video,video.videoWidth,video.videoHeight,current);
    } catch {
      showError(current,'Could not complete the scan. Try again.');
    }
  });

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file || busy || signal.aborted) return;
    const current = beginScan();
    stopCamera();
    video.hidden = true;
    placeholder.hidden = false;
    notice.textContent = 'Opening photo…';
    let photo;
    try {
      photo = await loadPhoto(file);
    } catch {
      showError(current,'Could not open this photo. Try a JPG or PNG.');
      return;
    }
    if (signal.aborted || current !== attempt) return;
    try {
      await analyze(photo,photo.naturalWidth,photo.naturalHeight,current);
    } catch {
      showError(current,'Could not complete the scan. Try again.');
    }
  });

  retry.addEventListener('click',startCamera);
  save.addEventListener('click',()=>{
    if (detectedCount < 1 || signal.aborted) return;
    save.disabled = true;
    saveCount(detectedCount);
  });
  signal.addEventListener('abort',stopCamera,{once:true});

  startCamera();
}
