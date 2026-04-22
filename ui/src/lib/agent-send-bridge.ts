type SendFn = (text: string) => void;

let _send: SendFn | null = null;

export function registerAgentSend(fn: SendFn): () => void {
  _send = fn;
  return () => {
    if (_send === fn) _send = null;
  };
}

export function sendToAgentChat(text: string): boolean {
  if (_send === null) return false;
  _send(text);
  return true;
}
