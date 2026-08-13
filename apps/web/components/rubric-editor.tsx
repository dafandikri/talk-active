'use client';

import { useEffect, useState } from 'react';

import { DEFAULT_RUBRIC, parseRubric } from '@/lib/analyzer';
import { type RubricSource } from '@/lib/contracts';
import { RUBRIC_TEMPLATES, type RubricTemplate } from '@/lib/rubric-library';
import {
  readRubricSourceType,
  RUBRIC_SOURCE_STORAGE_KEY,
  RUBRIC_STORAGE_KEY,
} from '@/lib/rubric-storage';

// The editor is a drafting surface, not the analysis contract. lib/analyzer.ts still
// accepts up to MAX_CRITERIA, so a rubric saved before this cap keeps every row it had.
const MAX_CRITERIA_ROWS = 5;

interface EditableCriterion {
  id: string;
  name: string;
  evidence: string;
  sourceExcerpt: string | null;
}

function defaultCriteria(): EditableCriterion[] {
  return parseRubric(DEFAULT_RUBRIC).map((criterion) => ({
    id: criterion.id,
    name: criterion.label,
    evidence: criterion.signals.join(', '),
    sourceExcerpt: null,
  }));
}

export function RubricEditor() {
  const [criteria, setCriteria] = useState<EditableCriterion[]>(defaultCriteria);
  const [status, setStatus] = useState('Review every criterion before saving.');
  const [sourceType, setSourceType] = useState<RubricSource>('manual');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(RUBRIC_STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as EditableCriterion[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        setCriteria(parsed);
        setSourceType(readRubricSourceType(localStorage));
      }
    } catch {
      setStatus('The saved local rubric was invalid, so the finals starter rubric was restored.');
    }
  }, []);

  function applyTemplate(template: RubricTemplate) {
    setCriteria(template.criteria.map((criterion, index) => ({
      id: `${template.id}-${index + 1}`,
      name: criterion.name,
      evidence: criterion.requiredEvidence.join(', '),
      sourceExcerpt: null,
    })));
    setSourceType('library');
    setSelectedTemplate(template.id);
    setStatus(`${template.name} starter loaded but not saved. Replace any cue that does not match your evaluator, then confirm with Save rubric.`);
  }

  function updateCriterion(id: string, patch: Partial<EditableCriterion>) {
    setCriteria((current) => current.map((criterion) => criterion.id === id ? { ...criterion, ...patch } : criterion));
  }

  function save() {
    const cleaned = criteria.map((criterion) => ({
      ...criterion,
      name: criterion.name.trim(),
      evidence: criterion.evidence.trim(),
    })).filter((criterion) => criterion.name && criterion.evidence);
    if (cleaned.length === 0) {
      setStatus('Keep at least one named criterion with observable evidence cues.');
      return;
    }
    localStorage.setItem(RUBRIC_STORAGE_KEY, JSON.stringify(cleaned));
    localStorage.setItem(RUBRIC_SOURCE_STORAGE_KEY, sourceType);
    setCriteria(cleaned);
    setStatus(`${cleaned.length} confirmed criteria saved in this browser.`);
  }

  return <section className="view is-visible" aria-labelledby="rubricTitle">
    <header className="page-header compact-header"><h1 id="rubricTitle">Modify rubric</h1></header>
    <div className="rubric-layout">
      <section className="surface rubric-editor-card">
        <h2>Talk-Active · RISTEK Finals</h2>
        <section className="rubric-library" aria-labelledby="rubricLibraryTitle">
          <h3 id="rubricLibraryTitle">Begin from a familiar evaluation context</h3>
          <div className="rubric-template-list">{RUBRIC_TEMPLATES.map((template) => <button
            aria-pressed={selectedTemplate === template.id}
            className={selectedTemplate === template.id ? 'is-selected' : ''}
            key={template.id}
            type="button"
            onClick={() => applyTemplate(template)}
          ><strong>{template.name}</strong><span>{template.context}</span></button>)}</div>
        </section>
        <p className="rubric-list-lede">Add up to {MAX_CRITERIA_ROWS} criteria, each with observable evidence cues.</p>
        <div className="rubric-list">{criteria.map((criterion) => <div className="rubric-row" key={criterion.id}>
          <div className="rubric-field"><label htmlFor={`criterion-${criterion.id}`}>Criterion</label><input id={`criterion-${criterion.id}`} placeholder="e.g. Achievement evidence" value={criterion.name} onChange={(event) => updateCriterion(criterion.id, { name: event.target.value })} /></div>
          <div className="rubric-field"><label htmlFor={`evidence-${criterion.id}`}>Observable evidence cues</label><input id={`evidence-${criterion.id}`} placeholder="e.g. metrics, dates, named source" value={criterion.evidence} onChange={(event) => updateCriterion(criterion.id, { evidence: event.target.value })} /></div>
          <button className="remove-criterion" type="button" aria-label={`Remove ${criterion.name || 'empty criterion'}`} onClick={() => setCriteria((current) => current.filter((item) => item.id !== criterion.id))}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" /></svg>
          </button>
        </div>)}</div>
        <button className="add-criterion" type="button" disabled={criteria.length >= MAX_CRITERIA_ROWS} onClick={() => setCriteria((current) => [...current, { id: crypto.randomUUID(), name: '', evidence: '', sourceExcerpt: null }])}><span>+</span> Add criterion</button>
        <p className="rubric-status" role="status">{status}</p>
        <div className="rubric-actions"><button className="button button-primary" type="button" onClick={save}>Save rubric</button></div>
      </section>
    </div>
  </section>;
}
