// ============================================================================
//  POST /api/import-rubric — structure a pasted scoring matrix.
//
//  This handler stays thin: prompt construction, failover, validation, and
//  formatting live in testable src modules. A failed import leaves the manual
//  rubric editor available, with no partial result persisted.
// ============================================================================
import { AnalysisError } from '../src/analyzer.mjs';
import { ImportUnavailable, importRubric } from '../src/rubric-import.mjs';

const MAX_BODY_BYTES = 64 * 1024;

function readJsonBody(request) {
  // Vercel may have parsed the body already; a bare Node server has not.
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);

  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new AnalysisError('payload_too_large', 'Rubric is too large to import.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new AnalysisError('invalid_json', 'Request body was not valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function send(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    send(response, 405, { error: 'method_not_allowed', message: 'Use POST.' });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const result = await importRubric({ rubricText: body.rubricText });
    send(response, 200, result);
  } catch (error) {
    // INV-7: invalid input is explicit rather than guessed around.
    if (error instanceof AnalysisError) {
      send(response, 400, { error: error.code, message: error.message });
      return;
    }
    if (error instanceof ImportUnavailable) {
      send(response, 422, {
        error: 'import_unavailable',
        message: 'Import unavailable — edit the criteria manually instead.',
      });
      return;
    }
    send(response, 500, {
      error: 'import_failed',
      message: 'Rubric import could not be completed. Edit the criteria manually instead.',
    });
  }
}
