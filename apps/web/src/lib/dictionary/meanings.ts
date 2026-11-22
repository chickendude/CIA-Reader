export function splitMeanings(text: string) {
  return text.split(';').map((part) => part.trim()).filter(Boolean);
}

export function numberedMeanings(text: string) {
  return splitMeanings(text).map((meaning, index) => `${index + 1}. ${meaning}`).join(' ');
}
