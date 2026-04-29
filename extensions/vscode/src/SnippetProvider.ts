import * as vscode from 'vscode';

export async function openSnippet(
  session: string,
  id: string,
  snippet: { name: string }
): Promise<void> {
  const uri = vscode.Uri.parse(`collab-snippet:/${encodeURIComponent(session)}/${id}/${encodeURIComponent(snippet.name)}`);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: true });
}
