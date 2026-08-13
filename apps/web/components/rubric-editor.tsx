'use client';

import { useEffect, useState } from 'react';

import { useToast } from '@/components/toast';
import { DEFAULT_RUBRIC, parseRubric } from '@/lib/analyzer';
import { jsonRequest, requestContract } from '@/lib/api/client';
import { RubricParseResponseSchema, type RubricSource } from '@/lib/contracts';
import { RUBRIC_TEMPLATES, type RubricTemplate } from '@/lib/rubric-library';
import {
  parseEvidencePhrases,
  readRubricSourceType,
  readStoredRubricCriteria,
  RUBRIC_SOURCE_STORAGE_KEY,
  writeStoredRubricCriteria,
} from '@/lib/rubric-storage';

// The editor is a drafting surface, not the analysis contract. lib/analyzer.ts still
// accepts up to MAX_CRITERIA, so a rubric saved before this cap keeps every row it had.
const MAX_CRITERIA_ROWS = 5;

interface EditableCriterion {
  id: string;
  name: string;
  /** Kept even though the decluttered row has no field for it: an imported
      criterion can carry a description and no evidence cues, and dropping it on
      save would quietly rewrite what the evaluator wrote. */
  description: string;
  evidence: string;
  sourceExcerpt: string | null;
}

function defaultCriteria(): EditableCriterion[] {
  return parseRubric(DEFAULT_RUBRIC).map((criterion) => ({
    id: criterion.id,
    name: criterion.label,
    description: '',
    evidence: criterion.signals.join(', '),
    sourceExcerpt: null,
  }));
}

