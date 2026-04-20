import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AttachmentDropzone } from '../AttachmentDropzone';

function makeFile(name = 'pic.png', type = 'image/png', body = 'hello'): File {
  return new File([body], name, { type });
}

function mockFetchOk(response: object) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => response,
  });
}

describe('AttachmentDropzone', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    // fresh each test
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('uploads pasted file and invokes onUpload', async () => {
    const fetchMock = mockFetchOk({
      attachmentId: 'abc123',
      mimeType: 'image/png',
      url: '/api/agent/attachments/abc123?sessionId=s1',
      sizeBytes: 5,
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const onUpload = vi.fn();

    render(
      <AttachmentDropzone sessionId="s1" onUpload={onUpload}>
        <textarea data-testid="child" />
      </AttachmentDropzone>,
    );

    const dropzone = screen.getByTestId('attachment-dropzone');
    const file = makeFile('pic.png', 'image/png');

    fireEvent.paste(dropzone, {
      clipboardData: {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => file,
          },
        ],
        files: [file],
      },
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('/api/agent/attachments?sessionId=s1');
    expect(calledInit.method).toBe('POST');
    expect(calledInit.body).toBeInstanceOf(FormData);
    expect((calledInit.body as FormData).get('file')).toBe(file);

    await waitFor(() =>
      expect(onUpload).toHaveBeenCalledWith({
        id: 'abc123',
        url: '/api/agent/attachments/abc123?sessionId=s1',
        mimeType: 'image/png',
        name: 'pic.png',
      }),
    );
  });

  it('uploads dropped file and invokes onUpload', async () => {
    const fetchMock = mockFetchOk({
      attachmentId: 'drop1',
      mimeType: 'text/plain',
      url: '/api/agent/attachments/drop1?sessionId=s2',
      sizeBytes: 5,
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const onUpload = vi.fn();

    render(
      <AttachmentDropzone sessionId="s2" onUpload={onUpload}>
        <div data-testid="child">drop here</div>
      </AttachmentDropzone>,
    );

    const dropzone = screen.getByTestId('attachment-dropzone');
    const file = makeFile('note.txt', 'text/plain');

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [file],
        items: [{ kind: 'file', type: 'text/plain', getAsFile: () => file }],
        types: ['Files'],
      },
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/agent/attachments?sessionId=s2');

    await waitFor(() =>
      expect(onUpload).toHaveBeenCalledWith({
        id: 'drop1',
        url: '/api/agent/attachments/drop1?sessionId=s2',
        mimeType: 'text/plain',
        name: 'note.txt',
      }),
    );
  });

  it('applies drag-over class during dragover and removes on dragleave', () => {
    const onUpload = vi.fn();
    render(
      <AttachmentDropzone sessionId="s1" onUpload={onUpload}>
        <div>child</div>
      </AttachmentDropzone>,
    );
    const dropzone = screen.getByTestId('attachment-dropzone');
    expect(dropzone.className).not.toContain('attachment-dropzone--drag-over');

    fireEvent.dragOver(dropzone, { dataTransfer: { files: [], items: [], types: ['Files'] } });
    expect(dropzone.className).toContain('attachment-dropzone--drag-over');
    expect(dropzone.className).toContain('border-dashed');

    fireEvent.dragLeave(dropzone);
    expect(dropzone.className).not.toContain('attachment-dropzone--drag-over');
  });
});
