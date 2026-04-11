export interface Image {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  deprecated?: boolean;
  pinned?: boolean;
  locked?: boolean;
}
