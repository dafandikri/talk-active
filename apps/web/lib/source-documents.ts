import { del, get, put } from '@vercel/blob';

export const MAX_SOURCE_DOCUMENTS = 3;
export const MAX_SOURCE_BYTES = 40_000;
export const MAX_SOURCE_CONTEXT_CHARS = 80_000;

const ALLOWED_SOURCE_TYPES = new Map([
  ['.txt', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.markdown', 'text/markdown'],
  ['.json', 'application/json'],
]);

export interface SourceMaterial {
  id: string;
  filename: string;
  content: string;
}

export interface SourceUpload {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ValidatedSourceUpload {
  filename: string;
  contentType: string;
  sizeBytes: number;
  bytes: Uint8Array<ArrayBuffer>;
  content: string;
}

export interface SourceDocumentStorage {
  put(input: {
    projectId: string;
    filename: string;
    contentType: string;
    bytes: Uint8Array<ArrayBuffer>;
  }): Promise<{ url: string }>;
  read(url: string): Promise<string>;
  delete(urls: string[]): Promise<void>;
}

export class SourceDocumentError extends Error {
  readonly code: 'invalid_source_document' | 'source_storage_unavailable' | 'source_document_unavailable';

  constructor(
    code: 'invalid_source_document' | 'source_storage_unavailable' | 'source_document_unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'SourceDocumentError';
    this.code = code;
  }
}

function extension(filename: string): string {
  const match = filename.toLocaleLowerCase('en-US').match(/\.[a-z0-9]+$/u);
  return match?.[0] ?? '';
}

export function safeSourceFilename(value: unknown): string {
  const basename = String(value ?? '')
    .normalize('NFKC')
    .split(/[\\/]/u)
    .at(-1)
    ?.trim() ?? '';
  const safe = basename
    .replace(/[^\p{L}\p{N}._ -]+/gu, '-')
    .replace(/\s+/gu, ' ')
    .slice(0, 120)
    .trim();
  return safe || 'source.txt';
}

export async function validateSourceUpload(file: SourceUpload): Promise<ValidatedSourceUpload> {
  const filename = safeSourceFilename(file.name);
  const expectedType = ALLOWED_SOURCE_TYPES.get(extension(filename));
  if (!expectedType || (file.type && file.type !== expectedType && file.type !== 'text/plain')) {
    throw new SourceDocumentError(
      'invalid_source_document',
      'Use a UTF-8 .txt, .md, .markdown, or .json source document.',
    );
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_SOURCE_BYTES) {
    throw new SourceDocumentError(
      'invalid_source_document',
      `Source documents must be between 1 byte and ${MAX_SOURCE_BYTES / 1000} KB.`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new SourceDocumentError('invalid_source_document', 'The uploaded source size changed while reading it.');
  }
  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
  } catch {
    throw new SourceDocumentError('invalid_source_document', 'The source document must contain valid UTF-8 text.');
  }
  if (content.length < 20 || content.includes('\0')) {
    throw new SourceDocumentError(
      'invalid_source_document',
      'The source document must contain at least 20 readable characters and no binary data.',
    );
  }
  if (expectedType === 'application/json') {
    try {
      JSON.parse(content);
    } catch {
      throw new SourceDocumentError('invalid_source_document', 'The .json source document is not valid JSON.');
    }
  }
  return { filename, contentType: expectedType, sizeBytes: bytes.byteLength, bytes, content };
}

function assertStorageConfigured(): void {
  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    throw new SourceDocumentError(
      'source_storage_unavailable',
      'Private source-document storage is not configured on this deployment.',
    );
  }
}

export const vercelSourceDocumentStorage: SourceDocumentStorage = {
  async put(input) {
    assertStorageConfigured();
    const pathname = `source-documents/${input.projectId}/${crypto.randomUUID()}-${safeSourceFilename(input.filename)}`;
    const blob = await put(pathname, new Blob([input.bytes], { type: input.contentType }), {
      access: 'private',
      contentType: input.contentType,
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
    });
    return { url: blob.url };
  },
  async read(url) {
    assertStorageConfigured();
    const result = await get(url, { access: 'private' });
    if (!result || result.statusCode !== 200) {
      throw new SourceDocumentError('source_document_unavailable', 'A private source document could not be read.');
    }
    if (result.blob.size > MAX_SOURCE_BYTES) {
      throw new SourceDocumentError('source_document_unavailable', 'A source document exceeds its stored size limit.');
    }
    const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
    } catch {
      throw new SourceDocumentError('source_document_unavailable', 'A stored source document is not valid UTF-8 text.');
    }
  },
  async delete(urls) {
    if (urls.length === 0) return;
    assertStorageConfigured();
    await del(urls);
  },
};

export function boundedSourceMaterials(materials: SourceMaterial[]): SourceMaterial[] {
  let remaining = MAX_SOURCE_CONTEXT_CHARS;
  return materials.flatMap((material) => {
    if (remaining <= 0) return [];
    const content = material.content.slice(0, remaining);
    remaining -= content.length;
    return content ? [{ ...material, content }] : [];
  });
}
