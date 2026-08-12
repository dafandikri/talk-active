import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  LegacyWorkspaceImportSchema,
  WorkspaceExportSchema,
} from '../apps/web/lib/contracts.ts';

test('D-1 validates a real legacy workspace without accepting malformed summaries', () => {
  const valid = LegacyWorkspaceImportSchema.safeParse({
    version: 1,
    projects: [{
      id: 'legacy-project',
      name: 'Final pitch',
      event: '7-minute pitch',
      deadline: '2026-08-14',
      rubric: 'Problem | affected users, source',
      draft: 'A draft retained by the browser.',
      draftDuration: 90,
      createdAt: '2026-08-10T08:00:00.000Z',
    }],
    sessions: [{
      id: 'legacy-session',
      projectId: 'legacy-project',
      createdAt: '2026-08-11T08:00:00.000Z',
      evidenceScore: 52,
      weakest: 'Problem',
      defenseStatus: 'developing',
      title: 'Second attempt',
    }],
  });
  assert.equal(valid.success, true);
  assert.equal(LegacyWorkspaceImportSchema.safeParse({ version: 1, projects: [], sessions: [] }).success, false);
});

test('D-1 preserves summary-only history without fabricating old verdict evidence', async () => {
  const service = await readFile('apps/web/lib/services/workspace.ts', 'utf8');
  const importSlice = service.slice(service.indexOf('export async function importLegacyWorkspace'));
  assert.match(importSlice, /transcript: ''/u);
  assert.match(importSlice, /legacyEvidenceCoverage: legacySession\.evidenceScore/u);
  assert.match(importSlice, /legacyWeakest: legacySession\.weakest/u);
  assert.doesNotMatch(importSlice, /insert\(evidenceVerdicts\)/u);
  assert.match(importSlice, /sourceRetained: true/u);

  const panel = await readFile('apps/web/components/account-panel.tsx', 'utf8');
  assert.doesNotMatch(panel, /removeItem\(['"]talkactive\.workspace\.v1/gu);
});

test('D-2 export contract contains every persisted workspace surface', () => {
  const source = WorkspaceExportSchema._zod.def.shape;
  for (const field of [
    'projects', 'rubrics', 'criteria', 'attempts', 'verdicts', 'questions',
    'evidenceConfirmations', 'defenseAnswers', 'sourceDocuments',
  ]) assert.ok(field in source, `${field} is absent from export`);
});

test('A-6 export includes source contents while hard deletion removes private blobs first', async () => {
  const service = await readFile('apps/web/lib/services/workspace.ts', 'utf8');
  const exportSlice = service.slice(
    service.indexOf('export async function exportOwnedWorkspace'),
    service.indexOf('export async function deleteOwnedAccount'),
  );
  assert.match(exportSlice, /content: await storage\.read\(document\.blobUrl\)/u);
  assert.match(exportSlice, /sourceDocuments: exportedDocuments/u);

  const deleteSlice = service.slice(service.indexOf('export async function deleteOwnedAccount'));
  const blobDeleteAt = deleteSlice.indexOf('await storage.delete');
  const accountDeleteAt = deleteSlice.indexOf('db.delete(user)');
  assert.ok(blobDeleteAt >= 0, 'account deletion must remove source blobs');
  assert.ok(accountDeleteAt > blobDeleteAt, 'private blobs must be removed before account metadata cascades');
});

test('A-5 evaluation labels are exportable in synced and local-only modes', async () => {
  const service = await readFile('apps/web/lib/services/workspace.ts', 'utf8');
  assert.match(service, /confirmationRows[\s\S]+evidenceConfirmations: confirmationRows/u);
  const accountPanel = await readFile('apps/web/components/account-panel.tsx', 'utf8');
  assert.match(accountPanel, /evidenceConfirmations: localStorage\.getItem\(LOCAL_EVIDENCE_CONFIRMATIONS_KEY\)/u);
});

test('D-3 account deletion is an explicit hard delete protected by ownership', async () => {
  const service = await readFile('apps/web/lib/services/workspace.ts', 'utf8');
  assert.match(service, /db\.delete\(user\)\.where\(eq\(user\.id, userId\)\)/u);
  assert.match(service, /ownedSources[\s\S]+storage\.delete/u);
  const schema = await readFile('apps/web/lib/db/schema.ts', 'utf8');
  assert.match(schema, /references\(\(\) => authUsers\.id, \{ onDelete: 'cascade' \}\)/u);
  assert.doesNotMatch(schema, /deletedAt|softDelete/gu);
});
