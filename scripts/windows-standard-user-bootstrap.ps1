[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $Root,

  [Parameter(Mandatory = $true)]
  [string] $Driver,

  [Parameter(Mandatory = $true)]
  [string] $InputFile,

  [Parameter(Mandatory = $true)]
  [string] $DiagnosticFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)

function Resolve-AbsolutePath {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Value,

    [Parameter(Mandatory = $true)]
    [string] $Label
  )

  if (-not [System.IO.Path]::IsPathFullyQualified($Value)) {
    throw "$Label must be absolute."
  }
  return [System.IO.Path]::GetFullPath($Value)
}

function Assert-BoundedPath {
  param(
    [Parameter(Mandatory = $true)]
    [string] $RootPath,

    [Parameter(Mandatory = $true)]
    [string] $Candidate,

    [Parameter(Mandatory = $true)]
    [string] $Label
  )

  $rootPrefix = $RootPath.TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  ) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $Candidate.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "$Label escaped the standard-user root."
  }

  $relative = [System.IO.Path]::GetRelativePath($RootPath, $Candidate)
  $cursor = $RootPath
  foreach ($segment in $relative.Split(
    [char[]] @(
      [System.IO.Path]::DirectorySeparatorChar,
      [System.IO.Path]::AltDirectorySeparatorChar
    ),
    [System.StringSplitOptions]::RemoveEmptyEntries
  )) {
    $cursor = Join-Path $cursor $segment
    if (-not (Test-Path -LiteralPath $cursor)) {
      break
    }
    $item = Get-Item -Force -LiteralPath $cursor
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
      throw "$Label crossed a reparse point."
    }
  }
}

$rootPath = Resolve-AbsolutePath -Value $Root -Label 'Bootstrap root'
$rootItem = Get-Item -Force -LiteralPath $rootPath
if (-not $rootItem.PSIsContainer -or
    ($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
  throw 'Bootstrap root must be a regular directory.'
}
$driverPath = Resolve-AbsolutePath -Value $Driver -Label 'Lifecycle driver'
$inputPath = Resolve-AbsolutePath -Value $InputFile -Label 'Lifecycle input'
$diagnosticPath = Resolve-AbsolutePath -Value $DiagnosticFile -Label 'Lifecycle diagnostic'
foreach ($record in @(
  @{ Path = $driverPath; Label = 'Lifecycle driver' },
  @{ Path = $inputPath; Label = 'Lifecycle input' },
  @{ Path = $diagnosticPath; Label = 'Lifecycle diagnostic' }
)) {
  Assert-BoundedPath -RootPath $rootPath -Candidate $record.Path -Label $record.Label
}
if (-not (Test-Path -LiteralPath $driverPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $inputPath -PathType Leaf)) {
  throw 'Lifecycle bootstrap inputs are unavailable.'
}
if (Test-Path -LiteralPath $diagnosticPath) {
  throw 'Lifecycle diagnostic path must not exist before execution.'
}

try {
  & $driverPath -InputFile $inputPath
  $driverExitCode = $LASTEXITCODE
} catch {
  $message = [string] $_.Exception.Message
  $message = $message.Replace($rootPath, '<standard-user-root>')
  $message = [regex]::Replace($message, '[\u0000-\u001F\u007F]+', ' ').Trim()
  if ($message.Length -gt 1024) {
    $message = $message.Substring(0, 1024)
  }
  $diagnostic = [ordered]@{
    schema_version = 1
    stage = 'driver'
    message = $message
  }
  $temporaryDiagnostic = "$diagnosticPath.$PID.tmp"
  if (Test-Path -LiteralPath $temporaryDiagnostic) {
    throw 'Lifecycle diagnostic temporary path already exists.'
  }
  [System.IO.File]::WriteAllText(
    $temporaryDiagnostic,
    ($diagnostic | ConvertTo-Json -Compress),
    $utf8
  )
  [System.IO.File]::Move($temporaryDiagnostic, $diagnosticPath)
  Write-Error 'Standard-user lifecycle driver failed before producing a normal status.'
  exit 1
}

exit $driverExitCode
