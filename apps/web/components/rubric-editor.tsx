'use client';

import { useEffect, useRef, useState } from 'react';

import { useToast } from '@/components/toast';
import { DEFAULT_RUBRIC, parseRubric } from '@/lib/analyzer';
import { jsonRequest, requestContract } from '@/lib/api/client';
import {
  ConfirmRubricResponseSchema,
  ProjectWorkspaceResponseSchema,
  RubricParseResponseSchema,
  type ProjectSummary,
  type ProjectWorkspaceResponse,
  type RubricSource,
} from '@/lib/contracts';
import { RUBRIC_TEMPLATES, type RubricTemplate } from '@/lib/rubric-library';
import { writeProjectToCurrentUrl } from '@/lib/project-route';
import {
  parseEvidencePhrases,
  readRubricSourceType,
  readStoredRubricCriteria,
  RUBRIC_SOURCE_STORAGE_KEY,
  writeStoredRubricCriteria,
} from '@/lib/rubric-storage';
import { useOwnedProjects } from './use-owned-projects';

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

type ProjectWorkspace = ProjectWorkspaceResponse['workspace'];

type ProjectLoadState =
  | { status: 'idle'; projectId: null; workspace: null; error: null }
  | { status: 'loading'; projectId: string; workspace: null; error: null }
  | { status: 'ready'; projectId: string; workspace: ProjectWorkspace; error: null }
  | { status: 'error'; projectId: string; workspace: null; error: string };

function defaultCriteria(): EditableCriterion[] {
  return parseRubric(DEFAULT_RUBRIC).map((criterion) => ({
    id: criterion.id,
    name: criterion.label,
    description: '',
    evidence: criterion.signals.join(', '),
    sourceExcerpt: null,
  }));
}

function editableCriteria(criteria: ProjectWorkspace['criteria']): EditableCriterion[] {
  return [...criteria]
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .map((criterion) => ({
      id: criterion.id,
      name: criterion.name,
      description: criterion.description,
      evidence: criterion.requiredEvidence.join(', '),
      // The synced criterion contract does not invent an excerpt that the
      // project did not store. Newly imported rows keep their real excerpt in
      // this editor until Save, where the project source type remains explicit.
      sourceExcerpt: null,
    }));
}

function projectTitle(project: ProjectSummary | null): string {
  return project?.project.title ?? 'Local workspace';
}

const idleProject: ProjectLoadState = {
  status: 'idle',
  projectId: null,
  workspace: null,
  error: null,
};

