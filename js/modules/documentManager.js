import { getAllDocuments, getAllFolders, getDocument, deleteDocument } from './database.js';
import { formatBytes } from './fileValidator.js';
import { formatDisplayDate, formatMonthYear } from '../utils/fileName.js';
import { groupDocumentsByDate } from './fileOrganizer.js';

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function documentRow(doc, folderName = '') {
  const details = [doc.referenceNumber ? `Ref: ${escapeHtml(doc.referenceNumber)}` : '', folderName ? escapeHtml(folderName) : ''].filter(Boolean).join(' · ');
  return `<article class="document-row">
    <div class="pdf-icon">PDF</div>
    <div class="document-info"><strong title="${escapeHtml(doc.title || doc.fileName)}">${escapeHtml(doc.title || doc.fileName)}.pdf</strong><small>${formatDisplayDate(doc.docDate)} · ${formatBytes(doc.pdfSize || doc.pdfBlob?.size || 0)}${details ? ` · ${details}` : ''}</small></div>
    <div class="row-actions">
      <button class="mini-action" data-action="preview" data-id="${escapeHtml(doc.id)}" title="Preview PDF" aria-label="Preview PDF">⌕</button>
      <button class="mini-action" data-action="download" data-id="${escapeHtml(doc.id)}" title="Download PDF" aria-label="Download PDF">↓</button>
      <button class="mini-action delete" data-action="delete" data-id="${escapeHtml(doc.id)}" title="Delete document" aria-label="Delete document">×</button>
    </div></article>`;
}

export async function renderDashboard() {
  const docs = await getAllDocuments();
  const folders = await getAllFolders();
  const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]));
  $('#statDocuments').textContent = docs.length;
  $('#statPdfs').textContent = docs.filter((doc) => doc.pdfBlob).length;
  const now = new Date();
  $('#statMonth').textContent = docs.filter((doc) => {
    const saved = new Date(doc.createdAt);
    return saved.getMonth() === now.getMonth() && saved.getFullYear() === now.getFullYear();
  }).length;
  $('#navDocumentCount').textContent = docs.length;
  $('#recentDocuments').innerHTML = docs.length
    ? docs.slice(0, 5).map((doc) => documentRow(doc, folderNames.get(doc.folderId))).join('')
    : `<div class="empty-state compact"><div class="empty-icon">▤</div><strong>No documents yet</strong><p>Your converted documents will appear here.</p></div>`;
  updateStorageEstimate(docs);
}

function updateStorageEstimate(docs) {
  const bytes = docs.reduce((total, doc) => total + (doc.imageBlob?.size || 0) + (doc.pdfBlob?.size || 0), 0);
  const mb = bytes / (1024 * 1024);
  const display = mb < 0.01 ? `${Math.round(bytes)} B` : `${mb.toFixed(2)} MB`;
  $('#storageText').textContent = `${display} stored by this app (estimate)`;
  // IndexedDB quota varies by browser/device; this is only a visual usage indicator, not a quota reading.
  const percentage = Math.min(100, Math.round((mb / 100) * 100));
  $('#storagePercent').textContent = `${percentage}%`;
  $('#storageBar').style.width = `${percentage}%`;
}

export async function renderLibrary() {
  const docs = await getAllDocuments();
  const folders = await getAllFolders();
  const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]));
  const query = $('#searchInput').value.trim().toLowerCase();
  const date = $('#dateFilter').value;
  const folderId = $('#folderFilter').value;
  const filtered = docs.filter((doc) => {
    const searchable = `${doc.title} ${doc.fileName} ${doc.originalName} ${doc.referenceNumber || ''} ${doc.recognizedText || ''} ${doc.docDate || ''} ${formatDisplayDate(doc.docDate)}`.toLowerCase();
    const queryMatch = !query || searchable.includes(query);
    const dateMatch = !date || doc.docDate === date;
    const folderMatch = !folderId || doc.folderId === folderId;
    return queryMatch && dateMatch && folderMatch;
  });
  if (!filtered.length) {
    $('#libraryDocuments').innerHTML = `<div class="empty-state"><div class="empty-icon">▤</div><strong>No documents found</strong><p>Try another search or upload a new document image.</p></div>`;
    return;
  }
  $('#libraryDocuments').innerHTML = groupDocumentsByDate(filtered).map(([dateKey, items]) => {
    const title = dateKey === 'Unclassified' ? 'Date not recognized' : formatMonthYear(dateKey);
    return `<section class="date-group"><div class="date-group-title">${escapeHtml(title)}</div>${items.map((doc) => documentRow(doc, folderNames.get(doc.folderId))).join('')}</section>`;
  }).join('');
}

export async function handleDocumentAction(action, id, showToast, openPreview) {
  if (action === 'preview') {
    const doc = await getDocument(id);
    if (!doc?.pdfBlob) throw new Error('PDF file is unavailable.');
    openPreview(doc);
  } else if (action === 'download') {
    const doc = await getDocument(id);
    if (!doc?.pdfBlob) throw new Error('PDF file is unavailable.');
    const url = URL.createObjectURL(doc.pdfBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${doc.fileName}.pdf`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } else if (action === 'delete') {
    const doc = await getDocument(id);
    if (!doc) return;
    const confirmed = window.confirm(`Delete "${doc.fileName}.pdf" from this browser? This cannot be undone.`);
    if (!confirmed) return;
    await deleteDocument(id);
    showToast('Document deleted.', 'success');
    await renderDashboard();
    await renderLibrary();
  }
}
