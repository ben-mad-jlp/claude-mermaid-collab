import { Item } from '@/types';
import { downloadArtifact } from './downloadArtifact';

export async function emailArtifact(project: string, session: string, item: Item): Promise<void> {
  // Download the artifact file first so the user can attach it
  await downloadArtifact(project, session, item);

  const subject = encodeURIComponent(`[Collab] ${item.name}`);
  const body = encodeURIComponent(`Please see the attached file: ${item.name}`);
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}
