export function displayLabel(id: string, nicknames?: Record<string, string>): string {
  const nick = nicknames?.[id];
  if (nick) return nick;
  return id.length > 8 ? id.slice(0, 8) : id;
}

const ID_RE = /crit_[0-9a-fA-F]{8}_\d+_[0-9a-z]+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

export function humanizeIds(text: string, nicknames?: Record<string, string>): string {
  if (!nicknames) return text;
  return text.replace(ID_RE, (match) => nicknames[match] ?? match);
}
