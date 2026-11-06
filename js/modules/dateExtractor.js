const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
};

function toIso(year, month, day) {
  const y = Number(year), m = Number(month), d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < 1900 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function extractDate(text) {
  const source = text.replace(/\s+/g, ' ');
  const candidates = [];
  const add = (iso, index, format) => { if (iso) candidates.push({ iso, index, format }); };
  const dayMonth = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?[,]?\s+(\d{4})\b/gi;
  let match;
  while ((match = dayMonth.exec(source))) add(toIso(match[3], MONTHS[match[2].toLowerCase().replace('.', '')], match[1]), match.index, 'text');
  const monthDay = /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/gi;
  while ((match = monthDay.exec(source))) add(toIso(match[3], MONTHS[match[1].toLowerCase().replace('.', '')], match[2]), match.index, 'text');
  const numeric = /\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/g;
  while ((match = numeric.exec(source))) {
    // Nigeria-style day/month/year is preferred for numeric dates.
    const first = Number(match[1]), second = Number(match[2]);
    // Prefer Nigerian/UK day-month-year order when both values are 12 or below.
    // If the second value cannot be a month, interpret the input as month-day-year.
    const day = second > 12 && first <= 12 ? second : first;
    const month = second > 12 && first <= 12 ? first : second;
    add(toIso(match[3], month, day), match.index, 'numeric');
  }
  const isoDate = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
  while ((match = isoDate.exec(source))) add(toIso(match[1], match[2], match[3]), match.index, 'iso');
  candidates.sort((a, b) => a.index - b.index);
  return candidates[0] || null;
}
