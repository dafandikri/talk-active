'use client';

import { useEffect, useState } from 'react';

import logo from '../../../src/assets/brand/talk-active-logo.svg';
import { jsonRequest, requestContract } from '@/lib/api/client';
import { DEFAULT_RUBRIC, parseRubric } from '@/lib/analyzer';
import { RubricParseResponseSchema, type RubricSource } from '@/lib/contracts';
import { RUBRIC_TEMPLATES, templateRubricText, type RubricTemplate } from '@/lib/rubric-library';
import {
  parseEvidencePhrases,
  readStoredRubricCriteria,
  readRubricSourceType,
  RUBRIC_SOURCE_STORAGE_KEY,
  writeStoredRubricCriteria,
} from '@/lib/rubric-storage';

interface EditableCriterion {
  id: string;
  name: string;
  description: string;
  evidence: string;
  sourceExcerpt: string | null;
  displayOrder: number;
}

function defaultCriteria(): EditableCriterion[] {
  return parseRubric(DEFAULT_RUBRIC).map((criterion, displayOrder) => ({
    id: criterion.id,
    name: criterion.label,
    description: '',
    evidence: criterion.signals.join(', '),
    sourceExcerpt: null,
    displayOrder,
  }));
}

export function RubricEditor() {
  const [criteria, setCriteria] = useState<EditableCriterion[]>(defaultCriteria);
  const [source, setSource] = useState(DEFAULT_RUBRIC);
  const [status, setStatus] = useState('Review every criterion before saving.');
  const [busy, setBusy] = useState(false);
  const [sourceType, setSourceType] = useState<RubricSource>('manual');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  useEffect(() => {
    const saved = readStoredRubricCriteria(localStorage);
    if (!saved) return;
    setCriteria(saved.map((criterion) => ({
      ...criterion,
      evidence: criterion.requiredEvidence.join(', '),
    })));
    setSourceType(readRubricSourceType(localStorage));
  }, []);

  function applyTemplate(template: RubricTemplate) {
    setCriteria(template.criteria.map((criterion, index) => ({
      id: `${template.id}-${index + 1}`,
      name: criterion.name,
      description: criterion.description,
      evidence: criterion.requiredEvidence.join(', '),
      sourceExcerpt: null,
      displayOrder: index,
    })));
    setSource(templateRubricText(template));
    setSourceType('library');
    setSelectedTemplate(template.id);
    setStatus(`${template.name} starter loaded but not saved. Replace any cue that does not match your evaluator, then confirm with Save rubric.`);
  }

  function updateCriterion(id: string, patch: Partial<EditableCriterion>) {
    setCriteria((current) => current.map((criterion) => criterion.id === id
      ? { ...criterion, ...patch, sourceExcerpt: null }
      : criterion));
  }

  function updateSource(nextSource: string) {
    setSource(nextSource);
    // Once the underlying source changes, an excerpt from its previous text is
    // no longer provenance for the editable rows.
    setCriteria((current) => current.map((criterion) => ({
      ...criterion,
      sourceExcerpt: null,
    })));
  }

  async function structureSource() {
    setBusy(true);
    setStatus('Structuring only the criteria present in your source…');
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
        displayOrder: criterion.displayOrder,
      })));
      setSourceType('imported');
      setSelectedTemplate(null);
      setStatus(`${parsed.criteria.length} criteria structured in ${parsed.mode} mode. Confirm the wording before saving.`);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : 'The rubric source could not be structured.');
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const cleaned = criteria.map((criterion, displayOrder) => ({
      id: criterion.id,
      name: criterion.name.trim(),
      description: criterion.description.trim(),
      requiredEvidence: parseEvidencePhrases(criterion.evidence),
      sourceExcerpt: criterion.sourceExcerpt,
      displayOrder,
    })).filter((criterion) => criterion.name);
    if (cleaned.length === 0) {
      setStatus('Keep at least one named criterion. Add a description or evidence phrases whenever the source provides them.');
      return;
    }
    try {
      const saved = writeStoredRubricCriteria(localStorage, cleaned);
      localStorage.setItem(RUBRIC_SOURCE_STORAGE_KEY, sourceType);
      setCriteria(saved.map((criterion) => ({
        ...criterion,
        evidence: criterion.requiredEvidence.join(', '),
      })));
      setStatus(`${saved.length} confirmed criteria saved in this browser.`);
    } catch {
      setStatus('Each criterion needs a unique row and no more than 40 concise evidence phrases.');
    }
  }

  return <section className="view is-visible" aria-labelledby="rubricTitle">
    <header className="page-header compact-header workflow-header">
      <div className="workflow-heading"><img className="workflow-mark" src={logo.src} alt="" /><div><p className="overline">Evaluation setup</p><h1 id="rubricTitle">Make feedback follow the real rules.</h1><p className="page-lede">Define what evaluators need to hear. Every result will point back to these cues.</p></div></div>
      <button className="button button-primary" type="button" onClick={save}>Save rubric</button>
    </header>
    <div className="rubric-layout">
      <section className="surface rubric-editor-card">
        <div className="section-title-row"><div><p className="overline">Active project</p><h2>Talk-Active · RISTEK Finals</h2></div><span className="session-status">Local guest</span></div>
        <section className="rubric-library" aria-labelledby="rubricLibraryTitle">
          <div><p className="overline">Starter library</p><h3 id="rubricLibraryTitle">Begin from a familiar evaluation context</h3><p>These are editable starting points, not official scoring rubrics. Use the evaluator’s published matrix whenever one exists.</p></div>
          <div className="rubric-template-list">{RUBRIC_TEMPLATES.map((template) => <button
            aria-pressed={selectedTemplate === template.id}
            className={selectedTemplate === template.id ? 'is-selected' : ''}
            key={template.id}
            type="button"
            onClick={() => applyTemplate(template)}
          ><strong>{template.name}</strong><span>{template.context}</span><small>{template.criteria.length} editable criteria</small></button>)}</div>
        </section>
        <details className="rubric-import">
          <summary>Import from a scoring matrix</summary>
          <p className="rubric-import-lede">Paste published evaluator criteria. Talk-Active structures the source, but you confirm every row before it is saved.</p>
          <textarea rows={6} maxLength={8_000} aria-label="Paste the scoring matrix" value={source} onChange={(event) => updateSource(event.target.value)} />
          <button type="button" disabled={busy || !source.trim()} onClick={structureSource}>{busy ? 'Structuring…' : 'Structure these criteria'}</button>
        </details>
        <p className="rubric-import-status" role="status">{status}</p>
        <div className="rubric-list">{criteria.map((criterion, index) => <div className="rubric-row" key={criterion.id}>
          <span className="rubric-number">{index + 1}</span>
          <div className="rubric-field"><label htmlFor={`criterion-${criterion.id}`}>Criterion</label><input id={`criterion-${criterion.id}`} value={criterion.name} onChange={(event) => updateCriterion(criterion.id, { name: event.target.value })} /></div>
          <div className="rubric-field rubric-description"><label htmlFor={`description-${criterion.id}`}>What the evaluator requires</label><input id={`description-${criterion.id}`} value={criterion.description} onChange={(event) => updateCriterion(criterion.id, { description: event.target.value })} /></div>
          <div className="rubric-field"><label htmlFor={`evidence-${criterion.id}`}>Observable evidence cues</label><input id={`evidence-${criterion.id}`} value={criterion.evidence} onChange={(event) => updateCriterion(criterion.id, { evidence: event.target.value })} /></div>
          <button className="remove-criterion" type="button" aria-label={`Remove ${criterion.name}`} onClick={() => setCriteria((current) => current.filter((item) => item.id !== criterion.id))}>×</button>
          {criterion.sourceExcerpt && <p className="production-source-quote">Source: “{criterion.sourceExcerpt}”</p>}
        </div>)}</div>
        <button className="add-criterion" type="button" onClick={() => setCriteria((current) => [...current, { id: crypto.randomUUID(), name: '', description: '', evidence: '', sourceExcerpt: null, displayOrder: current.length }])}><span>+</span> Add criterion</button>
      </section>
      <aside className="surface rubric-guide"><p className="overline">A useful criterion has</p><ul><li><span>1</span><div><strong>A judge-facing label</strong><small>Example: Problem urgency</small></div></li><li><span>2</span><div><strong>Observable evidence cues</strong><small>Example: affected users, frequency, cost</small></div></li><li><span>3</span><div><strong>A clear reason to challenge it</strong><small>Avoid vague traits such as “good delivery.”</small></div></li></ul><div className="guide-note"><strong>Why this matters</strong><p>Generic feedback asks whether you sounded confident. Rubric-grounded feedback asks whether you gave the evaluator enough evidence to believe the claim.</p></div></aside>
    </div>
  </section>;
}
