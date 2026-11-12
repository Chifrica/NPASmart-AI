const OPENCV_URL = 'https://docs.opencv.org/4.x/opencv.js';
let cvPromise;

function getOpenCv() {
  if (cvPromise) return cvPromise;
  cvPromise = new Promise((resolve, reject) => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (window.cv?.Mat) {
        window.clearInterval(timer);
        resolve(window.cv);
      } else if (attempts >= 150) {
        window.clearInterval(timer);
        reject(new Error('Automatic page detection could not load. You can still crop the image manually.'));
      }
    }, 100);
    const script = document.querySelector('script[data-opencv]');
    if (script) script.addEventListener('error', () => {
      window.clearInterval(timer);
      reject(new Error('Automatic page detection could not load. You can still crop the image manually.'));
    }, { once: true });
    else {
      const loader = document.createElement('script');
      loader.src = OPENCV_URL;
      loader.async = true;
      loader.dataset.opencv = 'true';
      loader.onerror = () => {
        window.clearInterval(timer);
        reject(new Error('Automatic page detection could not load. You can still crop the image manually.'));
      };
      document.head.append(loader);
    }
  });
  return cvPromise;
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The image could not be opened for processing.'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The processed image could not be created.')), 'image/png');
  });
}

function otsuThreshold(pixels) {
  const histogram = new Uint32Array(256);
  for (let index = 0; index < pixels.length; index += 4) {
    const luminance = Math.round(pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114);
    histogram[luminance] += 1;
  }
  const total = pixels.length / 4;
  let sum = 0;
  for (let value = 0; value < 256; value += 1) sum += value * histogram[value];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 190;
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (sum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }
  return threshold;
}

function fallbackEnhance(image) {
  const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const threshold = otsuThreshold(imageData.data);
  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index];
    const green = imageData.data[index + 1];
    const blue = imageData.data[index + 2];
    const saturation = Math.max(red, green, blue) - Math.min(red, green, blue);
    if (saturation < 32) {
      const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
      const value = luminance > threshold ? 255 : 0;
      imageData.data[index] = value;
      imageData.data[index + 1] = value;
      imageData.data[index + 2] = value;
    }
    imageData.data[index + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas);
}

function findPageCorners(cv, image) {
  const source = cv.imread(image);
  const maxDimension = 1200;
  const scale = Math.min(1, maxDimension / Math.max(source.cols, source.rows));
  const working = new cv.Mat();
  cv.resize(source, working, new cv.Size(Math.round(source.cols * scale), Math.round(source.rows * scale)));
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let best = null;
  try {
    cv.cvtColor(working, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 50, 150);
    const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(edges, edges, kernel);
    kernel.delete();
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    let bestArea = 0;
    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      const perimeter = cv.arcLength(contour, true);
      const polygon = new cv.Mat();
      cv.approxPolyDP(contour, polygon, perimeter * 0.02, true);
      const area = cv.contourArea(polygon);
      if (polygon.rows === 4 && area > working.cols * working.rows * 0.18 && area > bestArea && cv.isContourConvex(polygon)) {
        bestArea = area;
        best = [];
        for (let point = 0; point < 4; point += 1) {
          best.push({
            x: polygon.data32S[point * 2] / scale,
            y: polygon.data32S[point * 2 + 1] / scale
          });
        }
      }
      polygon.delete();
      contour.delete();
    }
  } finally {
    source.delete();
    working.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
  }
  return best;
}

function orderCorners(points) {
  const sums = points.map((point) => point.x + point.y);
  const differences = points.map((point) => point.x - point.y);
  return [
    points[sums.indexOf(Math.min(...sums))],
    points[differences.indexOf(Math.max(...differences))],
    points[sums.indexOf(Math.max(...sums))],
    points[differences.indexOf(Math.min(...differences))]
  ];
}

