import { APP_CONFIG } from '../config.js';

export function validateImageFile(file) {
  if (!file) return { valid: false, reason: 'No file was selected.' };
  if (!APP_CONFIG.acceptedMimeTypes.includes(file.type)) {
    return { valid: false, reason: `${file.name}: only JPG, JPEG and PNG images are supported.` };
  }
  if (file.size > APP_CONFIG.maxImageBytes) {
    return { valid: false, reason: `${file.name}: file exceeds the 10 MB maximum.` };
  }
  return {
    valid: true,
    warning: file.size > APP_CONFIG.recommendedImageBytes
      ? `${file.name} is larger than the recommended 2.5 MB. It is still allowed.`
      : null
  };
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
