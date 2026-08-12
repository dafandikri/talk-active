import Link from 'next/link';

import mascot from '../../../../../src/assets/mascot/kato-macaw-reading.svg';

const criteria = ['Problem clarity', 'Solution fit', 'Differentiation', 'Feasibility and trust'];

export default function WorkspaceHomePage() {
  return (
    <section className="view is-visible" aria-labelledby="homeTitle">
      <header className="page-header home-header">
        <div><p className="overline">Your workspace</p><h1 id="homeTitle">Make your next answer harder to challenge.</h1></div>
      </header>

      <section className="focus-card" aria-labelledby="focusTitle">
        <div className="focus-main">
          <div className="project-kicker"><span className="project-avatar">TA</span><span><small>Current project</small><strong>Talk-Active · RISTEK Finals</strong></span></div>
          <h2 id="focusTitle">Your differentiation claim still needs a direct comparison.</h2>
          <p>Rehearse once, inspect the exact evidence behind every verdict, then defend the claim a judge is most likely to challenge.</p>
          <div className="focus-actions">
            <Link className="button button-light" href="/practice">Continue practising</Link>
            <Link className="button button-ghost-light" href="/rubric">Review rubric</Link>
          </div>
        </div>
        <aside className="focus-coach" aria-label="Talk-Active rehearsal guide">
          <img className="focus-mascot" src={mascot.src} alt="" width="1254" height="1254" />
          <p className="coach-bubble">Ready for the hard question?</p>
        </aside>
        <div className="focus-stats">
          <div className="focus-stat"><span>Last evidence coverage</span><strong>—</strong><small>Run the first production attempt</small></div>
          <div className="focus-stat"><span>Needs attention</span><strong className="stat-word">Differentiation</strong><small>From the active finals rubric</small></div>
          <div className="focus-stat"><span>Finals</span><strong className="stat-word">14 Aug</strong><small>Innovation Week</small></div>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="surface next-session" aria-labelledby="nextSessionTitle">
          <div className="section-title-row"><div><p className="overline">Recommended session</p><h2 id="nextSessionTitle">A focused 5-minute drill</h2></div><span className="time-pill">5 min</span></div>
          <ol className="session-plan">
            <li><span>1</span><div><strong>Deliver your current pitch</strong><small>Paste one complete attempt.</small></div></li>
            <li><span>2</span><div><strong>Inspect one unsupported claim</strong><small>Trace it to the active rubric.</small></div></li>
            <li><span>3</span><div><strong>Defend it under pressure</strong><small>Answer one grounded follow-up.</small></div></li>
          </ol>
        </section>
        <section className="surface rubric-health" aria-labelledby="rubricHealthTitle">
          <div className="section-title-row"><div><p className="overline">Preparation</p><h2 id="rubricHealthTitle">Rubric readiness</h2></div><span className="health-ring">4</span></div>
          <p>Every verdict stays grounded in these evaluator priorities.</p>
          <div className="mini-criteria">{criteria.map((criterion) => <div className="mini-criterion" key={criterion}><i /><span>{criterion}</span></div>)}</div>
          <Link className="text-button" href="/rubric">Edit evaluation criteria <span aria-hidden="true">→</span></Link>
        </section>
      </div>
      <section className="surface recent-section" aria-labelledby="recentTitle">
        <div className="section-title-row"><div><p className="overline">Practice log</p><h2 id="recentTitle">Recent sessions</h2></div><Link className="text-button" href="/progress">View all</Link></div>
        <p className="empty-list">No rehearsals saved yet. Complete one practice attempt and its traceable evidence will appear here.</p>
      </section>
    </section>
  );
}
