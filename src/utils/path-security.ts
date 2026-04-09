import { resolve, sep } from 'path';
import { realpath, open } from 'fs/promises';

export async function validatePathUnderRoot(filePath: string, projectRoot: string): Promise<string> {
  const resolvedPath = resolve(filePath);
  const resolvedRoot = resolve(projectRoot);

  if (!resolvedPath.startsWith(resolvedRoot + sep) && resolvedPath !== resolvedRoot) {
    throw new Error('Path escapes project root');
  }

  const real = await realpath(resolvedPath);

  if (!real.startsWith(resolvedRoot + sep) && real !== resolvedRoot) {
    throw new Error('Path escapes project root');
  }

  return real;
}

export async function isBinaryFile(filePath: string): Promise<boolean> {
  const fileHandle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await fileHandle.read(buffer, 0, 8192);

    if (bytesRead === 0) {
      return false;
    }

    return buffer.subarray(0, bytesRead).indexOf(0x00) !== -1;
  } finally {
    await fileHandle.close();
  }
}
