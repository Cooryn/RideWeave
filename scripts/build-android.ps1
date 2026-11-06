param(
    [Parameter(Mandatory)]
    [ValidateSet('x86_64', 'aarch64')]
    [string]$Target,
    [switch]$DebugBuild
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
if (-not $DebugBuild -and (-not $env:RIDEWEAVE_ANDROID_STORE -or -not $env:RIDEWEAVE_ANDROID_PASSWORD)) {
    throw 'Set RIDEWEAVE_ANDROID_STORE and RIDEWEAVE_ANDROID_PASSWORD to sign the release APK.'
}

$root = Split-Path -Parent $PSScriptRoot
$androidProject = Join-Path $root 'src-tauri/gen/android'
$buildLog = [IO.Path]::GetTempFileName()
$profile = if ($DebugBuild) { 'debug' } else { 'release' }
$buildType = if ($DebugBuild) { 'Debug' } else { 'Release' }
$flavor = if ($Target -eq 'aarch64') { 'Arm64' } else { 'X86_64' }
$abi = if ($Target -eq 'aarch64') { 'arm64-v8a' } else { 'x86_64' }

Push-Location $root
try {
    $buildArgs = @('run', 'tauri', 'android', 'build', '--', '--apk', '--split-per-abi', '--target', $Target, '--features', 'custom-protocol')
    if ($DebugBuild) { $buildArgs += '--debug' }
    & npm.cmd @buildArgs 2>&1 | Tee-Object -FilePath $buildLog
    if ($LASTEXITCODE -eq 0) { return }
    if (-not (Select-String -LiteralPath $buildLog -Pattern 'Failed to create a symbolic link' -Quiet)) {
        throw 'Tauri Android build failed. See the output above.'
    }

    $library = Join-Path $root "src-tauri/target/$Target-linux-android/$profile/librideweave_lib.so"
    $jni = Join-Path $androidProject "app/src/main/jniLibs/$abi"
    New-Item -ItemType Directory -Path $jni -Force | Out-Null
    $stagedLibrary = Join-Path $jni 'librideweave_lib.so'
    Copy-Item -LiteralPath $library -Destination $stagedLibrary -Force
    if ($DebugBuild -and $env:NDK_HOME) {
        $strip = Join-Path $env:NDK_HOME 'toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip.exe'
        & $strip --strip-debug $stagedLibrary
        if ($LASTEXITCODE -ne 0) { throw 'Could not strip debug symbols from the staged library.' }
    }
    & (Join-Path $androidProject 'gradlew.bat') -p $androidProject ":app:assemble$flavor$buildType" `
        -x ":app:rustBuild$flavor$buildType" --console=plain '-Pkotlin.compiler.execution.strategy=in-process'
    if ($LASTEXITCODE -ne 0) { throw 'Gradle APK packaging failed. See the output above.' }
} finally {
    Pop-Location
    Remove-Item -LiteralPath $buildLog -ErrorAction SilentlyContinue
}
