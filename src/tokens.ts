import { getEncoding } from 'js-tiktoken';

export const TOKENIZER = 'cl100k_base' as const;
const encoding = getEncoding(TOKENIZER);

export function countTokens(text: string): number {
  if (text.length === 0) return 0;
  return encoding.encode(text).length;
}
