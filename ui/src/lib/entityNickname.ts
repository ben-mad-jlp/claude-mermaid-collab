export function displayLabel(id: string, nicknames?: Record<string, string>): string {
  const nick = nicknames?.[id];
  if (nick) return nick;
  return id.length > 8 ? id.slice(0, 8) : id;
}

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

export function humanizeIds(text: string, nicknames?: Record<string, string>): string {
  if (!nicknames) return text;
  return text.replace(UUID_RE, (match) => nicknames[match] ?? match);
}
