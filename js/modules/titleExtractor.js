const TITLE_KEYWORDS = /\b(letter|proposal|report|invitation|application|minutes|request|statement|receipt|notice|agreement|memorandum|appreciation|certificate|recommendation|appointment|authorization|confirmation|partnership|undertaking|complaint|resolution|invoice|quotation|policy|agenda|circular)\b/i;

function cleanLine(line) {
  return line.replace(/[|_]+/g, ' ').replace(/\s+/g, ' ').replace(/^[^a-z0-9]+|[^a-z0-9)]+$/gi, '').trim();
}

export function extractTitle(text, fallback = 'Untitled_Document') {
  const subject = text.match(/^\s*subject\s*:\s*(.+)$/im);
  const subjectText = subject?.[1]?.replace(/\s*(?:[,;|]\s*)?\b(?:date|ref(?:erence)?(?:\s+(?:no\.?|number))?)\s*[:#].*$/i, '').trim();
  if (subjectText) return cleanLine(subjectText);
  const lines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const candidates = lines.map((line, index) => {
    const words = line.split(/\s+/).filter(Boolean);
    const letters = line.replace(/[^a-z]/gi, '');
    const upper = letters ? (letters.replace(/[^A-Z]/g, '').length / letters.length) : 0;
    const hasKeyword = TITLE_KEYWORDS.test(line);
    const hasDate = /\b(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{4}|20\d{2}-\d{2}-\d{2})\b/i.test(line);
    if (words.length < 2 || words.length > 18 || line.length < 8 || hasDate) return null;
    let score = 0;
    if (hasKeyword) score += 7;
    if (upper > 0.62) score += 4;
    else if (upper > 0.35) score += 2;
    if (words.length >= 3 && words.length <= 12) score += 2;
    if (/^(the|to|from|dear|attention|date|ref(erence)?|subject)\b/i.test(line)) score -= 4;
    if (index < 2 && words.length > 5) score -= 1;
    if (line.length > 100) score -= 2;
    return { line, score, index };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.index - b.index);

  return candidates.length && candidates[0].score >= 3 ? candidates[0].line : fallback;
}

export function extractReferenceNumber(text) {
  const match = text.match(/\b(?:our\s+)?(?:ref(?:erence)?|file)\.?\s*(?:(?:no|number)\.?\s*)?[:#-]?\s*([A-Z0-9][A-Z0-9/-]{2,})/i);
  return match?.[1]?.trim() || '';
}
