import { useMemo, useEffect, useState } from 'react';
import { useQuickReplyStore, type AutocorrectMode } from '@/stores/quickReplyStore';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useSessionStore } from '@/stores/sessionStore';
import { buildProjectVocab, type VocabSnapshot } from '@/lib/autocorrect/vocab';
import { correctToken, correctMessage } from '@/lib/autocorrect/engine';
import { loadCommonWords } from '@/lib/autocorrect/wordlist';
import { getPersonalDict } from '@/lib/autocorrect/personalDict';
import type { SlashCommand } from '@/vendored/t3chat/chat/composerSlashCommandSearch';

export type Suggestion = { from: string; to: string; strength: 'strong' };
export type Hit = { start: number; end: number; from: string; to: string };

export function useAutocorrect(project: string): {
  mode: AutocorrectMode;
  correct: (token: string) => Suggestion | null;
  correctMessage: (text: string) => Hit[];
} {
  const mode = useQuickReplyStore((s) => s.autocorrectMode);

  const todos = useSupervisorStore((s) => s.todosByProject[project]);
  const todoTitles = (todos ?? []).map((t) => t.title);

  const supervised = useSupervisorStore((s) => s.supervised);
  const sessionNames = (supervised ?? [])
    .filter((x) => x.project === project)
    .map((x) => x.session);

  const documents = useSessionStore((s) => s.documents);
  const docNames = (documents ?? []).map((d) => d.name);

  const slashCommands: SlashCommand[] = [];
  const slashCommandNames = slashCommands.map((c) => c.name);

  const [l2, setL2] = useState<Set<string> | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadCommonWords().then((s) => {
      if (live) setL2(s);
    });
    return () => {
      live = false;
    };
  }, []);

  const vocab = useMemo(() => {
    const snapshot: VocabSnapshot = {
      sessionNames,
      docNames,
      todoTitles,
      fileSegments: [],
      slashCommands: slashCommandNames,
      mcpToolNames: [],
    };
    const v = buildProjectVocab(snapshot);
    for (const w of getPersonalDict(project)) {
      v.protected.add(w);
    }
    return v;
  }, [
    project,
    todoTitles.join(' '),
    sessionNames.join(' '),
    docNames.join(' '),
    slashCommandNames.join(' '),
  ]);

  const correct = useMemo(
    () => (token: string) => correctToken(token, vocab, { l2 }),
    [vocab, l2],
  );

  const correctMessageBound = useMemo(
    () => (text: string) => correctMessage(text, vocab, { l2 }),
    [vocab, l2],
  );

  return { mode, correct, correctMessage: correctMessageBound };
}
