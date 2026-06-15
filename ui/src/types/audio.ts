export interface Audio {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  durationSec?: number;
  deprecated?: boolean;
  pinned?: boolean;
  locked?: boolean;
}
