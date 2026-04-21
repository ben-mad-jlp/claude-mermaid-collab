import { type LexicalEditor, $getRoot, $createTextNode, $createParagraphNode } from 'lexical';
import { useNotificationStore } from '@/stores/notificationStore';

let currentAbort: AbortController | null = null;

function showToast(type: 'error' | 'warning', title: string, message?: string): void {
  useNotificationStore.getState().addToast({ type, title, message, duration: 5000 });
}

export function abortEditorRoundTrip(): void {
  currentAbort?.abort();
  currentAbort = null;
}

export async function triggerEditorRoundTrip(
  editor: LexicalEditor,
  sessionId: string,
): Promise<void> {
  abortEditorRoundTrip();
  const abort = new AbortController();
  currentAbort = abort;

  let editorStateJson = '';
  editor.read(() => {
    editorStateJson = JSON.stringify(editor.getEditorState().toJSON());
  });

  let token: string;
  let path: string;
  try {
    const res = await fetch('/api/agent/editor-open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editorStateJson, sessionId }),
      signal: abort.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { token: string; path: string };
    token = data.token;
    path = data.path;
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    showToast('error', 'Editor open failed');
    return;
  }

  const a = document.createElement('a');
  a.href = `vscode://file/${path}`;
  a.click();

  const MAX_RETRIES = 30;
  let attempts = 0;

  while (attempts < MAX_RETRIES) {
    let pollRes: Response;
    try {
      pollRes = await fetch(`/api/agent/editor-poll?token=${encodeURIComponent(token)}`, {
        signal: abort.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      showToast('error', 'Editor poll failed: network error');
      return;
    }

    if (!pollRes.ok) {
      showToast('error', `Editor poll failed: ${pollRes.status}`);
      return;
    }

    const data = await pollRes.json() as { timeout?: boolean; content?: string };
    if (data.timeout) { attempts++; continue; }
    if (typeof data.content === 'string') {
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        const para = $createParagraphNode();
        para.append($createTextNode(data.content!));
        root.append(para);
      }, { discrete: true });
      return;
    }
    showToast('error', 'Unexpected editor poll response');
    return;
  }

  showToast('warning', 'Editor round-trip timed out — no save detected');
}
