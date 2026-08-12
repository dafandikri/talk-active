# Visual rehearsal engine

`createVisionSession()` runs one on-device MediaPipe model and exposes a small
start/stop API. Interview mode uses Face Landmarker; presentation mode uses Pose
Landmarker Lite. Frames are sampled, measured, and discarded. Only landmark-derived
summaries and timestamped events leave the engine.

The browser must be served these files from the same origin:

```text
/mediapipe/wasm/vision_wasm_internal.js
/mediapipe/wasm/vision_wasm_internal.wasm
/mediapipe/wasm/vision_wasm_nosimd_internal.js
/mediapipe/wasm/vision_wasm_nosimd_internal.wasm
/mediapipe/wasm/vision_wasm_module_internal.js
/mediapipe/wasm/vision_wasm_module_internal.wasm
/mediapipe/models/face_landmarker.task
/mediapipe/models/pose_landmarker_lite.task
```

The WASM filenames must not be changed because `FilesetResolver` selects SIMD support
at runtime. The default model paths can be overridden through `assets`.

```ts
const session = createVisionSession({
  mode: "presentation",
  onFrame: drawLandmarks,
});

await session.start({ video, stream: sharedAudioVideoStream });
const summary = session.stop();
session.dispose();
```

A caller-provided stream remains caller-owned. When no stream is supplied, the engine
requests a video-only stream and stops its tracks during `stop()`.