function rectifyPage(cv, image, corners) {
  const source = cv.imread(image);
  const [topLeft, topRight, bottomRight, bottomLeft] = orderCorners(corners);
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const width = Math.min(2400, Math.round(Math.max(distance(topLeft, topRight), distance(bottomLeft, bottomRight))));
  const height = Math.min(3200, Math.round(Math.max(distance(topLeft, bottomLeft), distance(topRight, bottomRight))));
  if (width < 2 || height < 2) {
    source.delete();
    throw new Error('Could not determine the page dimensions.');
  }
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, [
    topLeft.x, topLeft.y, topRight.x, topRight.y, bottomRight.x, bottomRight.y, bottomLeft.x, bottomLeft.y
  ]);
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width - 1, 0, width - 1, height - 1, 0, height - 1]);
  const transform = cv.getPerspectiveTransform(from, to);
  const output = new cv.Mat();
  cv.warpPerspective(source, output, transform, new cv.Size(width, height), cv.INTER_CUBIC, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
  source.delete();
  from.delete();
  to.delete();
  transform.delete();
  return output;
}

function enhanceWithOpenCv(cv, source) {
  const gray = new cv.Mat();
  const rgb = new cv.Mat();
  const hsv = new cv.Mat();
  const saturation = new cv.Mat();
  const binary = new cv.Mat();
  const mask = new cv.Mat();
  const output = new cv.Mat();
  try {
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    const minDimension = Math.min(gray.rows, gray.cols);
    const blockSize = Math.min(31, minDimension % 2 ? minDimension : minDimension - 1);
    if (blockSize >= 3) cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, blockSize, 11);
    else cv.threshold(gray, binary, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
    cv.cvtColor(source, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    cv.extractChannel(hsv, saturation, 1);
    cv.threshold(saturation, mask, 32, 255, cv.THRESH_BINARY);
    cv.cvtColor(binary, output, cv.COLOR_GRAY2RGBA);
    source.copyTo(output, mask);
    return output;
  } catch (error) {
    output.delete();
    throw error;
  } finally {
    gray.delete();
    rgb.delete();
    hsv.delete();
    saturation.delete();
    binary.delete();
    mask.delete();
  }
}

export async function processDocumentImage(file) {
  const image = await loadImage(file);
  let source;
  let enhanced;
  try {
    const cv = await getOpenCv();
    const corners = findPageCorners(cv, image);
    source = corners ? rectifyPage(cv, image, corners) : cv.imread(image);
    if (!corners && Math.max(source.cols, source.rows) > 1800) {
      const resized = new cv.Mat();
      const scale = 1800 / Math.max(source.cols, source.rows);
      cv.resize(source, resized, new cv.Size(Math.round(source.cols * scale), Math.round(source.rows * scale)));
      source.delete();
      source = resized;
    }
    enhanced = enhanceWithOpenCv(cv, source);
    const canvas = document.createElement('canvas');
    cv.imshow(canvas, enhanced);
    return { blob: await canvasToBlob(canvas), autoCropped: Boolean(corners), warning: corners ? '' : 'Page edges were not detected. Use Adjust crop to remove the background manually.' };
  } catch (error) {
    if (error.message.includes('Automatic page detection could not load')) {
      return {
        blob: await fallbackEnhance(image),
        autoCropped: false,
        warning: 'Automatic page detection is unavailable. The image was enhanced; use Adjust crop to remove the background manually.'
      };
    }
    throw error;
  } finally {
    source?.delete();
    enhanced?.delete();
  }
}

export async function processFullFrameImage(file) {
  const image = await loadImage(file);
  let source;
  let resized;
  let enhanced;
  try {
    const cv = await getOpenCv();
    source = cv.imread(image);
    const scale = Math.min(1, 1800 / Math.max(source.cols, source.rows));
    resized = new cv.Mat();
    cv.resize(source, resized, new cv.Size(Math.round(source.cols * scale), Math.round(source.rows * scale)));
    source.delete();
    source = null;
    enhanced = enhanceWithOpenCv(cv, resized);
    const canvas = document.createElement('canvas');
    cv.imshow(canvas, enhanced);
    return await canvasToBlob(canvas);
  } catch (error) {
    if (error.message.includes('Automatic page detection could not load')) return fallbackEnhance(image);
    throw error;
  } finally {
    source?.delete();
    resized?.delete();
    enhanced?.delete();
  }
}

export async function cropImage(blob, rectangle) {
  const image = await loadImage(blob);
  const { x, y, width, height } = rectangle;
  if (width < 10 || height < 10) throw new Error('Select a larger crop area.');
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvasToBlob(canvas);
}
