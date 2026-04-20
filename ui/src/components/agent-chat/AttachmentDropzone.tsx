import React, { useCallback, useState } from 'react';

interface UploadedAttachment {
  id: string;
  url: string;
  mimeType: string;
  name: string;
}

interface AttachmentDropzoneProps {
  sessionId: string;
  onUpload: (a: UploadedAttachment) => void;
  children: React.ReactNode;
}

interface AttachmentResponse {
  attachmentId: string;
  mimeType: string;
  url: string;
  sizeBytes: number;
}

export function AttachmentDropzone({ sessionId, onUpload, children }: AttachmentDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const uploadFile = useCallback(
    async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      try {
        const res = await fetch(
          `/api/agent/attachments?sessionId=${encodeURIComponent(sessionId)}`,
          {
            method: 'POST',
            body: form,
          },
        );
        if (!res.ok) return;
        const data = (await res.json()) as AttachmentResponse;
        onUpload({
          id: data.attachmentId,
          url: data.url,
          mimeType: data.mimeType,
          name: file.name,
        });
      } catch {
        // swallow upload errors
      }
    },
    [sessionId, onUpload],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        files.forEach((f) => void uploadFile(f));
      }
    },
    [uploadFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      for (let i = 0; i < files.length; i++) {
        void uploadFile(files[i]);
      }
    },
    [uploadFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const className = isDragOver
    ? 'attachment-dropzone attachment-dropzone--drag-over border-2 border-dashed border-blue-500 w-full'
    : 'attachment-dropzone w-full';

  return (
    <div
      className={className}
      data-testid="attachment-dropzone"
      onPaste={handlePaste}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {children}
    </div>
  );
}

export default AttachmentDropzone;
