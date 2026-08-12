# MediaPipe runtime assets

This directory contains the WebAssembly runtime distributed with
`@mediapipe/tasks-vision` 1.0.1 and the official MediaPipe Face Landmarker and
Pose Landmarker Lite model assets.

- Runtime source: https://www.npmjs.com/package/@mediapipe/tasks-vision/v/1.0.1
- Face model source: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- Pose model source: https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
- License: Apache License 2.0 — https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE

The files are hosted with the application so a rehearsal never depends on a
third-party model download during the demo. MediaPipe's package privacy notice
states that input processing happens on-device and separately describes
performance/utilization metrics: https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md#privacy-notice

Talk-Active blocks the package's exact utilization-log endpoint while a vision
session is active. Camera frames and derived observations remain inside the
browser; browser-provided speech recognition may still use the browser vendor's
speech service, which is disclosed before capture.
