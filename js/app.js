import { signIn, isSignedIn, signOut } from './auth.js';
import { validateImageFile, formatBytes } from './modules/fileValidator.js';
import { recognizeDocument } from './modules/ocrEngine.js';
import { extractReferenceNumber, extractTitle } from './modules/titleExtractor.js';
import { extractDate } from './modules/dateExtractor.js';
import { imageToPdf } from './modules/pdfGenerator.js';
import { getAllFolders, saveDocument, saveFolder } from './modules/database.js';
import { getDateFolderPath } from './modules/fileOrganizer.js';
import { renderDashboard, renderLibrary, handleDocumentAction } from './modules/documentManager.js';
import { sanitizeFileName, makeId, formatDisplayDate } from './utils/fileName.js';
import { startCamera, stopCamera, captureFrame } from './modules/camera.js';
import { cropImage, processDocumentImage, processFullFrameImage } from './modules/imageProcessor.js';

const $ = (selector) => document.querySelector(selector);
const state = { selectedFiles: [], queue: [], pendingFile: null, processedImageBlob: null, imageProcessingWarning: '', cameraStream: null, reviewImageUrl: null, previewUrl: null, activeView: 'dashboard', saving: false, cropSelection: null, cropStart: null, cropScaleX: 1, cropScaleY: 1 };

function showToast(message, type = '') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  $('#toastRegion').append(toast);
  window.setTimeout(() => toast.remove(), 3800);
}

function setLoginVisibility() {
  $('#loginScreen').classList.toggle('hidden', isSignedIn());
  $('#application').classList.toggle('hidden', !isSignedIn());
  if (isSignedIn()) refreshViews();
}

async function refreshViews() {
  try { await populateFolderOptions(); await renderDashboard(); await renderLibrary(); }
  catch (error) { showToast(error.message || 'Could not load local documents.', 'error'); }
}

function switchView(view) {
  state.activeView = view;
  $('#dashboardView').classList.toggle('hidden', view !== 'dashboard');
  $('#documentsView').classList.toggle('hidden', view !== 'documents');
  $('#pageName').textContent = view === 'dashboard' ? 'Overview' : 'All documents';
  document.querySelectorAll('.nav-link').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $('#sidebar').classList.remove('open');
  if (view === 'documents') renderLibrary();
}

function addFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const accepted = [];
  for (const file of files) {
    const result = validateImageFile(file);
    if (!result.valid) { showToast(result.reason, 'error'); continue; }
    if (result.warning) showToast(result.warning);
    accepted.push(file);
  }
  state.selectedFiles.push(...accepted);
  if (state.selectedFiles.length) {
    const count = state.selectedFiles.length;
    const total = state.selectedFiles.reduce((sum, file) => sum + file.size, 0);
    $('#selectionNotice').textContent = `${count} image${count === 1 ? '' : 's'} selected · ${formatBytes(total)} total. Each image will become its own PDF.`;
    $('#selectionNotice').classList.remove('hidden');
    $('#processButton').classList.remove('hidden');
  }
  $('#fileInput').value = '';
}

function clearSelection() {
  state.selectedFiles = [];
  $('#selectionNotice').classList.add('hidden');
  $('#processButton').classList.add('hidden');
}

async function beginProcessing() {
  if (!state.selectedFiles.length) return;
  state.queue = [...state.selectedFiles];
  clearSelection();
  await processNextFile();
}

