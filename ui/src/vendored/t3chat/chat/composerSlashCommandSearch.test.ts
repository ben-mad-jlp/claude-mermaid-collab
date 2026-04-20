import { describe, it, expect } from 'vitest';
import { searchSlashCommands, type SlashCommand } from './composerSlashCommandSearch';

const cmds: SlashCommand[] = [
  { id: 'clear', name: 'clear', description: 'clear thread' },
  { id: 'help', name: 'help' },
  { id: 'plan', name: 'plan', aliases: ['p'] },
];

describe('searchSlashCommands', () => {
  it('returns empty for no matches', () => {
    expect(searchSlashCommands(cmds, 'xyz')).toEqual([]);
  });

  it('prefers exact prefix matches', () => {
    const r = searchSlashCommands(cmds, 'cl');
    expect(r[0].command.id).toBe('clear');
  });

  it('strips leading slash from query', () => {
    const r = searchSlashCommands(cmds, '/hel');
    expect(r[0].command.id).toBe('help');
  });

  it('matches via aliases', () => {
    const r = searchSlashCommands(cmds, 'p');
    expect(r.some(x => x.command.id === 'plan')).toBe(true);
  });

  it('empty query returns all commands', () => {
    const r = searchSlashCommands(cmds, '');
    expect(r.length).toBe(cmds.length);
  });
});
