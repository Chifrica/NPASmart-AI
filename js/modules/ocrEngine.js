let workerPromise;

async function getWorker(onProgress = () => {}) {
  if (!window.Tesseract) throw new Error('OCR library did not load. Check your internet connection and reload the page.');
  if (!workerPromise) {
    workerPromise = window.Tesseract.createWorker('eng', 1, {
      logger: (message) => {
        if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
          onProgress(Math.round(message.progress * 100));
        }
      }
    });
  }
  return workerPromise;
}

export async function recognizeDocument(file, onProgress = () => {}) {
  const worker = await getWorker(onProgress);
  const result = await worker.recognize(file);
  const text = result?.data?.text || '';
  const confidence = Number(result?.data?.confidence || 0);
  return { text, confidence };
}

export async function terminateOcrWorker() {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } finally {
    workerPromise = null;
  }
}