export function RubricEditor() {
  const [criteria, setCriteria] = useState<EditableCriterion[]>(defaultCriteria);
  const [sourceType, setSourceType] = useState<RubricSource>('manual');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const { showToast } = useToast();
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      // Read through the typed contract rather than JSON.parse of whatever is
      // in the key. It migrates the older shape and keeps description and
      // display order, which a raw parse silently drops.
      const saved = readStoredRubricCriteria(localStorage);
      if (saved && saved.length > 0) {
        setCriteria(saved.map((criterion) => ({
          id: criterion.id,
          name: criterion.name,
          description: criterion.description,
          evidence: criterion.requiredEvidence.join(', '),
          sourceExcerpt: criterion.sourceExcerpt,
        })));
        setSourceType(readRubricSourceType(localStorage));
      }
    } catch {
      showToast({
        variant: 'warning',
        title: 'Starter rubric restored',
        message: 'The saved local rubric was invalid, so the finals starter rubric was restored.',
      });
    }
  }, [showToast]);

  // Pasting the evaluator's own scoring matrix is the demo this product is built
  // around, so the structured rows always arrive editable and unsaved: the user
  // confirms every one before anything is written.
  async function structureSource() {
    setBusy(true);
    try {
      const parsed = await requestContract(
        '/api/rubrics/parse',
        RubricParseResponseSchema,
        jsonRequest('POST', { rubricText: source }),
      );
      setCriteria(parsed.criteria.map((criterion) => ({
        id: criterion.clientId,
        name: criterion.name,
        description: criterion.description,
        evidence: criterion.requiredEvidence.join(', '),
        sourceExcerpt: criterion.sourceExcerpt,
      })));
      setSourceType('imported');
      showToast({
        variant: 'warning',
        title: `${parsed.criteria.length} criteria structured in ${parsed.mode} mode`,
        message: 'Nothing is saved yet. Confirm the wording of every row, then save.',
      });
    } catch (caught) {
      showToast({
        variant: 'negative',
        title: 'Rubric source could not be structured',
        message: caught instanceof Error ? caught.message : 'The rubric source could not be structured.',
      });
    } finally {
      setBusy(false);
    }
  }

  function applyTemplate(template: RubricTemplate) {
    setCriteria(template.criteria.map((criterion, index) => ({
      id: `${template.id}-${index + 1}`,
      name: criterion.name,
      description: '',
      evidence: criterion.requiredEvidence.join(', '),
      sourceExcerpt: null,
    })));
    setSourceType('library');
    setSelectedTemplate(template.id);
    showToast({
      variant: 'warning',
      title: 'Starter loaded but not saved',
      message: `${template.name} starter loaded. Replace any cue that does not match your evaluator, then confirm with Save rubric.`,
    });
  }

  function updateCriterion(id: string, patch: Partial<EditableCriterion>) {
    setCriteria((current) => current.map((criterion) => criterion.id === id ? { ...criterion, ...patch } : criterion));
  }

  function save() {
    // Written through the typed v2 contract, not JSON.stringify of the editor's
    // own shape: description, evidence phrases, and display order all have to
    // survive the round trip for the rest of the app to read them back.
    const cleaned = criteria.map((criterion, displayOrder) => ({
      id: criterion.id,
      name: criterion.name.trim(),
      description: criterion.description.trim(),
      requiredEvidence: parseEvidencePhrases(criterion.evidence),
      sourceExcerpt: criterion.sourceExcerpt,
      displayOrder,
    })).filter((criterion) => criterion.name);
    if (cleaned.length === 0) {
      showToast({
        variant: 'negative',
        title: 'Rubric not saved',
        message: 'Keep at least one named criterion. Add a description or evidence cues whenever the source provides them.',
      });
      return;
    }
    try {
      const saved = writeStoredRubricCriteria(localStorage, cleaned);
      localStorage.setItem(RUBRIC_SOURCE_STORAGE_KEY, sourceType);
      setCriteria(saved.map((criterion) => ({
        id: criterion.id,
        name: criterion.name,
        description: criterion.description,
        evidence: criterion.requiredEvidence.join(', '),
        sourceExcerpt: criterion.sourceExcerpt,
      })));
      showToast({
        variant: 'positive',
        title: 'Rubric saved',
        message: `${saved.length} confirmed criteria saved in this browser.`,
      });
    } catch {
      showToast({
        variant: 'negative',
        title: 'Rubric not saved',
        message: 'Each criterion needs a unique row and no more than 40 concise evidence phrases.',
      });
    }
  }

  return <section className="view is-visible" aria-labelledby="rubricTitle">
    <header className="page-header compact-header"><h1 id="rubricTitle">Modify rubric</h1></header>
    <div className="rubric-layout">
      <section className="surface rubric-editor-card">
        <h2>Talk-Active · RISTEK Finals</h2>
        <section className="rubric-library" aria-labelledby="rubricLibraryTitle">
          <h3 id="rubricLibraryTitle">Begin from a familiar evaluation context</h3>
          {/* A starter is not the evaluator's rubric, and a student who mistakes
              one for the other rehearses against the wrong thing. */}
          <p className="rubric-library-lede">These are editable starting points, not official scoring rubrics. Use the evaluator&rsquo;s published matrix whenever one exists.</p>
          <div className="rubric-template-list">{RUBRIC_TEMPLATES.map((template) => <button
            aria-pressed={selectedTemplate === template.id}
            className={selectedTemplate === template.id ? 'is-selected' : ''}
            key={template.id}
            type="button"
            onClick={() => applyTemplate(template)}
          ><strong>{template.name}</strong><span>{template.context}</span></button>)}</div>
        </section>
        <details className="rubric-import">
          <summary>Import from a scoring matrix</summary>
          <p className="rubric-import-lede">Paste published evaluator criteria. Talk-Active structures the source, but you confirm every row before it is saved.</p>
          <textarea rows={6} maxLength={8_000} aria-label="Paste the scoring matrix" value={source} onChange={(event) => setSource(event.target.value)} />
          <button type="button" disabled={busy || !source.trim()} onClick={() => void structureSource()}>{busy ? 'Structuring…' : 'Structure these criteria'}</button>
        </details>
        <p className="rubric-list-lede">Add up to {MAX_CRITERIA_ROWS} criteria, each with observable evidence cues.</p>
        <div className="rubric-list">{criteria.map((criterion) => <div className="rubric-row" key={criterion.id}>
          <div className="rubric-field"><label htmlFor={`criterion-${criterion.id}`}>Criterion</label><input id={`criterion-${criterion.id}`} placeholder="e.g. Achievement evidence" value={criterion.name} onChange={(event) => updateCriterion(criterion.id, { name: event.target.value })} /></div>
          <div className="rubric-field"><label htmlFor={`evidence-${criterion.id}`}>Observable evidence cues</label><input id={`evidence-${criterion.id}`} placeholder="e.g. metrics, dates, named source" value={criterion.evidence} onChange={(event) => updateCriterion(criterion.id, { evidence: event.target.value })} /></div>
          {criterion.sourceExcerpt && <p className="production-source-quote">Source: “{criterion.sourceExcerpt}”</p>}
          <button className="remove-criterion" type="button" aria-label={`Remove ${criterion.name || 'empty criterion'}`} onClick={() => setCriteria((current) => current.filter((item) => item.id !== criterion.id))}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" /></svg>
          </button>
        </div>)}</div>
        <button className="add-criterion" type="button" disabled={criteria.length >= MAX_CRITERIA_ROWS} onClick={() => setCriteria((current) => [...current, { id: crypto.randomUUID(), name: '', description: '', evidence: '', sourceExcerpt: null }])}><span>+</span> Add criterion</button>
        <div className="rubric-actions"><button className="button button-primary" type="button" onClick={save}>Save rubric</button></div>
      </section>
    </div>
  </section>;
}
