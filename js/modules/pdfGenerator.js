function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('The original image could not be read.'));
    reader.readAsDataURL(blob);
  });
}

function getImageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('The selected image could not be decoded.'));
    image.src = dataUrl;
  });
}

/**
 * Embeds the original uploaded image as the only page content.
 * No crop, filter, OCR overlay, perspective correction or image enhancement is applied.
 */
export async function imageToPdf(imageBlob) {
  if (!window.jspdf?.jsPDF) throw new Error('The PDF library did not load. Check your internet connection and reload the page.');
  const dataUrl = await readAsDataUrl(imageBlob);
  const { width, height } = await getImageDimensions(dataUrl);
  const pageWidth = width * 0.75;
  const pageHeight = height * 0.75;
  const orientation = pageWidth > pageHeight ? 'landscape' : 'portrait';
  const pdf = new window.jspdf.jsPDF({ orientation, unit: 'pt', format: [pageWidth, pageHeight], compress: false });
  const format = imageBlob.type === 'image/png' ? 'PNG' : 'JPEG';
  pdf.addImage(dataUrl, format, 0, 0, pageWidth, pageHeight, undefined, 'NONE');
  return pdf.output('blob');
}
