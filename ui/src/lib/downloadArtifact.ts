import { api } from './api';
import { Item } from '@/types';

export async function downloadArtifact(serverId: string, project: string, session: string, item: Item): Promise<void> {
  let content: string;
  let filename: string;
  let mimeType: string;

  switch (item.type) {
    case 'diagram': {
      const data = await api.getDiagram(serverId, project, session, item.id);
      if (!data) return;
      content = data.content || '';
      filename = `${item.name}.mmd`;
      mimeType = 'text/plain';
      break;
    }
    case 'document': {
      const data = await api.getDocument(serverId, project, session, item.id);
      if (!data) return;
      content = data.content || '';
      filename = `${item.name}.md`;
      mimeType = 'text/markdown';
      break;
    }
    case 'design': {
      const data = await api.getDesign(serverId, project, session, item.id);
      if (!data) return;
      content = JSON.stringify(data.content, null, 2);
      filename = `${item.name}.design.json`;
      mimeType = 'application/json';
      break;
    }
    case 'snippet': {
      const data = await api.getSnippet(serverId, project, session, item.id);
      if (!data) return;
      content = data.content || '';
      // Snippet names already include file extension
      filename = item.name;
      mimeType = 'text/plain';
      break;
    }
    case 'spreadsheet': {
      const data = await api.getSpreadsheet(serverId, project, session, item.id);
      if (!data) return;
      content = JSON.stringify(data, null, 2);
      filename = `${item.name}.spreadsheet.json`;
      mimeType = 'application/json';
      break;
    }
    default:
      return;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
