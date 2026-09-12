# Release checklist

Run these before publishing a version:

- `bun run check`: all behavioral tests, typecheck, and dead-code gate.
- `bun run build`: regenerate bundled CLI/extension and license notices; pass the transitive static-startup gate.
- `bun run smoke`: isolated built CLI and real advisory/policy commit probes.
- `bun run verify:package`: npm archive contents, production npm/Bun Git layouts, actual Pi loading, and installed lazy review. No sibling checkout or unexpected host/compiler install.
- `bun run cover`: regenerate the SVG; verify XML, static fallback, reveal, and reduced-motion rendering after visual edits. Keep GitHub display-math blocks balanced and valid.
- Check the pinned registry substrate version and frozen lock. Publish Fovea first when a new substrate release is required.
- Commit source and regenerated `dist/` together; CI rejects generated drift. Use a conventional commit and a version tag, then `bun publish` and a normal push.
- Confirm canonical registry metadata **and tarball** availability after publication; CDN propagation can lag a successful publish response.
- Confirm GitHub visibility, description, topics, links, remote commit/tag, and green CI. Update related documentation/profile links when introducing a new project.
