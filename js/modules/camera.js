export async function startCamera(videoElement) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is unavailable. Open this app on HTTPS or localhost using a supported browser.');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  videoElement.srcObject = stream;
  await videoElement.play();
  return stream;
}

export function stopCamera(stream, videoElement) {
  stream?.getTracks().forEach((track) => track.stop());
  if (videoElement) videoElement.srcObject = null;
}

export function captureFrame(videoElement) {
  if (!videoElement.videoWidth || !videoElement.videoHeight) throw new Error('Camera is not ready yet.');
  const canvas = document.createElement('canvas');
  canvas.width = videoElement.videoWidth;
  canvas.height = videoElement.videoHeight;
  const context = canvas.getContext('2d', { alpha: false });
  context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(new File([blob], `camera-capture-${Date.now()}.jpg`, { type: 'image/jpeg' })) : reject(new Error('Could not capture image.')), 'image/jpeg', 0.96));
}
