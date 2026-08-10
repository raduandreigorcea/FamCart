# Builds the Android debug APK: web build -> capacitor sync -> gradle.
# Run via `npm run build:apk`.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# Gradle needs a JDK; Android Studio ships one. Respect an existing JAVA_HOME.
if (-not $env:JAVA_HOME) {
  $studioJbr = 'C:\Program Files\Android\Android Studio\jbr'
  if (Test-Path "$studioJbr\bin\java.exe") {
    $env:JAVA_HOME = $studioJbr
  } else {
    Write-Error 'No JAVA_HOME set and Android Studio JDK not found. Install Android Studio or set JAVA_HOME.'
  }
}

npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx cap sync android
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# assembleRelease so a local build is the same shape as the published one: not
# debuggable, and signed with the release key if FAMCART_KEYSTORE_FILE and its
# three companions are set in this shell. Without them the build falls back to
# the debug key (see android/app/build.gradle) — installable on the phone in
# front of you, but not over a copy installed from GitHub, because Android will
# not accept an APK signed by a different key than the one already there.
Set-Location (Join-Path $root 'android')
.\gradlew.bat assembleRelease
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$apk = Join-Path $root 'android\app\build\outputs\apk\release\app-release.apk'
Write-Host ''
Write-Host "APK ready: $apk"
