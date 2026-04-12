param(
  [switch]$Release
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

# Prefer existing JAVA_HOME, otherwise use Android Studio's bundled Java.
if (-not $env:JAVA_HOME -or -not (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
  $javaCandidates = @(
    'C:\Program Files\Android\Android Studio\jbr',
    'C:\Program Files\Android\Android Studio\jre'
  )

  $resolvedJavaHome = $javaCandidates | Where-Object { Test-Path (Join-Path $_ 'bin\java.exe') } | Select-Object -First 1

  if (-not $resolvedJavaHome) {
    throw 'JAVA_HOME is not set and Android Studio bundled Java was not found. Install Android Studio or set JAVA_HOME manually.'
  }

  $env:JAVA_HOME = $resolvedJavaHome
}

if ($env:Path -notlike "*$($env:JAVA_HOME)\\bin*") {
  $env:Path = "$($env:JAVA_HOME)\bin;$($env:Path)"
}

Write-Host "Using JAVA_HOME: $($env:JAVA_HOME)"

if ($Release) {
  if (Test-Path Env:VITE_DEBUG_OVERLAY) {
    Remove-Item Env:VITE_DEBUG_OVERLAY
  }
} else {
  $env:VITE_DEBUG_OVERLAY = '1'
  Write-Host 'Enabled VITE_DEBUG_OVERLAY=1 for debug APK build.'
}

npm run mobile:build

# --- Release: ensure keystore + key.properties exist ---
if ($Release) {
  $keyPropertiesFile = Join-Path $repoRoot 'android\app\key.properties'
  $keystoreFile      = Join-Path $repoRoot 'android\famcart-release.jks'

  if (-not (Test-Path $keyPropertiesFile)) {
    Write-Host ''
    Write-Host 'No key.properties found. Setting up release signing...'

    if (-not (Test-Path $keystoreFile)) {
      Write-Host 'Generating new keystore at android\famcart-release.jks'
      Write-Host 'You will be prompted for passwords and distinguished name details.'
      Write-Host ''

      & "$($env:JAVA_HOME)\bin\keytool" `
        -genkey -v `
        -keystore $keystoreFile `
        -keyalg RSA -keysize 2048 -validity 10000 `
        -alias famcart-key

      if ($LASTEXITCODE -ne 0) { throw 'keytool failed. Keystore was not created.' }
    }

    Write-Host ''
    $storePass = Read-Host 'Enter keystore password (storePassword)' -AsSecureString
    $keyPass   = Read-Host 'Enter key password     (keyPassword)'   -AsSecureString

    $storePassPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
      [Runtime.InteropServices.Marshal]::SecureStringToBSTR($storePass))
    $keyPassPlain   = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
      [Runtime.InteropServices.Marshal]::SecureStringToBSTR($keyPass))

    $relativePath = [System.IO.Path]::GetRelativePath(
      (Join-Path $repoRoot 'android\app'), $keystoreFile)

    @"
storeFile=$($relativePath -replace '\\','/')
storePassword=$storePassPlain
keyAlias=famcart-key
keyPassword=$keyPassPlain
"@ | Set-Content -Encoding UTF8 -Path $keyPropertiesFile

    Write-Host "key.properties written to android\app\key.properties"
  }
}

Push-Location 'android'
try {
  if ($Release) {
    .\gradlew assembleRelease
  } else {
    .\gradlew assembleDebug
  }
}
finally {
  Pop-Location
}

if ($Release) {
  $apkPath = Join-Path $repoRoot 'android\app\build\outputs\apk\release\app-release.apk'
} else {
  $apkPath = Join-Path $repoRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
}
if (-not (Test-Path $apkPath)) {
  throw "APK was not generated at expected path: $apkPath"
}

$apk = Get-Item $apkPath
Write-Host ''
Write-Host 'APK ready:'
Write-Host "Path: $($apk.FullName)"
Write-Host "Size: $([math]::Round($apk.Length / 1MB, 2)) MB"
Write-Host "Updated: $($apk.LastWriteTime)"