export function splitMeanings(text: string) {
  return text.split(/[;\r\n]/u).map((part) => part.trim()).filter(Boolean);
}

export function serializeMeanings(text: string) {
  return splitMeanings(text).join('; ');
}

export function numberedMeanings(text: string) {
  return splitMeanings(text).map((meaning, index) => `${index + 1}. ${meaning}`).join(' ');
}
