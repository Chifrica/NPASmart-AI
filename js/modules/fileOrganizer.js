export function getDateFolderPath(isoDate) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return 'Unclassified/Date_Not_Recognized';
  const [year, month, day] = isoDate.split('-');
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(year), Number(month) - 1, 1)));
  return `${year}/${monthName}/${day}-${month}-${year}`;
}

export function groupDocumentsByDate(documents) {
  const groups = new Map();
  for (const document of documents) {
    const key = document.docDate || 'Unclassified';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(document);
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}
