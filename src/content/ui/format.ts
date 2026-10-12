import type { CommentMessage } from '../../shared/model';

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** A message's text, or what it holds when it's only pictures. */
export function messagePreview(message: CommentMessage | undefined): string {
  if (!message) return '';
  if (message.body) return message.body;
  const images = message.attachments?.length ?? 0;
  return images ? (images === 1 ? 'Image' : plural(images, 'image')) : '';
}
