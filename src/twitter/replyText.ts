/** Restore reply recipients when a source exposes them separately from the text. */
export function withReplyRecipients(text: string, sourceUsername: string, recipients: string[]): string {
  const leading = text.match(/^\s*((?:@[a-zA-Z0-9_]+(?:\s+(?=@)|(?=$|[\s\p{P}]))+))/u);
  const leadingNames = leading?.[1].match(/@[a-zA-Z0-9_]+/g) || [];
  const names: string[] = [];
  for (const name of [...recipients, ...leadingNames]) {
    const handle = name.replace(/^@/, '');
    if (!/^[a-zA-Z0-9_]+$/.test(handle)) continue;
    if (!names.some(existing => existing.toLowerCase() === handle.toLowerCase())) {
      names.push(handle);
    }
  }

  if (names.length === 0) return text;
  const body = leading ? text.slice(leading[0].length).trimStart() : text;
  if (names.length === 1 && names[0].toLowerCase() === sourceUsername.toLowerCase()) {
    return body.replace(/^[,;:]\s*/, '');
  }
  const separator = body && /^[,;:.!?]/.test(body) ? '' : ' ';
  return `${names.map(name => `@${name}`).join(' ')}${separator}${body}`.trimEnd();
}
