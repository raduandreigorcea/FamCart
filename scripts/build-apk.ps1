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

Set-Location (Join-Path $root 'android')
.\gradlew.bat assembleDebug
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$apk = Join-Path $root 'android\app\build\outputs\apk\debug\app-debug.apk'
Write-Host ''
Write-Host "APK ready: $apk"
