# Replay timeline contract

For the "click a filler, watch that moment again" work on `farrel-dev`.

Everything below already exists in the integration tree. `filler-cues.ts`,
`speech-disruptions.ts`, and its test did not survive the first merge and were put
back in `9327bd1`; build against those, not against a local copy.

---

## What you seek against

Two producers emit timestamped events, and they deliberately share a shape:

```ts
{ startMs: number; endMs: number; durationMs: number; label: string }
```

Anything carrying that shape can drive the same scrubber. You do not need a third
format, and you should not invent one.

### Speech disruptions — `apps/web/lib/rehearsal/speech-disruptions.ts`

```ts
interface SpeechDisruptionEvent {
  kind: 'prolonged-voicing' | 'repeated-start' | 'interim-filler';
  source: 'acoustic' | 'interim-transcript' | 'combined';
  startMs: number;
  endMs: number;
  durationMs: number;
  label: string;    // user-facing, e.g. "um with an acoustic cue"
  evidence: string; // why the detector fired
}
```

`SpeechDisruptionDetector` reads `DisruptionAudioSample` frames (`timestampMs`,
`rms`, `pitchHz`, `quiet`). `InterimFillerTracker` reads interim dictation.
`mergeSpeechDisruptionEvents(...groups)` combines them: events from different
sources within **700 ms** of each other collapse into one `source: 'combined'`
event spanning both. Call it once with both groups rather than concatenating —
otherwise one filler shows up twice on the timeline, once per detector.

The merged array is sorted by `startMs`. Treat that ordering as guaranteed.

### Vision events — `apps/web/lib/vision/types.ts`

```ts
interface VisionEvent {
  kind: 'face_out_of_frame' | 'head_turned_away' | 'body_out_of_frame'
      | 'gesture_burst' | 'position_change' | 'torso_angle_change';
  startMs: number; endMs: number; durationMs: number; label: string;
}
```

Reachable at `visionSummary.events`. `VisionSessionSummary` also carries
`durationMs`, `sampledFrames`, `measuredFrames`, and `limitations`.

### Word-level positions — `apps/web/lib/rehearsal/filler-cues.ts`

`findFillerCues(text)` returns `{ label, tokenIndexes }`. These are **token
indexes, not milliseconds.** They locate a filler inside a transcript string;
they do not locate it in time. To place a word on the timeline you need the
timing from `SpeechDisruptionEvent`, not from here. Mixing the two is the easiest
way to end up with a scrubber that lands 400 ms off.

---

## Two things worth getting right

**`startMs` is relative to capture start, not to the video element.** If recording
begins after the observers do, every seek is offset by the gap. Capture one
`t0` when the recorder actually starts and subtract it, or record and observe
from the same start call.

**A merged event spans both detectors.** After `mergeSpeechDisruptionEvents`, a
`combined` event's `startMs` is the earlier of the two and `endMs` the later, so
its `durationMs` can be longer than either detector saw alone. Seeking to
`startMs` is right. Trusting `durationMs` as "how long the filler was" is not.

A small lead-in helps: seek to `Math.max(0, startMs - 400)` so the viewer hears
the run-up rather than landing mid-vowel.

---

## The privacy boundary

The product invariant in `AGENTS.md` reads:

> Raw audio is not persisted. Production needs consent, expiry, and deletion.

Note the shape of that sentence. It is a **condition, not a prohibition** — the
second clause tells you what persistence costs. Video is more sensitive than
audio, so the condition applies at least as strongly.

Vercel Blob can meet it, and it is a better fit than a database column, because
private access and lifecycle are platform features rather than retention code you
have to write and defend. What has to be true before this ships:

1. **Consent before capture, not after.** The recording indicator and the
   retention window stated where the user starts the take, not buried in a
   policy page.
2. **A stated expiry, enforced.** Pick a window and make the deletion real.
   "We delete it eventually" fails INV-4 the moment a judge asks what "eventually"
   means.
3. **A deletion path the user can reach.** One control, visible, that works.
4. **Private by default.** A publicly-addressable URL to somebody's rehearsal is
   the worst possible finding at a booth.
5. **The disclosure text updated in the same commit.** Today the app states no
   recording is stored. Shipping storage without changing that sentence turns a
   true statement into a false one, which is INV-4 and INV-2 at once.

Confirm the current Blob API against the Vercel docs rather than from memory —
private blobs are a relatively recent addition and most examples still show the
public path.

### If the window is too tight

Hold the recording in memory or IndexedDB for the session and seek locally. The
replay does not survive a reload, but the invariant stays untouched, no consent
copy has to be written, and there is nothing to delete. For a demo where each
visitor does one take at a booth, that is most of the value at none of the risk.
Worth considering as the first version even if server storage is the goal.

---

## Checks that already cover this

- `apps/web/lib/rehearsal/speech-disruptions.test.ts` — 14 checks on the
  detectors and the merge window.
- `test/mediapipe-assets.test.mjs` — the WASM and model files stay same-origin.
  INV-8 fails the demo gate on any resource loaded from another origin, so do not
  move these to a CDN.
- `e2e/production-ui/multimodal.spec.ts` — capture at 390 px.

Add the replay to the multimodal spec rather than a new file. The demo gate reads
console errors during that run, and a seek that throws will surface there.