async function processNextFile() {
  if (!state.queue.length) {
    state.pendingFile = null;
    $('#reviewModal').classList.add('hidden');
    await refreshViews();
    showToast('Selected images have been processed.', 'success');
    return;
  }
  const file = state.queue.shift();
  state.pendingFile = file;
  state.processedImageBlob = null;
  state.imageProcessingWarning = '';
  state.cropSelection = null;
  if (state.reviewImageUrl) URL.revokeObjectURL(state.reviewImageUrl);
  $('#reviewImage').src = '';
  $('#reviewTitle').textContent = 'Review document details';
  $('#documentTitle').value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  $('#documentReference').value = '';
  $('#documentDate').value = '';
  $('#dateHelp').textContent = 'OCR will suggest the date if found. Enter the date printed on the document before saving.';
  $('#cropEditor').classList.add('hidden');
  $('#adjustCropButton').disabled = true;
  $('#adjustCropButton').textContent = 'Adjust crop';
  await populateFolderOptions();
  $('#recognizedText').value = '';
  $('#ocrStatus').className = 'ocr-status';
  $('#ocrStatus').textContent = 'Cleaning page and reading document text…';
  $('#saveDocumentButton').disabled = true;
  $('#skipReviewButton').disabled = false;
  $('#restoreImageButton').disabled = true;
  $('#reviewModal').classList.remove('hidden');
  const recognitionPromise = recognizeDocument(file, (progress) => { $('#ocrStatus').textContent = `Recognizing text… ${progress}%`; })
    .then((result) => ({ result }), (error) => ({ error }));
  try {
    const processed = await processDocumentImage(file);
    state.processedImageBlob = processed.blob;
    state.imageProcessingWarning = processed.warning;
    state.reviewImageUrl = URL.createObjectURL(processed.blob);
    $('#reviewImage').src = state.reviewImageUrl;
    if (processed.warning) {
      $('#ocrStatus').className = 'ocr-status warning';
      $('#ocrStatus').textContent = processed.warning;
    } else {
      $('#ocrStatus').textContent = 'Page detected and cleaned. Reading document text…';
    }
  } catch (error) {
    state.processedImageBlob = file;
    state.imageProcessingWarning = error.message;
    state.reviewImageUrl = URL.createObjectURL(file);
    $('#reviewImage').src = state.reviewImageUrl;
    $('#ocrStatus').className = 'ocr-status warning';
    $('#ocrStatus').textContent = `Image cleanup unavailable: ${error.message} The original image will be used.`;
    showToast(`Image cleanup unavailable: ${error.message}`, 'error');
  }
  $('#adjustCropButton').disabled = false;
  $('#restoreImageButton').disabled = false;
  try {
    const recognition = await recognitionPromise;
    if (recognition.error) throw recognition.error;
    const result = recognition.result;
    const title = extractTitle(result.text, file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
    const date = extractDate(result.text);
    const reference = extractReferenceNumber(result.text);
    $('#documentTitle').value = title;
    $('#documentReference').value = reference;
    $('#recognizedText').value = result.text.trim() || 'No readable text was detected.';
    if (date) {
      $('#documentDate').value = date.iso;
      $('#dateHelp').textContent = `Suggested date found in the document (${date.format} format). Please verify it.`;
      $('#ocrStatus').textContent = `Recognition complete · ${Math.round(result.confidence)}% OCR confidence${state.imageProcessingWarning ? ' · Review image cleanup/crop' : ''}`;
    } else {
      $('#dateHelp').textContent = 'OCR did not find a date. Enter the date printed on the document before saving.';
      $('#ocrStatus').className = 'ocr-status warning';
      $('#ocrStatus').textContent = `Text recognition complete · ${Math.round(result.confidence)}% OCR confidence · Date not found${state.imageProcessingWarning ? ' · Review image cleanup/crop' : ''}`;
    }
  } catch (error) {
    $('#recognizedText').value = 'Text recognition could not run. Enter the subject, reference number and date manually; the image can still be saved.';
    $('#ocrStatus').className = 'ocr-status warning';
    $('#ocrStatus').textContent = `OCR unavailable: ${error.message}${state.imageProcessingWarning ? ' · Review image cleanup/crop' : ''}`;
    $('#dateHelp').textContent = 'Enter the date printed on the document before saving.';
  }
  $('#saveDocumentButton').disabled = false;
}

async function savePendingDocument() {
  if (!state.pendingFile || state.saving) return;
  const titleInput = $('#documentTitle').value.trim();
  const date = $('#documentDate').value;
  if (!titleInput) { showToast('Enter a document title before saving.', 'error'); $('#documentTitle').focus(); return; }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { showToast('Select the date shown on the document.', 'error'); $('#documentDate').focus(); return; }
  state.saving = true;
  $('#saveDocumentButton').disabled = true;
  $('#skipReviewButton').disabled = true;
  $('#saveDocumentButton').textContent = 'Creating PDF…';
  try {
    const originalImage = state.pendingFile;
    const processedImage = state.processedImageBlob || originalImage;
    const pdfBlob = await imageToPdf(processedImage);
    const safeName = sanitizeFileName(titleInput);
    const record = {
      id: makeId(),
      title: titleInput,
      fileName: safeName,
      docDate: date,
      dateFolder: getDateFolderPath(date),
      originalName: originalImage.name,
      mimeType: originalImage.type,
      imageBlob: originalImage,
      referenceNumber: $('#documentReference').value.trim(),
      folderId: $('#documentFolder').value,
      pdfBlob,
      imageSize: originalImage.size,
      pdfSize: pdfBlob.size,
      recognizedText: $('#recognizedText').value,
      createdAt: new Date().toISOString()
    };
    await saveDocument(record);
    showToast(`Saved ${safeName}.pdf · ${formatDisplayDate(date)}`, 'success');
    state.pendingFile = null;
    state.processedImageBlob = null;
    if (state.reviewImageUrl) { URL.revokeObjectURL(state.reviewImageUrl); state.reviewImageUrl = null; }
    $('#saveDocumentButton').textContent = 'Convert and save PDF →';
    state.saving = false;
    await processNextFile();
  } catch (error) {
    showToast(error.message || 'Could not create or save the PDF.', 'error');
    state.saving = false;
    $('#saveDocumentButton').disabled = false;
    $('#skipReviewButton').disabled = false;
    $('#saveDocumentButton').textContent = 'Convert and save PDF →';
  }
}

async function skipPendingFile() {
  state.pendingFile = null;
  state.processedImageBlob = null;
  if (state.reviewImageUrl) { URL.revokeObjectURL(state.reviewImageUrl); state.reviewImageUrl = null; }
  $('#reviewModal').classList.add('hidden');
  await processNextFile();
}

function openPreview(doc) {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = URL.createObjectURL(doc.pdfBlob);
  $('#previewTitle').textContent = `${doc.fileName}.pdf`;
  $('#pdfFrame').src = state.previewUrl;
  $('#previewDownload').href = state.previewUrl;
  $('#previewDownload').download = `${doc.fileName}.pdf`;
  $('#previewModal').classList.remove('hidden');
}

async function restoreFullFrame() {
  if (!state.pendingFile) return;
  $('#restoreImageButton').disabled = true;
  try {
    state.processedImageBlob = await processFullFrameImage(state.pendingFile);
    if (state.reviewImageUrl) URL.revokeObjectURL(state.reviewImageUrl);
    state.reviewImageUrl = URL.createObjectURL(state.processedImageBlob);
    $('#reviewImage').src = state.reviewImageUrl;
    $('#cropEditor').classList.add('hidden');
    showToast('Full image restored and enhanced. Adjust the crop if needed.', 'success');
  } catch (error) {
    showToast(error.message || 'Could not restore the full image.', 'error');
  } finally {
    $('#restoreImageButton').disabled = false;
  }
}

async function populateFolderOptions(selectedId = $('#documentFolder').value) {
  const folders = await getAllFolders();
  const options = ['<option value="">No folder</option>', ...folders.map((folder) => `<option value="${escapeAttribute(folder.id)}">${escapeHtml(folder.name)}</option>`)];
  $('#documentFolder').innerHTML = options.join('');
  $('#documentFolder').value = folders.some((folder) => folder.id === selectedId) ? selectedId : '';
  const filterValue = $('#folderFilter').value;
  $('#folderFilter').innerHTML = ['<option value="">All folders</option>', ...folders.map((folder) => `<option value="${escapeAttribute(folder.id)}">${escapeHtml(folder.name)}</option>`)].join('');
  $('#folderFilter').value = folders.some((folder) => folder.id === filterValue) ? filterValue : '';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function openFolderModal() {
  $('#folderName').value = '';
  $('#folderError').textContent = '';
  $('#folderModal').classList.remove('hidden');
  $('#folderName').focus();
}

async function createFolder() {
  const name = $('#folderName').value.trim();
  if (!name) {
    $('#folderError').textContent = 'Enter a folder name.';
    $('#folderName').focus();
    return;
  }
  try {
    const folders = await getAllFolders();
    if (folders.some((folder) => folder.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      $('#folderError').textContent = 'A folder with this name already exists.';
      $('#folderName').focus();
      return;
    }
    const folder = { id: makeId(), name, createdAt: new Date().toISOString() };
    await saveFolder(folder);
    await populateFolderOptions(folder.id);
    $('#folderModal').classList.add('hidden');
    await refreshViews();
    showToast(`Folder "${name}" created.`, 'success');
  } catch (error) {
    $('#folderError').textContent = error.message || 'Could not create the folder.';
  }
}

function drawCropSelection() {
  const canvas = $('#cropCanvas');
  const context = canvas.getContext('2d');
  if (!state.cropImage) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(state.cropImage, 0, 0, canvas.width, canvas.height);
  if (!state.cropSelection) return;
  const { x, y, width, height } = state.cropSelection;
  context.fillStyle = 'rgba(24, 28, 48, .48)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.clearRect(x, y, width, height);
  context.drawImage(state.cropImage, x, y, width, height, x, y, width, height);
  context.strokeStyle = '#5b4ae8';
  context.lineWidth = Math.max(2, canvas.width / 500);
  context.strokeRect(x, y, width, height);
}

async function openCropEditor() {
  const blob = state.processedImageBlob || state.pendingFile;
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    state.cropImage = image;
    const canvas = $('#cropCanvas');
    const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    state.cropScaleX = image.naturalWidth / canvas.width;
    state.cropScaleY = image.naturalHeight / canvas.height;
    state.cropSelection = null;
    $('#cropEditor').classList.remove('hidden');
    drawCropSelection();
    $('#applyCropButton').disabled = true;
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    showToast('Could not open the image crop editor.', 'error');
  };
  image.src = url;
}

async function applyCrop() {
  if (!state.cropSelection || !state.processedImageBlob) return;
  try {
    const crop = state.cropSelection;
    const blob = await cropImage(state.processedImageBlob, {
      x: crop.x * state.cropScaleX,
      y: crop.y * state.cropScaleY,
      width: crop.width * state.cropScaleX,
      height: crop.height * state.cropScaleY
    });
    state.processedImageBlob = blob;
    if (state.reviewImageUrl) URL.revokeObjectURL(state.reviewImageUrl);
    state.reviewImageUrl = URL.createObjectURL(blob);
    $('#reviewImage').src = state.reviewImageUrl;
    $('#cropEditor').classList.add('hidden');
    $('#adjustCropButton').textContent = 'Adjust crop';
    showToast('Crop applied. Review the image before saving.', 'success');
  } catch (error) {
    showToast(error.message || 'Could not apply the crop.', 'error');
  }
}

function closeModal(name) {
  if (name === 'review') {
    if (state.pendingFile) {
      const shouldSkip = window.confirm('Close the review and skip this image?');
      if (!shouldSkip) return;
      skipPendingFile();
    } else $('#reviewModal').classList.add('hidden');
  } else if (name === 'camera') closeCamera();
  else if (name === 'preview') {
    $('#previewModal').classList.add('hidden');
    $('#pdfFrame').src = 'about:blank';
    if (state.previewUrl) { URL.revokeObjectURL(state.previewUrl); state.previewUrl = null; }
  } else if (name === 'folder') $('#folderModal').classList.add('hidden');
}

async function openCamera() {
  $('#cameraModal').classList.remove('hidden');
  $('#cameraMessage').textContent = 'Requesting camera permission…';
  $('#captureButton').disabled = true;
  try {
    state.cameraStream = await startCamera($('#cameraVideo'));
    $('#cameraMessage').textContent = 'Keep the full document in frame, then capture.';
    $('#captureButton').disabled = false;
  } catch (error) {
    $('#cameraMessage').textContent = error.message;
    showToast(error.message, 'error');
  }
}

function closeCamera() {
  stopCamera(state.cameraStream, $('#cameraVideo'));
  state.cameraStream = null;
  $('#cameraModal').classList.add('hidden');
}

// Login events
$('#loginForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const ok = signIn($('#username').value, $('#password').value);
  if (!ok) { $('#loginError').textContent = 'Incorrect username or password.'; return; }
  $('#loginError').textContent = '';
  setLoginVisibility();
});
const togglePassword = $('#togglePassword');
if (togglePassword) togglePassword.addEventListener('click', () => {
  const input = $('#password');
  input.type = input.type === 'password' ? 'text' : 'password';
  togglePassword.textContent = input.type === 'password' ? 'Show' : 'Hide';
});
$('#logoutButton').addEventListener('click', () => { signOut(); setLoginVisibility(); $('#password').value = ''; });

// Navigation and upload events
$('#menuButton').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
document.querySelectorAll('.nav-link').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
['topUploadButton', 'libraryUploadButton'].forEach((id) => $(`#${id}`).addEventListener('click', () => { switchView('dashboard'); $('#fileInput').click(); }));
$('#seeAllButton').addEventListener('click', () => switchView('documents'));
$('#browseButton').addEventListener('click', () => $('#fileInput').click());
$('#dropZone').addEventListener('click', (event) => { if (event.target.id !== 'browseButton') $('#fileInput').click(); });
$('#dropZone').addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('#fileInput').click(); } });
$('#fileInput').addEventListener('change', (event) => addFiles(event.target.files));
$('#processButton').addEventListener('click', beginProcessing);
$('#cameraButton').addEventListener('click', openCamera);
$('#captureButton').addEventListener('click', async () => {
  try { const file = await captureFrame($('#cameraVideo')); closeCamera(); addFiles([file]); }
  catch (error) { showToast(error.message, 'error'); }
});
$('#stopCameraButton').addEventListener('click', closeCamera);

