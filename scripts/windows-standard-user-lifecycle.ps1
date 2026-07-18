[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $InputFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$allowedEnvironmentNames = @(
  'SystemRoot',
  'WINDIR',
  'COMSPEC',
  'SystemDrive',
  'PATHEXT',
  'PATH',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'LOCALAPPDATA',
  'APPDATA'
)
$maximumLogBytes = 65536
$utf8 = [System.Text.UTF8Encoding]::new($false)

function Assert-ExactProperties {
  param(
    [Parameter(Mandatory = $true)] $Value,
    [Parameter(Mandatory = $true)] [string[]] $Expected,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  $actual = @($Value.PSObject.Properties.Name | Sort-Object)
  $wanted = @($Expected | Sort-Object)
  if (Compare-Object -ReferenceObject $wanted -DifferenceObject $actual) {
    throw "$Label has an unexpected shape."
  }
}

function Resolve-ContractPath {
  param(
    [Parameter(Mandatory = $true)] [string] $Value,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  if (-not [System.IO.Path]::IsPathFullyQualified($Value)) {
    throw "$Label must be absolute."
  }
  return [System.IO.Path]::GetFullPath($Value)
}

function Assert-WithinRoot {
  param(
    [Parameter(Mandatory = $true)] [string] $Root,
    [Parameter(Mandatory = $true)] [string] $Candidate,
    [Parameter(Mandatory = $true)] [string] $Label,
    [switch] $AllowRoot
  )

  $rootWithSeparator = $Root.TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  ) + [System.IO.Path]::DirectorySeparatorChar
  $inside = $Candidate.StartsWith(
    $rootWithSeparator,
    [System.StringComparison]::OrdinalIgnoreCase
  )
  if (-not $inside -and (-not $AllowRoot -or -not $Candidate.Equals(
    $Root,
    [System.StringComparison]::OrdinalIgnoreCase
  ))) {
    throw "$Label escaped the standard-user root."
  }
}

function Assert-NoReparseComponents {
  param(
    [Parameter(Mandatory = $true)] [string] $Root,
    [Parameter(Mandatory = $true)] [string] $Candidate,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  Assert-WithinRoot -Root $Root -Candidate $Candidate -Label $Label -AllowRoot
  $relative = [System.IO.Path]::GetRelativePath($Root, $Candidate)
  $cursor = $Root
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

function Resolve-ArgumentPath {
  param(
    [Parameter(Mandatory = $true)] [string] $Argument,
    [Parameter(Mandatory = $true)] [string] $Prefix,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  if (-not $Argument.StartsWith($Prefix, [System.StringComparison]::Ordinal)) {
    throw "$Label argument is invalid."
  }
  return Resolve-ContractPath -Value $Argument.Substring($Prefix.Length) -Label $Label
}

function Write-NewBoundedUtf8File {
  param(
    [Parameter(Mandatory = $true)] [string] $Path,
    [Parameter(Mandatory = $true)] [string] $Value,
    [Parameter(Mandatory = $true)] [string] $Label
  )

  $bytes = $utf8.GetBytes($Value)
  if ($bytes.Length -gt $maximumLogBytes) {
    throw "$Label exceeded the bounded log limit."
  }
  $stream = [System.IO.File]::Open(
    $Path,
    [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::Write,
    [System.IO.FileShare]::None
  )
  try {
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  } finally {
    $stream.Dispose()
  }
  return $bytes.Length
}

$inputPath = Resolve-ContractPath -Value $InputFile -Label 'Lifecycle input'
if (-not (Test-Path -LiteralPath $inputPath -PathType Leaf)) {
  throw 'Lifecycle input is unavailable.'
}
$contract = Get-Content -Raw -LiteralPath $inputPath | ConvertFrom-Json
Assert-ExactProperties -Value $contract -Label 'Lifecycle input' -Expected @(
  'schema_version',
  'nonce',
  'expected_sid',
  'ephemeral_root',
  'node_path',
  'working_directory',
  'script_path',
  'arguments',
  'environment',
  'stdout_path',
  'stderr_path',
  'status_path',
  'lifecycle_report_path',
  'timeout_ms'
)
if ($contract.schema_version -ne 1) {
  throw 'Lifecycle input schema version is unsupported.'
}
if ($contract.nonce -notmatch '^[0-9a-f]{32}$') {
  throw 'Lifecycle input nonce is invalid.'
}
if ($contract.expected_sid -notmatch '^S-1-5-21-(?:[0-9]+-){3}[0-9]+$') {
  throw 'Lifecycle input SID is invalid.'
}
if ($contract.timeout_ms -ne 300000) {
  throw 'Lifecycle input timeout is invalid.'
}

$ephemeralRoot = Resolve-ContractPath -Value $contract.ephemeral_root -Label 'Ephemeral root'
$rootItem = Get-Item -LiteralPath $ephemeralRoot
if (-not $rootItem.PSIsContainer -or ($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
  throw 'Ephemeral root must be a regular directory.'
}
$nodePath = Resolve-ContractPath -Value $contract.node_path -Label 'Node executable'
$workingDirectory = Resolve-ContractPath -Value $contract.working_directory -Label 'Working directory'
$scriptPath = Resolve-ContractPath -Value $contract.script_path -Label 'Lifecycle script'
$stdoutPath = Resolve-ContractPath -Value $contract.stdout_path -Label 'Lifecycle stdout'
$stderrPath = Resolve-ContractPath -Value $contract.stderr_path -Label 'Lifecycle stderr'
$statusPath = Resolve-ContractPath -Value $contract.status_path -Label 'Lifecycle status'
$lifecycleReportPath = Resolve-ContractPath -Value $contract.lifecycle_report_path -Label 'Lifecycle report'
foreach ($record in @(
  @{ Path = $nodePath; Label = 'Node executable' },
  @{ Path = $workingDirectory; Label = 'Working directory' },
  @{ Path = $scriptPath; Label = 'Lifecycle script' },
  @{ Path = $stdoutPath; Label = 'Lifecycle stdout' },
  @{ Path = $stderrPath; Label = 'Lifecycle stderr' },
  @{ Path = $statusPath; Label = 'Lifecycle status' },
  @{ Path = $lifecycleReportPath; Label = 'Lifecycle report' },
  @{ Path = $inputPath; Label = 'Lifecycle input' }
)) {
  Assert-WithinRoot -Root $ephemeralRoot -Candidate $record.Path -Label $record.Label
  Assert-NoReparseComponents -Root $ephemeralRoot -Candidate $record.Path -Label $record.Label
}
if ((-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) -or
    (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) -or
    (-not (Test-Path -LiteralPath $workingDirectory -PathType Container))) {
  throw 'Lifecycle executable inputs are unavailable.'
}
foreach ($newOutput in @($stdoutPath, $stderrPath, $statusPath, $lifecycleReportPath)) {
  if (Test-Path -LiteralPath $newOutput) {
    throw 'Lifecycle output path must not exist before execution.'
  }
}

Assert-ExactProperties -Value $contract.environment -Expected $allowedEnvironmentNames -Label 'Lifecycle environment'
foreach ($name in $allowedEnvironmentNames) {
  if ($contract.environment.$name -isnot [string] -or [string]::IsNullOrWhiteSpace($contract.environment.$name)) {
    throw "Lifecycle environment value is invalid: $name."
  }
}
foreach ($name in @('TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA')) {
  $environmentPath = Resolve-ContractPath -Value $contract.environment.$name -Label "Lifecycle environment $name"
  if (-not $environmentPath.Equals($ephemeralRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Lifecycle environment $name escaped the standard-user root."
  }
}

$arguments = @($contract.arguments)
if ($arguments.Count -ne 6 -or @(
  $arguments | Where-Object { $_ -isnot [string] -or [string]::IsNullOrWhiteSpace($_) }
).Count -ne 0) {
  throw 'Lifecycle arguments are invalid.'
}
if (($arguments[0] -ne '--target=windows-x64') -or
    ($arguments[3] -ne "--ephemeral-root=$ephemeralRoot") -or
    ($arguments[5] -ne "--out=$lifecycleReportPath")) {
  throw 'Lifecycle arguments do not match the bounded Windows contract.'
}
$candidatePackage = Resolve-ArgumentPath -Argument $arguments[1] -Prefix '--candidate-package=' -Label 'Candidate package'
$installRoot = Resolve-ArgumentPath -Argument $arguments[2] -Prefix '--install-root=' -Label 'Install root'
$workspace = Resolve-ArgumentPath -Argument $arguments[4] -Prefix '--workspace=' -Label 'Lifecycle workspace'
foreach ($record in @(
  @{ Path = $candidatePackage; Label = 'Candidate package' },
  @{ Path = $installRoot; Label = 'Install root' },
  @{ Path = $workspace; Label = 'Lifecycle workspace' }
)) {
  Assert-WithinRoot -Root $ephemeralRoot -Candidate $record.Path -Label $record.Label
  Assert-NoReparseComponents -Root $ephemeralRoot -Candidate $record.Path -Label $record.Label
}
if ((-not (Test-Path -LiteralPath $candidatePackage -PathType Leaf)) -or
    (-not (Test-Path -LiteralPath $installRoot -PathType Container)) -or
    (Test-Path -LiteralPath $workspace)) {
  throw 'Lifecycle argument paths do not match their expected states.'
}

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
if ($identity.User.Value -ne $contract.expected_sid) {
  throw 'Standard-user lifecycle did not run as the expected temporary user.'
}
$principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
$isAdministrator = $principal.IsInRole(
  [System.Security.Principal.WindowsBuiltInRole]::Administrator
)
if ($isAdministrator) {
  throw 'Standard-user lifecycle unexpectedly received an administrator token.'
}

$processInfo = [System.Diagnostics.ProcessStartInfo]::new()
$processInfo.FileName = $nodePath
$processInfo.WorkingDirectory = $workingDirectory
$processInfo.UseShellExecute = $false
$processInfo.CreateNoWindow = $true
$processInfo.RedirectStandardOutput = $true
$processInfo.RedirectStandardError = $true
$processInfo.Environment.Clear()
foreach ($name in $allowedEnvironmentNames) {
  $processInfo.Environment[$name] = $contract.environment.$name
}
$processInfo.ArgumentList.Add($scriptPath)
foreach ($argument in $arguments) {
  $processInfo.ArgumentList.Add($argument)
}

$process = $null
try {
  $process = [System.Diagnostics.Process]::Start($processInfo)
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit([int] $contract.timeout_ms)) {
    $process.Kill($true)
    if (-not $process.WaitForExit(15000)) {
      throw 'Standard-user Windows lifecycle timed out and tracked shutdown could not be confirmed.'
    }
    throw 'Standard-user Windows lifecycle timed out.'
  }
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  $exitCode = $process.ExitCode
} finally {
  if ($null -ne $process) {
    $process.Dispose()
  }
}

$stdoutBytes = Write-NewBoundedUtf8File -Path $stdoutPath -Value $stdout -Label 'Lifecycle stdout'
$stderrBytes = Write-NewBoundedUtf8File -Path $stderrPath -Value $stderr -Label 'Lifecycle stderr'
$status = [ordered]@{
  schema_version = 1
  nonce = $contract.nonce
  sid = $identity.User.Value
  is_admin = $isAdministrator
  exit_code = $exitCode
  stdout_bytes = $stdoutBytes
  stderr_bytes = $stderrBytes
}
$statusTemporaryPath = "$statusPath.$PID.tmp"
if (Test-Path -LiteralPath $statusTemporaryPath) {
  throw 'Lifecycle status temporary path already exists.'
}
[System.IO.File]::WriteAllText(
  $statusTemporaryPath,
  ($status | ConvertTo-Json -Compress),
  $utf8
)
[System.IO.File]::Move($statusTemporaryPath, $statusPath)
exit $exitCode
