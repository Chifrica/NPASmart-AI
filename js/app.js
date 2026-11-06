import { APP_CONFIG } from './config.js';
import { signIn, isSignedIn, signOut } from './auth.js';
import { validateImageFile, formatBytes } from './modules/fileValidator.js';
import { recognizeDocument } from './modules/ocrEngine.js';
import { extractTitle } from './modules/titleExtractor.js';
import { extractDate } from './modules/dateExtractor.js';
import { imageToPdf } from './modules/pdfGenerator.js';
import { saveDocument } from './modules/database.js';
import { getDateFolderPath } from './modules/fileOrganizer.js';
import { renderDashboard, renderLibrary, handleDocumentAction } from './modules/documentManager.js';
import { sanitizeFileName, makeId, formatDisplayDate } from './utils/fileName.js';
import { startCamera, stopCamera, captureFrame } from './modules/camera.js';

const $ = (selector) => document.querySelector(selector);
const state = { selectedFiles: [], queue: [], pendingFile: null, cameraStream: null, reviewImageUrl: null, previewUrl: null, activeView: 'dashboard', saving: false };

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
  try { await renderDashboard(); await renderLibrary(); }
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
  if (state.reviewImageUrl) URL.revokeObjectURL(state.reviewImageUrl);
  state.reviewImageUrl = URL.createObjectURL(file);
  $('#reviewImage').src = state.reviewImageUrl;
  $('#reviewTitle').textContent = 'Review document details';
  $('#documentTitle').value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  $('#documentDate').value = new Date().toISOString().slice(0, 10);
  $('#dateHelp').textContent = 'No date suggestion yet. Confirm or change this to the date printed on the document.';
  $('#recognizedText').value = '';
  $('#ocrStatus').className = 'ocr-status';
  $('#ocrStatus').textContent = 'Reading document text…';
  $('#saveDocumentButton').disabled = true;
  $('#skipReviewButton').disabled = false;
  $('#reviewModal').classList.remove('hidden');
  try {
    const result = await recognizeDocument(file, (progress) => { $('#ocrStatus').textContent = `Recognizing text… ${progress}%`; });
    const title = extractTitle(result.text, file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
    const date = extractDate(result.text);
    $('#documentTitle').value = title;
    $('#recognizedText').value = result.text.trim() || 'No readable text was detected.';
    if (date) {
      $('#documentDate').value = date.iso;
      $('#dateHelp').textContent = `Suggested date found in the document (${date.format} format). Please verify it.`;
      $('#ocrStatus').textContent = `Recognition complete · ${Math.round(result.confidence)}% OCR confidence`;
    } else {
      $('#dateHelp').textContent = 'OCR did not find a date. The date field currently shows today; replace it with the date printed on the document.';
      $('#ocrStatus').className = 'ocr-status warning';
      $('#ocrStatus').textContent = `Text recognition complete · ${Math.round(result.confidence)}% OCR confidence · Date not found`;
    }
  } catch (error) {
    $('#recognizedText').value = 'Text recognition could not run. You can still enter the document title and date manually; the original image can be converted without OCR.';
    $('#ocrStatus').className = 'ocr-status warning';
    $('#ocrStatus').textContent = `OCR unavailable: ${error.message}`;
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
    const pdfBlob = await imageToPdf(originalImage);
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
      pdfBlob,
      imageSize: originalImage.size,
      pdfSize: pdfBlob.size,
      recognizedText: $('#recognizedText').value,
      createdAt: new Date().toISOString()
    };
    await saveDocument(record);
    showToast(`Saved ${safeName}.pdf · ${formatDisplayDate(date)}`, 'success');
    state.pendingFile = null;
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
  }
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
$('#togglePassword').addEventListener('click', () => {
  const input = $('#password');
  input.type = input.type === 'password' ? 'text' : 'password';
  $('#togglePassword').textContent = input.type === 'password' ? 'Show' : 'Hide';
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
$('#clearFiltersButton').addEventListener('click', () => { $('#searchInput').value = ''; $('#dateFilter').value = ''; renderLibrary(); });

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
