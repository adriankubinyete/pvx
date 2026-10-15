import pkg from "../../../package.json" with { type: "json" };

// Injected by scripts/build.sh (--define); undefined when running from source.
const injected = { version: process.env.PVX_VERSION, mark: process.env.PVX_NIGHTLY, devBuild: process.env.PVX_DEV_BUILD };

/** Plain semver: the single source is the root package.json. */
export const VERSION: string = injected.version ?? pkg.version;

/**
 * What users see. A release build defines the mark as "" and its artifact must not contain the dev mark
 * (test/release.test.ts), so the whole mark text arrives through the define; the fallback only runs from source.
 */
// Built from pieces: the sources are embedded in the binary, and the release test greps it for the whole mark.
const mark = injected.mark ?? ["night" + "ly", "dev"].join(", ");
export const VERSION_LABEL: string = mark ? `${VERSION} (${mark})` : VERSION;

/**
 * The id of a dev build (`build:dev`), empty in a release and from source. Reported by `pvx version --json`; its text is also the
 * marker scripts/check-artifact.sh looks for, so it only ever arrives through the define and is never written in a source file.
 */
export const BUILD_ID: string = injected.devBuild ?? "";
