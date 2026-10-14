# ROC Player releases

ROC Player Pro for Fire TV / Android TV:

- **Downloader code: 9204537** (keep this same code for future releases).
- [Download the latest Pro APK](https://github.com/RachidAFL/roc-player-releases/releases/latest/download/roc-player-pro.apk).
- Package: `com.rocplayer.pro`. This is separate from ROC Player (`com.rocplayer.app`).

## Publishing Pro updates

Publish a stable `vX.Y.Z` release with the signed **sideload** APK named exactly
`roc-player-pro.apk`. Bump both Android versionName and versionCode and keep the
existing signing key. Upload assets to a **draft**, then publish the finished release.
Do not overwrite a published version's APK: create a higher version instead.

The Pro download health workflow verifies the APK's package, version, release
certificate and checksum, synchronizes **only Pro update row 1**, and marks the
highest stable Pro version as latest. Existing Pro installations receive the usual
optional update prompt; Android still requires the user to approve installation.
The in-app manifest uses a version-specific URL so its checksum remains valid
while Downloader always follows the permanent latest URL.

Windows and demo releases should be published with `--latest=false`. The workflow
also repairs latest after release events and checks the complete APK and update
feed hourly. Its failure is visible in the repository Actions tab. GitHub service
outages and delayed/disabled Actions can still affect availability; schedules in
public repositories can be disabled after 60 days without repository activity.
Check Actions before a release and re-enable/dispatch the workflow if necessary.

Workflow secrets `PRO_UPDATE_SUPABASE_URL` and `PRO_UPDATE_SUPABASE_KEY` are configured
in this repository. They are never embedded in APKs or committed to source.
Changes to this workflow and its scripts require trusted repository administrators.
This repository contains public release assets, not application source or private backups.