export function RubricEditor() {
  const { projects, loading: projectsLoading } = useOwnedProjects();
  const [criteria, setCriteria] = useState<EditableCriterion[]>(defaultCriteria);
  const [sourceType, setSourceType] = useState<RubricSource>('manual');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [source, setSource] = useState('');
  const [structuring, setStructuring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [selectionHydrated, setSelectionHydrated] = useState(false);
  const [chosenProjectId, setChosenProjectId] = useState<string | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [projectState, setProjectState] = useState<ProjectLoadState>(idleProject);
  const [projectRequestVersion, setProjectRequestVersion] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [serverLockedProjectId, setServerLockedProjectId] = useState<string | null>(null);
  const activeProjectIdRef = useRef<string | null>(null);
  const structureRequestRef = useRef<AbortController | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    const requestedProject = new URLSearchParams(window.location.search).get('project');
    if (requestedProject) setChosenProjectId(requestedProject);
    setSelectionHydrated(true);

    try {
      // Local storage is read even while account discovery is in flight, but
      // it is never rendered for a synced project. This keeps guest behaviour
      // unchanged without letting a browser-global rubric leak into an account.
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

  function writeProjectToUrl(projectId: string | null, mode: 'push' | 'replace'): void {
    writeProjectToCurrentUrl(projectId, mode);
  }

  useEffect(() => {
    function restoreProjectFromHistory(): void {
      setSelectionNotice(null);
      setChosenProjectId(new URLSearchParams(window.location.search).get('project'));
    }
    window.addEventListener('popstate', restoreProjectFromHistory);
    return () => window.removeEventListener('popstate', restoreProjectFromHistory);
  }, []);

  useEffect(() => {
    if (!selectionHydrated || projectsLoading) return;
    if (projects.length === 0) {
      if (chosenProjectId) {
        setSelectionNotice('That synced project is not available in this session. Your local rubric is shown instead.');
        setChosenProjectId(null);
        writeProjectToUrl(null, 'replace');
      }
      return;
    }
    if (chosenProjectId && projects.some((summary) => summary.project.id === chosenProjectId)) return;

    const fallback = projects[0]!.project;
    if (chosenProjectId) {
      setSelectionNotice(`That project is not available. ${fallback.title} is shown instead.`);
    }
    setChosenProjectId(fallback.id);
    writeProjectToUrl(fallback.id, 'replace');
  }, [chosenProjectId, projects, projectsLoading, selectionHydrated]);

  const activeProject = projects.find((summary) => summary.project.id === chosenProjectId) ?? null;
  const activeProjectId = activeProject?.project.id ?? null;
  activeProjectIdRef.current = activeProjectId;

  useEffect(() => {
    structureRequestRef.current?.abort();
    structureRequestRef.current = null;
    setStructuring(false);
    // A browser Back/Forward transition can happen while the previous
    // project's PUT is still in flight. That request remains correctly scoped
    // to the project it started on, but it must not leave the newly selected
    // editor disabled while its late response is ignored below.
    setSaving(false);
    setSaveError(null);
    setServerLockedProjectId(null);
    setSelectedTemplate(null);
    setSource('');
    setDirty(false);

    if (!activeProjectId) {
      setProjectState(idleProject);
      return;
    }

    const abort = new AbortController();
    setProjectState({ status: 'loading', projectId: activeProjectId, workspace: null, error: null });
    void (async () => {
      try {
        const response = await requestContract(
          `/api/projects/${encodeURIComponent(activeProjectId)}`,
          ProjectWorkspaceResponseSchema,
          { signal: abort.signal },
        );
        if (abort.signal.aborted) return;
        if (response.workspace.project.id !== activeProjectId) {
          throw new Error('The server returned a different project. Nothing from it was shown.');
        }
        setProjectState({
          status: 'ready',
          projectId: activeProjectId,
          workspace: response.workspace,
          error: null,
        });
        setCriteria(response.workspace.criteria.length > 0
          ? editableCriteria(response.workspace.criteria)
          : defaultCriteria());
        setSourceType(response.workspace.rubric?.sourceType ?? 'manual');
      } catch (caught) {
        if (abort.signal.aborted) return;
        setProjectState({
          status: 'error',
          projectId: activeProjectId,
          workspace: null,
          error: caught instanceof Error ? caught.message : 'The selected project could not be loaded.',
        });
      }
    })();
    return () => abort.abort();
  }, [activeProjectId, projectRequestVersion]);

  const selectionResolving = !selectionHydrated
    || projectsLoading
    || (projects.length > 0 && activeProject === null);
  const selectedWorkspace = projectState.status === 'ready'
    && projectState.projectId === activeProjectId
    ? projectState.workspace
    : null;
  const projectDetailStatus = activeProjectId && projectState.projectId !== activeProjectId
    ? 'loading'
    : projectState.status;
  const locked = Boolean(activeProjectId && (
    activeProject?.attemptCount
    || serverLockedProjectId === activeProjectId
  ));
  const editorDisabled = locked || saving;

  function chooseProject(projectId: string): void {
    if (projectId === chosenProjectId || saving) return;
    if (dirty && !window.confirm('Discard the unsaved rubric changes and switch projects?')) return;
    setSelectionNotice(null);
    setChosenProjectId(projectId);
    writeProjectToUrl(projectId, 'push');
  }

  // Pasting the evaluator's own scoring matrix is the demo this product is built
  // around, so the structured rows always arrive editable and unsaved: the user
  // confirms every one before anything is written.
  async function structureSource() {
    structureRequestRef.current?.abort();
    const abort = new AbortController();
    const structuringProjectId = activeProjectId;
    structureRequestRef.current = abort;
    setStructuring(true);
    setSaveError(null);
    try {
      const parsed = await requestContract(
        '/api/rubrics/parse',
        RubricParseResponseSchema,
        { ...jsonRequest('POST', { rubricText: source }), signal: abort.signal },
      );
      if (abort.signal.aborted || activeProjectIdRef.current !== structuringProjectId) return;
      setCriteria(parsed.criteria.map((criterion) => ({
        id: criterion.clientId,
        name: criterion.name,
        description: criterion.description,
        evidence: criterion.requiredEvidence.join(', '),
        sourceExcerpt: criterion.sourceExcerpt,
      })));
      setSourceType('imported');
      setDirty(true);
      showToast({
        variant: 'warning',
        title: `${parsed.criteria.length} criteria structured in ${parsed.mode} mode`,
        message: 'Nothing is saved yet. Confirm the wording of every row, then save.',
      });
    } catch (caught) {
      if (abort.signal.aborted || activeProjectIdRef.current !== structuringProjectId) return;
      showToast({
        variant: 'negative',
        title: 'Rubric source could not be structured',
        message: caught instanceof Error ? caught.message : 'The rubric source could not be structured.',
      });
    } finally {
      if (structureRequestRef.current === abort) {
        structureRequestRef.current = null;
        setStructuring(false);
      }
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
    setDirty(true);
    setSaveError(null);
    showToast({
      variant: 'warning',
      title: 'Starter loaded but not saved',
      message: `${template.name} starter loaded. Replace any cue that does not match your evaluator, then confirm with Save rubric.`,
    });
  }

  function updateCriterion(id: string, patch: Partial<EditableCriterion>) {
    setDirty(true);
    setSaveError(null);
    setCriteria((current) => current.map((criterion) => criterion.id === id ? { ...criterion, ...patch } : criterion));
  }

  async function save() {
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

    setSaveError(null);
    if (!activeProjectId) {
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
        setDirty(false);
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
      return;
    }

    const savingProjectId = activeProjectId;
    const savingProjectTitle = projectTitle(activeProject);
    setSaving(true);
    try {
      const response = await requestContract(
        `/api/projects/${encodeURIComponent(savingProjectId)}/rubric`,
        ConfirmRubricResponseSchema,
        jsonRequest('PUT', {
          sourceType,
          criteria: cleaned.map(({ name, description, requiredEvidence, displayOrder }) => ({
            name,
            description,
            requiredEvidence,
            displayOrder,
          })),
        }),
      );
      if (response.rubric.projectId !== savingProjectId
        || response.criteria.some((criterion) => criterion.rubricId !== response.rubric.id)) {
        throw new Error('The server saved a different project rubric. Nothing from it was shown.');
      }
      if (activeProjectIdRef.current !== savingProjectId) return;

      const sourceExcerptByOrder = new Map(cleaned.map((criterion) => [
        criterion.displayOrder,
        criterion.sourceExcerpt,
      ]));
      const savedCriteria = [...response.criteria]
        .sort((left, right) => left.displayOrder - right.displayOrder)
        .map((criterion) => ({
          id: criterion.id,
          name: criterion.name,
          description: criterion.description,
          evidence: criterion.requiredEvidence.join(', '),
          sourceExcerpt: sourceExcerptByOrder.get(criterion.displayOrder) ?? null,
        }));
      setCriteria(savedCriteria);
      setProjectState((current) => current.status === 'ready' && current.projectId === savingProjectId
        ? {
            status: 'ready',
            projectId: savingProjectId,
            workspace: {
              ...current.workspace,
              rubric: response.rubric,
              criteria: response.criteria,
            },
            error: null,
          }
        : current);
      setDirty(false);
      showToast({
        variant: 'positive',
        title: 'Rubric saved',
        message: `${savedCriteria.length} confirmed criteria saved to ${savingProjectTitle}.`,
      });
    } catch (caught) {
      if (activeProjectIdRef.current !== savingProjectId) return;
      const message = caught instanceof Error ? caught.message : 'The selected project rubric could not be saved.';
      setSaveError(message);
      if (/cannot be replaced after practice attempts/iu.test(message)) {
        setServerLockedProjectId(savingProjectId);
      }
      showToast({ variant: 'negative', title: 'Rubric not saved', message });
    } finally {
      // Clearing this flag is safe for either outcome: if the user stayed on
      // this project the request is finished; if history changed projects the
      // selection effect already reset it and this is an idempotent clear.
      setSaving(false);
    }
  }

  return <section className="view is-visible" aria-labelledby="rubricTitle">
    <header className="page-header compact-header">
      <div><p className="overline">Evaluation criteria</p><h1 id="rubricTitle">Modify rubric</h1></div>
    </header>

    {!selectionResolving && projects.length > 1 && <div className="project-switcher">
      <label htmlFor="rubricProject">Project</label>
      <select
        id="rubricProject"
        value={activeProjectId ?? ''}
        disabled={saving}
        onChange={(event) => chooseProject(event.target.value)}
      >
        {projects.map((summary) => <option key={summary.project.id} value={summary.project.id}>{summary.project.title}</option>)}
      </select>
      <span className="project-switcher-meta">The URL, rubric, practice, and saved evidence stay with this project.</span>
    </div>}

    {selectionNotice && <p className="empty-list" role="status">{selectionNotice}</p>}

    {(selectionResolving || (activeProjectId && projectDetailStatus === 'loading')) && (
      <section className="surface" role="status" aria-live="polite" aria-busy="true">
        <p className="empty-list">{selectionResolving
          ? 'Checking which project owns this rubric…'
          : `Loading ${projectTitle(activeProject)}’s saved rubric…`}</p>
      </section>
    )}

    {!selectionResolving && activeProjectId && projectDetailStatus === 'error' && projectState.status === 'error' && (
      <section className="surface" role="alert">
        <h2>{projectTitle(activeProject)} could not be loaded</h2>
        <p>{projectState.error}</p>
        <button className="button button-secondary" type="button" onClick={() => setProjectRequestVersion((version) => version + 1)}>Try again</button>
      </section>
    )}

    {!selectionResolving && (!activeProjectId || selectedWorkspace) && <div className="rubric-layout">
      <section className="surface rubric-editor-card" aria-busy={saving}>
        <h2>{projectTitle(activeProject)}</h2>
        {activeProjectId && locked && <div className="empty-list" id="rubricLockedNotice" role="status">
          <strong>Rubric locked after saved practice.</strong> To keep earlier evidence traceable, this project&rsquo;s rubric cannot be replaced after an attempt is saved.
        </div>}
        {activeProjectId && !locked && selectedWorkspace?.rubric?.confirmedAt && (
          <p className="rubric-library-lede">{selectedWorkspace.criteria.length} confirmed {selectedWorkspace.criteria.length === 1 ? 'criterion is' : 'criteria are'} loaded from this project.</p>
        )}
        {activeProjectId && !locked && selectedWorkspace?.rubric && !selectedWorkspace.rubric.confirmedAt && (
          <p className="rubric-library-lede">This project rubric has not been confirmed yet. Review every row before saving it.</p>
        )}
        {activeProjectId && !locked && !selectedWorkspace?.rubric && (
          <p className="rubric-library-lede">No rubric is saved to this project yet. The starter rows below remain unsaved until you confirm them.</p>
        )}
        <section className="rubric-library" aria-labelledby="rubricLibraryTitle">
          <h3 id="rubricLibraryTitle">Begin from a familiar evaluation context</h3>
          {/* A starter is not the evaluator's rubric, and a student who mistakes
              one for the other rehearses against the wrong thing. */}
          <p className="rubric-library-lede">These are editable starting points, not official scoring rubrics. Use the evaluator&rsquo;s published matrix whenever one exists.</p>
          <div className="rubric-template-list">{RUBRIC_TEMPLATES.map((template) => <button
            aria-pressed={selectedTemplate === template.id}
            className={selectedTemplate === template.id ? 'is-selected' : ''}
            disabled={editorDisabled}
            key={template.id}
            type="button"
            onClick={() => applyTemplate(template)}
          ><strong>{template.name}</strong><span>{template.context}</span></button>)}</div>
        </section>
        <details className="rubric-import">
          <summary>Import from a scoring matrix</summary>
          <p className="rubric-import-lede">Paste published evaluator criteria. Talk-Active structures the source, but you confirm every row before it is saved.</p>
          <textarea rows={6} maxLength={8_000} disabled={editorDisabled} aria-label="Paste the scoring matrix" value={source} onChange={(event) => {
            setSource(event.target.value);
            setDirty(true);
          }} />
          <button type="button" disabled={editorDisabled || structuring || !source.trim()} onClick={() => void structureSource()}>{structuring ? 'Structuring…' : 'Structure these criteria'}</button>
        </details>
        <p className="rubric-list-lede">Add up to {MAX_CRITERIA_ROWS} criteria, each with observable evidence cues.</p>
        <div className="rubric-list">{criteria.map((criterion) => <div className="rubric-row" key={criterion.id}>
          <div className="rubric-field"><label htmlFor={`criterion-${criterion.id}`}>Criterion</label><input id={`criterion-${criterion.id}`} disabled={editorDisabled} placeholder="e.g. Achievement evidence" value={criterion.name} onChange={(event) => updateCriterion(criterion.id, { name: event.target.value })} /></div>
          <div className="rubric-field"><label htmlFor={`evidence-${criterion.id}`}>Observable evidence cues</label><input id={`evidence-${criterion.id}`} disabled={editorDisabled} placeholder="e.g. metrics, dates, named source" value={criterion.evidence} onChange={(event) => updateCriterion(criterion.id, { evidence: event.target.value })} /></div>
          {criterion.sourceExcerpt && <p className="production-source-quote">Source: “{criterion.sourceExcerpt}”</p>}
          <button className="remove-criterion" type="button" disabled={editorDisabled} aria-label={`Remove ${criterion.name || 'empty criterion'}`} onClick={() => {
            setDirty(true);
            setCriteria((current) => current.filter((item) => item.id !== criterion.id));
          }}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" /></svg>
          </button>
        </div>)}</div>
        <button className="add-criterion" type="button" disabled={editorDisabled || criteria.length >= MAX_CRITERIA_ROWS} onClick={() => {
          setDirty(true);
          setCriteria((current) => [...current, { id: crypto.randomUUID(), name: '', description: '', evidence: '', sourceExcerpt: null }]);
        }}><span>+</span> Add criterion</button>
        {saveError && <p className="empty-list" role="alert">{saveError}</p>}
        <div className="rubric-actions"><button
          className="button button-primary"
          type="button"
          disabled={editorDisabled}
          aria-busy={saving}
          aria-describedby={locked ? 'rubricLockedNotice' : undefined}
          onClick={() => void save()}
        >{saving ? 'Saving rubric…' : 'Save rubric'}</button></div>
      </section>
    </div>}
  </section>;
}