// Drag and drop
['dragenter', 'dragover'].forEach((type) => $('#dropZone').addEventListener(type, (event) => { event.preventDefault(); $('#dropZone').classList.add('drag-over'); }));
['dragleave', 'drop'].forEach((type) => $('#dropZone').addEventListener(type, (event) => { event.preventDefault(); $('#dropZone').classList.remove('drag-over'); }));
$('#dropZone').addEventListener('drop', (event) => addFiles(event.dataTransfer.files));

// Review and modal events
$('#saveDocumentButton').addEventListener('click', savePendingDocument);
$('#skipReviewButton').addEventListener('click', skipPendingFile);
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.close)));
$('#searchInput').addEventListener('input', renderLibrary);
$('#dateFilter').addEventListener('change', renderLibrary);
$('#clearFiltersButton').addEventListener('click', () => { $('#searchInput').value = ''; $('#dateFilter').value = ''; $('#folderFilter').value = ''; renderLibrary(); });
$('#folderFilter').addEventListener('change', renderLibrary);
$('#createFolderButton').addEventListener('click', openFolderModal);
$('#reviewCreateFolderButton').addEventListener('click', openFolderModal);
$('#saveFolderButton').addEventListener('click', createFolder);
$('#adjustCropButton').addEventListener('click', openCropEditor);
$('#restoreImageButton').addEventListener('click', restoreFullFrame);
$('#cancelCropButton').addEventListener('click', () => $('#cropEditor').classList.add('hidden'));
$('#applyCropButton').addEventListener('click', applyCrop);
$('#cropCanvas').addEventListener('pointerdown', (event) => {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - rect.left) * event.currentTarget.width / rect.width;
  const y = (event.clientY - rect.top) * event.currentTarget.height / rect.height;
  state.cropStart = { x, y };
  state.cropSelection = { x, y, width: 0, height: 0 };
  event.currentTarget.setPointerCapture(event.pointerId);
  drawCropSelection();
});
$('#cropCanvas').addEventListener('pointermove', (event) => {
  if (!state.cropStart) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const x = Math.max(0, Math.min(event.currentTarget.width, (event.clientX - rect.left) * event.currentTarget.width / rect.width));
  const y = Math.max(0, Math.min(event.currentTarget.height, (event.clientY - rect.top) * event.currentTarget.height / rect.height));
  state.cropSelection = {
    x: Math.min(x, state.cropStart.x),
    y: Math.min(y, state.cropStart.y),
    width: Math.abs(x - state.cropStart.x),
    height: Math.abs(y - state.cropStart.y)
  };
  drawCropSelection();
});
$('#cropCanvas').addEventListener('pointerup', () => {
  state.cropStart = null;
  $('#applyCropButton').disabled = !state.cropSelection || state.cropSelection.width < 10 || state.cropSelection.height < 10;
});
$('#cropCanvas').addEventListener('pointercancel', () => { state.cropStart = null; });
$('#documentDate').addEventListener('input', () => { $('#dateHelp').textContent = 'Confirm this is the date printed on the document.'; });

// Document actions are delegated because rows are created dynamically.
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  try {
    await handleDocumentAction(button.dataset.action, button.dataset.id, showToast, openPreview);
    if (button.dataset.action !== 'delete') showToast(button.dataset.action === 'download' ? 'Download started.' : 'PDF preview opened.', 'success');
  } catch (error) { showToast(error.message || 'Document action failed.', 'error'); }
});

window.addEventListener('beforeunload', () => {
  if (state.reviewImageUrl) URL.revokeObjectURL(state.reviewImageUrl);
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  stopCamera(state.cameraStream, $('#cameraVideo'));
});

setLoginVisibility();
