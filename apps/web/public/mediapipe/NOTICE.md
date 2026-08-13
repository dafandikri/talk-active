# MediaPipe third-party notice

Talk-Active redistributes the following unmodified third-party components so
visual rehearsal can run from the application's own origin:

- the WebAssembly runtime from `@mediapipe/tasks-vision` 1.0.1;
- the MediaPipe Face Landmarker float16 model bundle, version 1; and
- the MediaPipe Pose Landmarker Lite float16 model bundle, version 1.

The JavaScript package imported by the application is the same
`@mediapipe/tasks-vision` component even though its JavaScript is incorporated
into generated application bundles instead of copied into this directory.

## License and attribution

`@mediapipe/tasks-vision` 1.0.1 declares `Apache-2.0` in its installed
`package.json`. Its declaration files carry these attributions:

> Copyright 2022 The MediaPipe Authors.
>
> Copyright 2023 The MediaPipe Authors.

Google's official Face Landmarker overview links the redistributed face bundle
to three constituent model cards (BlazeFace Short Range, Face Mesh V2, and
Blendshape V2); each model card states that the model is licensed under the
Apache License, Version 2.0. Google's official Pose Landmarker overview links
the redistributed pose bundles to the BlazePose GHUM 3D model card, which also
states Apache License, Version 2.0.

The complete Apache License 2.0 text is distributed in
[`LICENSE-APACHE-2.0.txt`](LICENSE-APACHE-2.0.txt). The exact source objects,
immutable Google Cloud Storage generations, upstream object metadata, byte
sizes, SHA-256 digests, package integrity, and license-evidence URLs are in
[`ASSET-MANIFEST.json`](ASSET-MANIFEST.json).

The assets have not been modified. MediaPipe and related names remain the
property of their respective owners; Apache-2.0 does not grant trademark use
beyond describing origin.

## Provenance boundary

The package license conclusion is direct: both the installed package metadata
and the npm registry record for version 1.0.1 declare `Apache-2.0`. The npm
tarball does not itself contain a `LICENSE` or `NOTICE` file, so Talk-Active
supplies the full Apache-2.0 text from the upstream MediaPipe license.

The model conclusion is evidence-backed but not a legal warranty. The GCS
`.task` objects do not contain a separately readable license file or
machine-readable license field. The Apache-2.0 conclusion is based on the
official Google download pages tying each bundle to model cards whose
constituents state Apache-2.0. The Face Landmarker archive also contains a
MediaPipe geometry metadata file that is not separately named in those model
cards. This audit does not independently reconstruct the license graph of every
library compiled into Google's opaque WASM binaries. Obtain upstream or legal
confirmation before relying on this package for redistribution with a stricter
compliance threshold.

No root `NOTICE` file is present in the installed npm package or the upstream
MediaPipe repository at the audited URLs. This notice preserves the copyright
attribution present in the installed package's source-form declarations.

## Runtime privacy note

The installed package's privacy notice says image/video input is processed on
device and is not sent to Google, while separately stating that MediaPipe Tasks
may send performance and utilization metrics to Google. Talk-Active blocks the
package's exact utilization-log endpoint while a vision session is active.
Camera frames and derived observations remain inside the browser;
browser-provided speech recognition may still use the browser vendor's speech
service, which is disclosed before capture.

## Official references

- Package: https://www.npmjs.com/package/@mediapipe/tasks-vision/v/1.0.1
- MediaPipe license: https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE
- Face Landmarker models: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker#models
- Pose Landmarker models: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker#models
- Package privacy notice: https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md#privacy-notice

This notice is informational and does not modify the Apache License 2.0.
