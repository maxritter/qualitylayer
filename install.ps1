# QualityLayer bootstrap for native Windows. Installs per user; an optional Defender repair
# asks for administrator approval only when a relevant ASR restriction is detected.
# Native Windows always has a screen, so it gets the QualityLayer App: the per-user setup is
# downloaded, verified against its signed SHA-256 and run silently, then the App's own command line
# installs its skills and settings and a small launcher takes the path agents call.
# -CliOnly installs the command line alone, as before. WSL2 uses install.sh inside the distribution.
# -Uninstall removes QualityLayer again without running any of its programs (see the section below):
#   & ([scriptblock]::Create((irm https://qualitylayer.dev/install.ps1))) -Uninstall
# It keeps ~/.qualitylayer (licence, tasks) unless -Purge is added.
# The release's SHA256SUMS is signed (SHA256SUMS.sig, `ssh-keygen -Y sign`): the signature is checked
# with `ssh-keygen -Y verify` against the key built into this script, then each download against its
# signed line, both mandatory, before anything is installed. QUALITYLAYER_RELEASE_SIGNER names
# another key for tests, and counts only when the release base is on this machine.
[CmdletBinding()]
param(
    [string]$Version = $env:VERSION,
    [switch]$NonInteractive,
    [switch]$CliOnly,
    [switch]$Uninstall,
    [switch]$Purge
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $env:PATHEXT) { $env:PATHEXT = '.COM;.EXE;.BAT;.CMD' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$qlChannel = if ($env:QUALITYLAYER_CHANNEL) { $env:QUALITYLAYER_CHANNEL } else { 'stable' }
if ($qlChannel -notin @('stable', 'beta')) { throw 'QUALITYLAYER_CHANNEL must be stable or beta.' }
$qlReleaseBase = if ($env:QUALITYLAYER_RELEASE_BASE) { $env:QUALITYLAYER_RELEASE_BASE } else { 'https://github.com/maxritter/qualitylayer/releases' }
$qlReleaseApi = if ($env:QUALITYLAYER_RELEASE_API) { $env:QUALITYLAYER_RELEASE_API } elseif ($qlChannel -eq 'beta') { 'https://api.github.com/repos/maxritter/qualitylayer/releases?per_page=30' } else { 'https://api.github.com/repos/maxritter/qualitylayer/releases/latest' }
# The only key that may sign a release; the same line is built into `qualitylayer update`.
$qlSignerId = 'release@qualitylayer.dev'
$qlSignerNamespace = 'qualitylayer-release'
$qlSignerKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOvc89TsfxkzK1lxTNLr/FHwImLq1oUWYmmXQ1iYL2oU'
if ($env:QUALITYLAYER_RELEASE_SIGNER -and $qlReleaseBase -match '^(file://|http://(127\.0\.0\.1|localhost)(:\d+)?(/|$))') {
    $qlSignerKey = (($env:QUALITYLAYER_RELEASE_SIGNER.Trim() -split '\s+')[0..1]) -join ' '
}
$qlHome = if ($env:HOME) { $env:HOME } else { $env:USERPROFILE }
if (-not $qlHome -or -not [IO.Path]::IsPathRooted($qlHome) -or -not (Test-Path -LiteralPath $qlHome -PathType Container)) {
    throw 'HOME or USERPROFILE must name an existing absolute user directory.'
}
$qlHome = (Get-Item -LiteralPath $qlHome).FullName
if ($qlHome.TrimEnd('\', '/') -eq [IO.Path]::GetPathRoot($qlHome).TrimEnd('\', '/')) {
    throw 'Refusing to install at the filesystem root.'
}
$env:HOME = $qlHome

# ---------------------------------------------------------------------------------------------
# -Uninstall: removes QualityLayer without running any program of QualityLayer's. This script is
# plain text, so it works where Windows (Intune, Defender Exploit Guard, AppLocker) blocks the App,
# its command line and its uninstaller, or has deleted them. It does what `qualitylayer uninstall`
# does, from the same records, and a little more where the App's own files are concerned:
#   - the hooks and settings QualityLayer added to Claude Code and Codex: only QualityLayer's own
#     entries go, and every other byte of those files stays as it is (the edit is made in the
#     text, never by reading the file in and writing it out again). A copy of each file it changes
#     is kept first, in .qualitylayer-uninstall-backup in your user folder.
#   - the skills, the launcher, `ql` and everything else the manifest lists, each only while it is
#     still the file the installer wrote.
#   - the QualityLayer App's own folder (LOCALAPPDATA\QualityLayer, LOCALAPPDATA\Programs\QualityLayer,
#     or where the manifest says), its Start menu shortcuts and its entry in Apps and features.
#   - the launcher's folder on your user PATH, when you added it.
# Your tasks and licence in ~/.qualitylayer stay unless -Purge is given. Plans in your repositories
# are never touched. Everything it removes is named in its output.
# ---------------------------------------------------------------------------------------------
$qlWindows = ($env:OS -eq 'Windows_NT')
$script:qlUtf8 = New-Object System.Text.UTF8Encoding($false)
$script:qlProblems = 0
$script:qlBackupDir = $null
$script:qlOwnCommands = @()
$script:qlLaunchers = @()

function Write-QlLine([string]$Text) { Write-Host $Text }
function Write-QlProblem([string]$Text) { $script:qlProblems++; Write-Host "  Could not finish: $Text" }

function Read-QlText([string]$Path) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    $bom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    $skip = if ($bom) { 3 } else { 0 }
    return @{ Text = $script:qlUtf8.GetString($bytes, $skip, $bytes.Length - $skip); Bom = $bom }
}

function Write-QlText([string]$Path, [string]$Text, [bool]$Bom) {
    $body = $script:qlUtf8.GetBytes($Text)
    if ($Bom) { $body = [byte[]](0xEF, 0xBB, 0xBF) + $body }
    [IO.File]::WriteAllBytes($Path, $body)
}

# A copy of a file before it is changed: outside ~/.qualitylayer, so that -Purge keeps it.
function Backup-QlFile([string]$Path) {
    if (-not $script:qlBackupDir) {
        $script:qlBackupDir = Join-Path $qlHome '.qualitylayer-uninstall-backup'
        [IO.Directory]::CreateDirectory($script:qlBackupDir) | Out-Null
    }
    $stamp = (Get-Date).ToString('yyyyMMddHHmmss')
    $copy = Join-Path $script:qlBackupDir ("{0}.{1}.{2}" -f (Split-Path -Leaf $Path), $stamp, [Guid]::NewGuid().ToString('N').Substring(0, 8))
    Copy-Item -LiteralPath $Path -Destination $copy -Force
    return $copy
}

# ---- JSON, read as text positions so that an edit changes only what it must -----------------
function Skip-QlSpace([string]$t, [int]$i) {
    while ($i -lt $t.Length -and " `t`r`n".IndexOf($t[$i]) -ge 0) { $i++ }
    return $i
}

function Find-QlStringEnd([string]$t, [int]$i) {
    $i++
    while ($i -lt $t.Length) {
        $c = $t[$i]
        if ($c -eq '\') { $i += 2; continue }
        if ($c -eq '"') { return $i + 1 }
        $i++
    }
    throw 'unterminated string'
}

function Find-QlValueEnd([string]$t, [int]$i) {
    if ($i -ge $t.Length) { throw 'missing value' }
    $c = $t[$i]
    if ($c -eq '"') { return (Find-QlStringEnd $t $i) }
    if ($c -eq '{' -or $c -eq '[') {
        $depth = 0
        while ($i -lt $t.Length) {
            $c = $t[$i]
            if ($c -eq '"') { $i = Find-QlStringEnd $t $i; continue }
            if ($c -eq '{' -or $c -eq '[') { $depth++ }
            elseif ($c -eq '}' -or $c -eq ']') { $depth--; if ($depth -eq 0) { return $i + 1 } }
            $i++
        }
        throw 'unterminated value'
    }
    while ($i -lt $t.Length -and ",}] `t`r`n".IndexOf($t[$i]) -lt 0) { $i++ }
    return $i
}

function Convert-QlJsonString([string]$Token) {
    $s = $Token.Substring(1, $Token.Length - 2)
    if ($s.IndexOf('\') -lt 0) { return $s }
    return [regex]::Replace($s, '\\(u[0-9a-fA-F]{4}|.)', [Text.RegularExpressions.MatchEvaluator] {
        param($m)
        $v = $m.Groups[1].Value
        if ($v.Length -eq 5) { return [string][char][Convert]::ToInt32($v.Substring(1), 16) }
        switch -CaseSensitive ($v) {
            'b' { return [string][char]8 }
            'f' { return [string][char]12 }
            'n' { return "`n" }
            'r' { return "`r" }
            't' { return "`t" }
            default { return $v }
        }
    })
}

function ConvertTo-QlJsonString([string]$Text) {
    $out = New-Object System.Text.StringBuilder
    [void]$out.Append('"')
    foreach ($ch in $Text.ToCharArray()) {
        switch ([int]$ch) {
            34 { [void]$out.Append('\"') }
            92 { [void]$out.Append('\\') }
            10 { [void]$out.Append('\n') }
            13 { [void]$out.Append('\r') }
            9 { [void]$out.Append('\t') }
            default {
                if ([int]$ch -lt 32) { [void]$out.Append(('\u{0:x4}' -f [int]$ch)) } else { [void]$out.Append($ch) }
            }
        }
    }
    [void]$out.Append('"')
    return $out.ToString()
}

# The members of an object, or the elements of an array, that starts at $Start.
function Get-QlChildren([string]$t, [int]$Start) {
    $isObject = ($t[$Start] -eq '{')
    $close = if ($isObject) { '}' } else { ']' }
    $items = New-Object System.Collections.ArrayList
    $i = Skip-QlSpace $t ($Start + 1)
    while ($i -lt $t.Length -and $t[$i] -ne $close) {
        $item = @{ Start = $i; Key = $null }
        if ($isObject) {
            if ($t[$i] -ne '"') { throw 'a key was expected' }
            $keyEnd = Find-QlStringEnd $t $i
            $item.Key = Convert-QlJsonString $t.Substring($i, $keyEnd - $i)
            $i = Skip-QlSpace $t $keyEnd
            if ($i -ge $t.Length -or $t[$i] -ne ':') { throw 'a colon was expected' }
            $i = Skip-QlSpace $t ($i + 1)
        }
        $item.ValueStart = $i
        $i = Find-QlValueEnd $t $i
        $item.End = $i
        [void]$items.Add($item)
        $i = Skip-QlSpace $t $i
        if ($i -lt $t.Length -and $t[$i] -eq ',') { $i = Skip-QlSpace $t ($i + 1) }
        elseif ($i -ge $t.Length -or $t[$i] -ne $close) { throw 'a comma was expected' }
    }
    if ($i -ge $t.Length) { throw 'unterminated container' }
    return @{ Open = $Start; Close = $i; Items = $items }
}

# The member at $Path (keys, from the top object): where its value is, and the object that holds it.
function Get-QlNode([string]$t, [string[]]$Path) {
    $valueStart = Skip-QlSpace $t 0
    if ($valueStart -ge $t.Length -or $t[$valueStart] -ne '{') { throw 'the file is not a JSON object' }
    $parent = $null
    $index = -1
    foreach ($key in $Path) {
        if ($t[$valueStart] -ne '{') { return $null }
        $container = Get-QlChildren $t $valueStart
        $found = -1
        for ($k = 0; $k -lt $container.Items.Count; $k++) {
            if ($container.Items[$k].Key -ceq $key) { $found = $k }
        }
        if ($found -lt 0) { return $null }
        $parent = $container
        $index = $found
        $valueStart = $container.Items[$found].ValueStart
    }
    return @{ Parent = $parent; Index = $index; ValueStart = $valueStart; End = (Find-QlValueEnd $t $valueStart) }
}

# $t without child $k of $Container: its text and the comma that joined it to its neighbour.
function Remove-QlChild([string]$t, $Container, [int]$k) {
    $items = $Container.Items
    if ($items.Count -eq 1) { return $t.Substring(0, $Container.Open + 1) + $t.Substring($Container.Close) }
    if ($k -lt $items.Count - 1) { return $t.Substring(0, $items[$k].Start) + $t.Substring($items[$k + 1].Start) }
    return $t.Substring(0, $items[$k - 1].End) + $t.Substring($items[$k].End)
}

function Remove-QlMember([string]$t, [string[]]$Path) {
    $node = Get-QlNode $t $Path
    if ($null -eq $node -or $null -eq $node.Parent) { return $t }
    return (Remove-QlChild $t $node.Parent $node.Index)
}

function Test-QlEmptyObject([string]$t, [string[]]$Path) {
    $node = Get-QlNode $t $Path
    return ($null -ne $node -and $t[$node.ValueStart] -eq '{' -and (Get-QlChildren $t $node.ValueStart).Items.Count -eq 0)
}

# ---- Which hook commands are QualityLayer's --------------------------------------------------
# The launcher path agents call, as the installer wrote it into a hook: either the plain command,
# or on Windows a PowerShell command whose -EncodedCommand carries the program and its arguments.
function Test-QlOurCommand([string]$Command) {
    if ($script:qlOwnCommands -contains $Command) { return $true }
    $encoded = [regex]::Match($Command, '-EncodedCommand\s+([A-Za-z0-9+/=]+)\s*$')
    if ($encoded.Success) {
        try {
            $code = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($encoded.Groups[1].Value))
            $data = [regex]::Match($code, "FromBase64String\('([A-Za-z0-9+/=]+)'\)")
            if ($data.Success) {
                $json = $script:qlUtf8.GetString([Convert]::FromBase64String($data.Groups[1].Value)) | ConvertFrom-Json
                $program = ([string]$json.command).Replace('\', '/').TrimEnd('/')
                $first = @($json.args)[0]
                foreach ($launcher in $script:qlLaunchers) {
                    if ($first -eq 'hook' -and $program -ieq $launcher.Replace('\', '/')) { return $true }
                }
            }
        } catch { }
        return $false
    }
    foreach ($launcher in $script:qlLaunchers) {
        $plain = '^"?' + [regex]::Escape($launcher) + '"? hook (prompt|activity|ask|live|stop)$'
        if ($Command -match $plain) { return $true }
    }
    return $false
}

# One QualityLayer hook out of the event lists under $EventsPath, or $null when none is left.
function Remove-QlOneHook([string]$t, [string[]]$EventsPath) {
    $node = Get-QlNode $t $EventsPath
    if ($null -eq $node -or $t[$node.ValueStart] -ne '{') { return $null }
    $events = Get-QlChildren $t $node.ValueStart
    for ($e = 0; $e -lt $events.Items.Count; $e++) {
        $ev = $events.Items[$e]
        if ($t[$ev.ValueStart] -ne '[') { continue }
        $groups = Get-QlChildren $t $ev.ValueStart
        for ($g = 0; $g -lt $groups.Items.Count; $g++) {
            $group = $groups.Items[$g]
            if ($t[$group.ValueStart] -ne '{') { continue }
            $members = Get-QlChildren $t $group.ValueStart
            foreach ($member in $members.Items) {
                if ($member.Key -cne 'hooks' -or $t[$member.ValueStart] -ne '[') { continue }
                $hooks = Get-QlChildren $t $member.ValueStart
                $ours = @()
                for ($h = 0; $h -lt $hooks.Items.Count; $h++) {
                    $hook = $hooks.Items[$h]
                    if ($t[$hook.ValueStart] -ne '{') { continue }
                    foreach ($field in (Get-QlChildren $t $hook.ValueStart).Items) {
                        if ($field.Key -ceq 'command' -and $t[$field.ValueStart] -eq '"' -and
                            (Test-QlOurCommand (Convert-QlJsonString $t.Substring($field.ValueStart, $field.End - $field.ValueStart)))) {
                            $ours += $h
                        }
                    }
                }
                if ($ours.Count -eq 0) { continue }
                if ($ours.Count -lt $hooks.Items.Count) { return (Remove-QlChild $t $hooks $ours[0]) }
                if ($groups.Items.Count -eq 1) { return (Remove-QlChild $t $events $e) }
                return (Remove-QlChild $t $groups $g)
            }
        }
    }
    return $null
}

# ---- Undoing one recorded setting ------------------------------------------------------------
function Undo-QlJsonSetting([string]$t, $Record) {
    $path = @($Record.key.path)
    $node = Get-QlNode $t $path
    if ($null -eq $node) { return @{ Text = $t; Done = $false } }
    $token = $t.Substring($node.ValueStart, $node.End - $node.ValueStart)
    $current = if ($token.StartsWith('"')) { Convert-QlJsonString $token } else { $null }
    $hasMember = ($null -ne $Record.key.PSObject.Properties['member'])
    $remove = $false
    $replacement = $null
    if ($hasMember) {
        $separator = [string][IO.Path]::PathSeparator
        $left = @()
        $found = $false
        if ($null -ne $current) {
            foreach ($entry in $current.Split($separator)) {
                if ($entry -eq [string]$Record.key.member) { $found = $true } elseif ($entry -ne '') { $left += $entry }
            }
        }
        if (-not $found) { return @{ Text = $t; Done = $false } }
        if ($left.Count -eq 0) { $remove = $true } else { $replacement = ConvertTo-QlJsonString ($left -join $separator) }
    } else {
        if ($null -eq $current -or $current -cne [string]$Record.key.value) { return @{ Text = $t; Done = $false } }
        if ($null -eq $Record.previous -or $Record.obsolete -eq $true) {
            $remove = $true
        } elseif ($Record.previous -is [string]) {
            $replacement = ConvertTo-QlJsonString $Record.previous
        } else {
            $replacement = ($Record.previous | ConvertTo-Json -Compress -Depth 20)
        }
    }
    if ($remove) { $t = Remove-QlMember $t $path }
    else { $t = $t.Substring(0, $node.ValueStart) + $replacement + $t.Substring($node.End) }
    # The objects the installer made on the way (env, say) go too, once nothing else is in them.
    $created = if ($null -ne $Record.createdObjects) { [int]$Record.createdObjects } else { 0 }
    if ($remove) {
        for ($depth = $path.Count - 1; $depth -gt $path.Count - 1 - $created -and $depth -ge 1; $depth--) {
            $parent = $path[0..($depth - 1)]
            if (-not (Test-QlEmptyObject $t $parent)) { break }
            $t = Remove-QlMember $t $parent
        }
    }
    return @{ Text = $t; Done = $true }
}

function Undo-QlTomlSetting([string]$Text, $Record) {
    $lines = $Text -split "`n"
    $key = [string]$Record.key.key
    $table = $Record.key.table
    $start = 0
    $end = $lines.Count
    $headerAt = -1
    if ($null -eq $table) {
        for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^\s*\[') { $end = $i; break } }
    } else {
        $header = '^\s*\[' + [regex]::Escape([string]$table) + '\]\s*(#.*)?$'
        for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i].TrimEnd("`r") -match $header) { $headerAt = $i; break } }
        if ($headerAt -lt 0) { return @{ Text = $Text; Done = $false } }
        $start = $headerAt + 1
        for ($i = $start; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^\s*\[') { $end = $i; break } }
    }
    $pattern = '^\s*' + [regex]::Escape($key) + '\s*=\s*(.*?)\s*(#.*)?$'
    $at = -1
    for ($i = $start; $i -lt $end; $i++) {
        if ($lines[$i].TrimEnd("`r") -match $pattern) { $at = $i; $held = $Matches[1]; break }
    }
    if ($at -lt 0 -or $held -cne [string]$Record.key.value) { return @{ Text = $Text; Done = $false } }
    $cr = if ($lines[$at].EndsWith("`r")) { "`r" } else { '' }
    $list = New-Object System.Collections.ArrayList
    $list.AddRange($lines)
    if ($null -eq $Record.previous) { $list.RemoveAt($at) } else { $list[$at] = "$key = $($Record.previous)$cr" }
    if ($null -eq $Record.previous -and $Record.createdTable -eq $true -and $headerAt -ge 0) {
        # The last element is only what follows the final newline.
        $limit = if ($list.Count -gt 0 -and $list[$list.Count - 1] -eq '') { $list.Count - 1 } else { $list.Count }
        $bodyEnd = $headerAt + 1
        while ($bodyEnd -lt $limit -and $list[$bodyEnd] -notmatch '^\s*\[') { $bodyEnd++ }
        $empty = $true
        for ($i = $headerAt + 1; $i -lt $bodyEnd; $i++) { if ($list[$i].Trim() -ne '') { $empty = $false } }
        if ($empty) {
            $list.RemoveRange($headerAt, $bodyEnd - $headerAt)
            # The blank line the installer put above the table goes with it.
            $after = if ($headerAt -lt $list.Count) { $list[$headerAt].Trim() } else { '' }
            if ($headerAt -gt 0 -and $list[$headerAt - 1].Trim() -eq '' -and $after -eq '') {
                $list.RemoveAt($headerAt - 1)
            }
        }
    }
    return @{ Text = ($list -join "`n"); Done = $true }
}

# ---- Paths -----------------------------------------------------------------------------------
function Test-QlInside([string]$Root, [string]$Path) {
    if (-not [IO.Path]::IsPathRooted($Path)) { return $false }
    if (($Path -split '[\\/]') -contains '..') { return $false }
    $full = [IO.Path]::GetFullPath($Path)
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    return $full.StartsWith($rootFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        $full.StartsWith($rootFull + '/', [StringComparison]::OrdinalIgnoreCase)
}

function Test-QlEmptyFolder([string]$Path) {
    return (Test-Path -LiteralPath $Path -PathType Container) -and @(Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue).Count -eq 0
}

function Stop-QlProgramsIn([string[]]$Folders) {
    if (-not $qlWindows) { return }
    foreach ($process in @(Get-Process -ErrorAction SilentlyContinue)) {
        $program = $null
        try { $program = $process.Path } catch { }
        if (-not $program) { continue }
        foreach ($folder in $Folders) {
            if ($program.StartsWith($folder.TrimEnd('\', '/') + '\', [StringComparison]::OrdinalIgnoreCase)) {
                try { Stop-Process -Id $process.Id -Force -ErrorAction Stop } catch { }
                break
            }
        }
    }
}

function Remove-QlPath([string]$Path, [switch]$Folder) {
    for ($attempt = 0; $attempt -lt 5; $attempt++) {
        try {
            if ($Folder) { Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop } else { Remove-Item -LiteralPath $Path -Force -ErrorAction Stop }
            return $true
        } catch {
            if (-not (Test-Path -LiteralPath $Path)) { return $true }
            Start-Sleep -Milliseconds 300
        }
    }
    Write-QlProblem "$Path could not be deleted (in use or blocked). Delete it by hand."
    return $false
}

function Get-QlSha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Invoke-QlUninstall {
    $stateHome = if ($env:QUALITYLAYER_HOME -and [IO.Path]::IsPathRooted($env:QUALITYLAYER_HOME)) { $env:QUALITYLAYER_HOME } else { Join-Path $qlHome '.qualitylayer' }
    $stateHome = [IO.Path]::GetFullPath($stateHome)
    if ($stateHome.TrimEnd('\', '/') -eq $qlHome.TrimEnd('\', '/') -or -not (Test-QlInside $qlHome $stateHome)) {
        throw "Refusing to work in ${stateHome}: it is not a folder inside your user folder."
    }
    $binFolder = Join-Path $stateHome 'bin'
    $script:qlLaunchers = @((Join-Path $binFolder 'qualitylayer.exe'), (Join-Path $binFolder 'qualitylayer'))
    Write-QlLine 'Removing QualityLayer without running any of its programs.'

    # What the installer recorded.
    $manifest = $null
    $manifestFile = Join-Path $stateHome 'manifest.json'
    if (Test-Path -LiteralPath $manifestFile -PathType Leaf) {
        try { $manifest = (Read-QlText $manifestFile).Text | ConvertFrom-Json } catch { Write-QlProblem "$manifestFile cannot be read: $($_.Exception.Message)" }
    }
    $recordsFile = Join-Path $stateHome 'agent-settings.json'
    $records = $null
    if (Test-Path -LiteralPath $recordsFile -PathType Leaf) {
        try { $records = (Read-QlText $recordsFile).Text | ConvertFrom-Json } catch { Write-QlProblem "$recordsFile cannot be read: $($_.Exception.Message)" }
    }
    $applied = @()
    if ($null -ne $records -and $null -ne $records.applied) { $applied = @($records.applied) }
    foreach ($record in $applied) {
        if ($record.key.format -eq 'json' -and $null -ne $record.key.PSObject.Properties['hook']) {
            $script:qlOwnCommands += [string]$record.key.hook
        }
    }
    # A manifest with one path outside your user folder is refused whole, as the CLI refuses it.
    $entries = @()
    $dirs = @()
    if ($null -ne $manifest) {
        $entries = @(@($manifest.entries) | Where-Object { $_ })
        $dirs = @(@($manifest.dirs) | Where-Object { $_ })
        foreach ($path in @($entries | ForEach-Object { $_.path }) + $dirs) {
            if ($path -and -not (Test-QlInside $qlHome $path)) {
                throw "The manifest names a path outside your user folder, so nothing was removed: $path"
            }
        }
    } else {
        Write-QlLine "  No manifest in ${stateHome}: the skills and the launcher cannot be listed, but the hooks and the App folder are still removed."
    }

    # 1. The agents' hooks and settings.
    $claudeRoot = if ($env:CLAUDE_CONFIG_DIR -and [IO.Path]::IsPathRooted($env:CLAUDE_CONFIG_DIR)) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $qlHome '.claude' }
    $codexRoot = if ($env:CODEX_HOME -and [IO.Path]::IsPathRooted($env:CODEX_HOME)) { $env:CODEX_HOME } else { Join-Path $qlHome '.codex' }
    $files = @{}
    foreach ($file in @((Join-Path $claudeRoot 'settings.json'), (Join-Path $codexRoot 'hooks.json'), (Join-Path $codexRoot 'config.toml'))) { $files[$file] = $true }
    foreach ($record in $applied) { if ($record.file) { $files[[string]$record.file] = $true } }
    $undone = @()
    foreach ($file in @($files.Keys | Sort-Object)) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
        try {
            $read = Read-QlText $file
            $text = $read.Text
            $original = $text
            $mine = @($applied | Where-Object { [string]$_.file -eq $file })
            if ($file.EndsWith('.toml')) {
                for ($r = $mine.Count - 1; $r -ge 0; $r--) {
                    if ($mine[$r].key.format -ne 'toml') { continue }
                    $result = Undo-QlTomlSetting $text $mine[$r]
                    if ($result.Done) { $text = $result.Text; $undone += [string]$mine[$r].id }
                    else { Write-QlLine "  Left as it is (changed since install): $($mine[$r].id)" }
                }
            } else {
                $removedHooks = 0
                foreach ($events in @(@('hooks'), @())) {
                    while ($true) {
                        $next = Remove-QlOneHook $text $events
                        if ($null -eq $next) { break }
                        $text = $next
                        $removedHooks++
                    }
                }
                if ($removedHooks -gt 0) {
                    foreach ($record in $mine) { if ($null -ne $record.key.PSObject.Properties['hook']) { $undone += [string]$record.id } }
                    # An events object our removal emptied has no use left.
                    if (Test-QlEmptyObject $text @('hooks')) { $text = Remove-QlMember $text @('hooks') }
                }
                for ($r = $mine.Count - 1; $r -ge 0; $r--) {
                    $record = $mine[$r]
                    if ($record.key.format -ne 'json' -or $null -ne $record.key.PSObject.Properties['hook']) { continue }
                    $result = Undo-QlJsonSetting $text $record
                    if ($result.Done) { $text = $result.Text; $undone += [string]$record.id }
                    else { Write-QlLine "  Left as it is (changed since install): $($record.id)" }
                }
            }
            if ($text -ceq $original) { continue }
            $copy = Backup-QlFile $file
            $createdFile = @($mine | Where-Object { $_.createdFile -eq $true }).Count -gt 0
            if ($createdFile -and -not $file.EndsWith('.toml') -and (Test-QlEmptyObject $text @())) {
                [void](Remove-QlPath $file)
                Write-QlLine "  Removed $file (QualityLayer had created it); a copy is in $copy"
            } else {
                if (-not $file.EndsWith('.toml')) {
                    # The edit must leave one whole JSON object, or the file is not written.
                    $top = Skip-QlSpace $text 0
                    if ($text[$top] -ne '{' -or (Skip-QlSpace $text (Find-QlValueEnd $text $top)) -ne $text.Length) { throw 'the edit would not leave valid JSON' }
                    [void](Get-QlChildren $text $top)
                }
                Write-QlText $file $text $read.Bom
                Write-QlLine "  Cleaned $file; the file as it was is in $copy"
            }
        } catch {
            Write-QlProblem "$file was left as it is: $($_.Exception.Message)"
        }
    }

    # 2. Programs of QualityLayer that may be running: the launcher and the App.
    $appFolders = @()
    $candidates = @()
    if ($null -ne $manifest -and $null -ne $manifest.app -and $manifest.app.path) { $candidates += [string]$manifest.app.path }
    $localData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path (Join-Path $qlHome 'AppData') 'Local' }
    $candidates += (Join-Path $localData 'QualityLayer')
    $candidates += (Join-Path (Join-Path $localData 'Programs') 'QualityLayer')
    foreach ($candidate in $candidates) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Container)) { continue }
        $full = [IO.Path]::GetFullPath($candidate)
        # A folder of QualityLayer's, not just one with its name.
        $marked = (Test-Path -LiteralPath (Join-Path $full 'QualityLayer.exe')) -or (Test-Path -LiteralPath (Join-Path $full 'qualitylayer-cli.exe')) -or
            (Test-Path -LiteralPath (Join-Path $full 'qualitylayer-launcher.exe')) -or (Test-Path -LiteralPath (Join-Path $full 'QualityLayer-Windows-Repair.ps1'))
        if (-not $marked) { continue }
        if (-not (Test-QlInside $qlHome $full)) { Write-QlLine "  The App folder $full is outside your user folder; delete it by hand."; continue }
        if ($appFolders -notcontains $full) { $appFolders += $full }
    }
    Stop-QlProgramsIn (@($binFolder) + $appFolders)

    # 3. The files the manifest lists, each only while it is what the installer wrote.
    $removed = 0
    foreach ($entry in $entries) {
        $path = [string]$entry.path
        if ($entry.kind -eq 'file') {
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
            if ((Get-QlSha256 $path) -ceq ([string]$entry.sha256).ToLowerInvariant()) {
                if (Remove-QlPath $path) { $removed++; Write-QlLine "  Removed $path" }
            } else {
                Write-QlLine "  Kept, changed since install: $path"
            }
        } elseif ($entry.kind -eq 'symlink') {
            $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            if ($null -ne $item -and $item.LinkType -eq 'SymbolicLink' -and (@($item.Target) -contains [string]$entry.target)) {
                if (Remove-QlPath $path) { $removed++; Write-QlLine "  Removed $path" }
            } elseif ($null -ne $item) {
                Write-QlLine "  Kept, not the link QualityLayer made: $path"
            }
        }
    }
    # Claude Code writes type declarations into the mod it loads; they go with the mod's folder.
    $modFolder = Join-Path (Join-Path $stateHome 'mod') 'qualitylayer'
    if ($null -ne $manifest -and (Test-Path -LiteralPath $modFolder -PathType Container)) {
        if (Remove-QlPath $modFolder -Folder) { Write-QlLine "  Removed $modFolder" }
    }
    # Scanner runtimes write private cache/configuration here, outside their pinned file manifest.
    foreach ($scanner in @('betterleaks', 'osv-scanner', 'zizmor', 'opengrep')) {
        $state = Join-Path (Join-Path (Join-Path $stateHome 'tools') $scanner) 'state'
        if (-not (Test-Path -LiteralPath $state -PathType Container)) { continue }
        $safe = $true
        for ($path = $state; (Test-QlInside $qlHome $path); $path = Split-Path -Parent $path) {
            $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            if ($null -ne $item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                $safe = $false
                break
            }
        }
        if ($safe) {
            if (Remove-QlPath $state -Folder) { Write-QlLine "  Removed $state" }
        } else {
            Write-QlLine "  Kept, not a managed scanner folder: $state"
        }
    }
    if ($null -ne $manifest) { [void](Remove-QlPath $manifestFile) }
    foreach ($dir in @($dirs | Sort-Object -Descending)) {
        if (Test-QlEmptyFolder $dir) { try { Remove-Item -LiteralPath $dir -Force -ErrorAction Stop } catch { } }
    }
    # Said as done: the settings are back, so the records of them go (the ones the user took out of a
    # settings file by hand stay noted, as the CLI notes them).
    if ($null -ne $records -and (Test-Path -LiteralPath $recordsFile -PathType Leaf)) {
        $left = @($applied | Where-Object { $undone -notcontains [string]$_.id })
        $seen = @()
        if ($null -ne $records.seen) { $seen = @(@($records.seen) | Where-Object { $_ -and $undone -notcontains [string]$_ }) }
        $kept = [ordered]@{ applied = $left; seen = $seen }
        Write-QlText $recordsFile (($kept | ConvertTo-Json -Depth 20) + "`n") $false
    }

    # 4. The App's own folder, shortcuts and entry in Apps and features.
    foreach ($folder in $appFolders) {
        if (Remove-QlPath $folder -Folder) { Write-QlLine "  Removed the App folder $folder" }
    }
    if ($appFolders.Count -eq 0) { Write-QlLine '  No QualityLayer App folder found for this user.' }
    if ($qlWindows) {
        $roaming = if ($env:APPDATA) { $env:APPDATA } else { Join-Path (Join-Path $qlHome 'AppData') 'Roaming' }
        $start = Join-Path $roaming 'Microsoft\Windows\Start Menu\Programs'
        $desktop = [Environment]::GetFolderPath('Desktop')
        foreach ($shortcut in @((Join-Path $start 'QualityLayer.lnk'), (Join-Path $start 'QualityLayer - Repair Windows launch.lnk'), (Join-Path $desktop 'QualityLayer.lnk'))) {
            if (Test-Path -LiteralPath $shortcut -PathType Leaf) { if (Remove-QlPath $shortcut) { Write-QlLine "  Removed $shortcut" } }
        }
        foreach ($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\QualityLayer', 'HKCU:\Software\Classes\qualitylayer')) {
            if (-not (Test-Path -LiteralPath $key)) { continue }
            $text = (Get-ItemProperty -LiteralPath $key | Out-String) + ((Get-ChildItem -LiteralPath $key -Recurse -ErrorAction SilentlyContinue | Get-ItemProperty -ErrorAction SilentlyContinue | Out-String))
            $ours = $false
            foreach ($folder in ($appFolders + @($candidates))) { if ($text.IndexOf($folder, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $ours = $true } }
            if ($ours) { try { Remove-Item -LiteralPath $key -Recurse -Force -ErrorAction Stop; Write-QlLine "  Removed registry entry $key" } catch { Write-QlProblem "$key could not be removed: $($_.Exception.Message)" } }
        }
        # The launcher's folder on the user's PATH, when it was added by hand.
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if ($userPath) {
            $kept = @($userPath -split ';' | Where-Object { $_ -ne '' -and $_.TrimEnd('\', '/') -ine $binFolder.TrimEnd('\', '/') })
            if ($kept.Count -ne @($userPath -split ';' | Where-Object { $_ -ne '' }).Count) {
                [Environment]::SetEnvironmentVariable('Path', ($kept -join ';'), 'User')
                Write-QlLine "  Removed $binFolder from your user PATH"
            }
        }
        $asr = foreach ($folder in $appFolders) { if (Test-Path -LiteralPath (Join-Path $folder '.qualitylayer-asr.json')) { $folder } }
        if ($asr) { Write-QlLine '  QualityLayer once added a Defender exclusion for its files. Only an administrator can remove it; it does no harm.' }
    }

    # 5. Your data.
    if ($Purge) {
        if ((Test-Path -LiteralPath $stateHome) -and (Test-QlInside $qlHome $stateHome)) {
            if (Remove-QlPath $stateHome -Folder) { Write-QlLine "  Removed $stateHome (licence, settings and every task's state)" }
        }
        foreach ($data in @((Join-Path $localData 'dev.qualitylayer.app'), $(if ($env:APPDATA) { Join-Path $env:APPDATA 'dev.qualitylayer.app' }))) {
            if ($data -and (Test-Path -LiteralPath $data -PathType Container)) { if (Remove-QlPath $data -Folder) { Write-QlLine "  Removed $data" } }
        }
    } elseif (Test-Path -LiteralPath $stateHome) {
        Write-QlLine "  Kept $stateHome (licence, settings and task state). Remove it too with -Uninstall -Purge."
    }
    Write-QlLine "Removed $removed file(s) from the manifest. Plans in your repositories (docs/plans) are untouched."
    if ($script:qlBackupDir) { Write-QlLine "Copies of the agent files it changed: $($script:qlBackupDir)" }
    Write-QlLine 'Open a new terminal; your agents no longer call QualityLayer.'
    if ($script:qlProblems -gt 0) { Write-Warning "$($script:qlProblems) thing(s) could not be removed; they are listed above." }
}

if ($Uninstall) {
    Invoke-QlUninstall
    if ($script:qlProblems -gt 0 -and $PSCommandPath) { exit 1 }
    return
}

# Use the OS architecture, even when PowerShell is running under x64 emulation on ARM.
$qlArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$qlCpu = switch ($qlArch.ToUpperInvariant()) {
    'AMD64' { 'x64' }
    'ARM64' { throw 'Windows ARM64 is not supported. QualityLayer for Windows requires x64 (Intel or AMD).' }
    default { throw "Unsupported Windows CPU: $qlArch" }
}
$qlAsset = "qualitylayer-windows-$qlCpu.exe"
# What a release has to carry for this install: the App's setup, or with -CliOnly the command line.
$qlWanted = { param($qlTag) if ($CliOnly) { $qlAsset } else { "QualityLayer-$($qlTag -replace '^v', '')-$qlCpu-setup.exe" } }
$qlWork = Join-Path ([IO.Path]::GetTempPath()) ("qualitylayer-install-" + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($qlWork) | Out-Null
$script:qlKeepWork = $false

# Confirm-SignedSums: the release's SHA256SUMS and its signature, fetched once, and the signature
# checked against the key built into this script before any line of the sums is trusted.
$script:qlSums = $null
$script:qlVerifiedHashes = @{}
function Confirm-SignedSums {
    if ($script:qlSums) { return }
    $qlKeygen = Get-Command ssh-keygen -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $qlKeygen) { throw 'ssh-keygen is required to verify the release signature; nothing was installed.' }
    $qlSumsFile = Join-Path $qlWork 'SHA256SUMS'
    Invoke-WebRequest -UseBasicParsing -Uri "$qlBase/SHA256SUMS" -OutFile $qlSumsFile
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$qlBase/SHA256SUMS.sig" -OutFile "$qlSumsFile.sig"
    } catch {
        throw "The release's SHA256SUMS is not signed by QualityLayer: $qlBase/SHA256SUMS.sig is missing; nothing was installed."
    }
    $qlAllowed = Join-Path $qlWork 'allowed_signers'
    [IO.File]::WriteAllText($qlAllowed, "$qlSignerId namespaces=`"$qlSignerNamespace`" $qlSignerKey`n")
    $qlVerify = Start-Process -FilePath $qlKeygen.Source -NoNewWindow -Wait -PassThru `
        -ArgumentList @('-Y', 'verify', '-f', "`"$qlAllowed`"", '-I', $qlSignerId, '-n', $qlSignerNamespace, '-s', "`"$qlSumsFile.sig`"") `
        -RedirectStandardInput $qlSumsFile -RedirectStandardOutput (Join-Path $qlWork 'verify.out') -RedirectStandardError (Join-Path $qlWork 'verify.err')
    if ($qlVerify.ExitCode -ne 0) {
        $qlVerifyExit = if ($null -eq $qlVerify.ExitCode) { 'unavailable' } else { [string]$qlVerify.ExitCode }
        $qlVerifyError = [IO.File]::ReadAllText((Join-Path $qlWork 'verify.err')).Trim()
        $qlVerifyOutput = [IO.File]::ReadAllText((Join-Path $qlWork 'verify.out')).Trim()
        if ($qlVerifyError.Length -gt 4096) { $qlVerifyError = $qlVerifyError.Substring($qlVerifyError.Length - 4096) }
        if ($qlVerifyOutput.Length -gt 1024) { $qlVerifyOutput = $qlVerifyOutput.Substring($qlVerifyOutput.Length - 1024) }
        throw "The release's SHA256SUMS is not signed by QualityLayer; nothing was installed. Verifier: $($qlKeygen.Source); exit: $qlVerifyExit; stderr: $qlVerifyError; stdout: $qlVerifyOutput"
    }
    $script:qlSums = $qlSumsFile
}

# Save-Verified <file in the release> <where to put it>: the file, checked against its line in the
# signed SHA256SUMS before anything is installed.
function Save-Verified([string]$Name, [string]$Destination) {
    Invoke-WebRequest -UseBasicParsing -Uri "$qlBase/$Name" -OutFile $Destination
    Confirm-SignedSums
    $qlExpected = $null
    foreach ($qlLine in Get-Content -LiteralPath $script:qlSums) {
        $qlFields = $qlLine.Trim() -split '\s+'
        if ($qlFields.Count -ge 2 -and $qlFields[1] -eq $Name) { $qlExpected = $qlFields[0]; break }
    }
    if ($qlExpected -notmatch '^[0-9a-fA-F]{64}$') { throw "SHA256SUMS holds no checksum for $Name; nothing was installed." }
    $qlActual = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash
    if ($qlExpected -ne $qlActual) { throw 'Checksum mismatch; nothing was installed.' }
    # Remove the download marker only after authenticating this exact file.
    Unblock-File -LiteralPath $Destination -ErrorAction Stop
    $script:qlVerifiedHashes[$Destination] = $qlActual
}

function Get-QlNativePowerShell {
    $native = Join-Path $env:SystemRoot 'Sysnative\WindowsPowerShell\v1.0\powershell.exe'
    if (Test-Path -LiteralPath $native -PathType Leaf) { return $native }
    return (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
}

function Test-QlSetupAsrBlock([string]$Setup, [datetime]$Since) {
    # Match event data, not a translated message or an enabled rule alone.
    try {
        $events = @(Get-WinEvent -FilterHashtable @{
            LogName = 'Microsoft-Windows-Windows Defender/Operational'
            Id = 1121
            StartTime = $Since
        } -MaxEvents 100 -ErrorAction Stop)
        foreach ($event in $events) {
            [xml]$xml = $event.ToXml()
            foreach ($data in $xml.Event.EventData.Data) {
                if ($data.Name -in @('Path', 'Involved File') -and $data.InnerText -ieq $Setup) { return $true }
            }
        }
    } catch { return $false }
    return $false
}

function Get-QlSetupRepairScript {
    # The elevated helper owns the temporary exception and removes it even if its caller exits.
    return @'
param([string]$SetupPath, [string]$ExpectedHash, [string]$StatePath, [int]$ParentId, [long]$ParentStartTicks)
$ErrorActionPreference = 'Stop'
$owned = $false
$problem = $null
function Write-SetupState([string]$Name, $Value) {
    $file = Join-Path $StatePath $Name
    [IO.File]::WriteAllText(($file + '.tmp'), ($Value | ConvertTo-Json -Compress))
    Move-Item -LiteralPath ($file + '.tmp') -Destination $file -Force
}
try {
    if ((Get-FileHash -LiteralPath $SetupPath -Algorithm SHA256).Hash -ne $ExpectedHash) {
        throw 'The verified setup file changed; no exception was added.'
    }
    $existing = @((Get-MpPreference -ErrorAction Stop).AttackSurfaceReductionOnlyExclusions)
    if ($SetupPath -notin $existing) {
        # The path is unique to this download. Even a partially failed addition needs cleanup.
        $owned = $true
        Add-MpPreference -AttackSurfaceReductionOnlyExclusions $SetupPath -ErrorAction Stop
    }
    if ($SetupPath -notin @((Get-MpPreference -ErrorAction Stop).AttackSurfaceReductionOnlyExclusions)) {
        throw 'Defender did not retain the temporary exception. A device policy may prevent this change.'
    }
    Write-SetupState 'ready.json' @{ ready = $true }
    $deadline = (Get-Date).AddMinutes(15)
    while (-not (Test-Path -LiteralPath (Join-Path $StatePath 'done'))) {
        $parent = $null
        try {
            $parent = [Diagnostics.Process]::GetProcessById($ParentId)
            if ($parent.StartTime.Ticks -ne $ParentStartTicks -or $parent.HasExited) { break }
        } catch { break } finally { if ($null -ne $parent) { $parent.Dispose() } }
        if ((Get-Date) -ge $deadline) { throw 'The setup recovery timed out.' }
        Start-Sleep -Milliseconds 250
    }
} catch { $problem = $_.Exception.Message } finally {
    if ($owned) {
        try {
            Remove-MpPreference -AttackSurfaceReductionOnlyExclusions $SetupPath -ErrorAction Stop
            if ($SetupPath -in @((Get-MpPreference -ErrorAction Stop).AttackSurfaceReductionOnlyExclusions)) {
                throw 'Defender did not remove the temporary exception.'
            }
        } catch { $problem = "$problem Temporary exception cleanup failed: $($_.Exception.Message) Path: $SetupPath" }
    }
    Write-SetupState 'result.json' @{ error = $problem }
}
'@
}

function Invoke-QlSetupRepair([string]$Setup, [string]$Arguments) {
    Write-Host "Defender attack surface reduction blocked the verified setup: $Setup"
    Write-Host 'Recovery temporarily allows this setup file through ASR rules. Antivirus scanning stays enabled.'
    Write-Host 'Windows will ask for administrator approval. Setup still installs for your current user.'
    if ((Read-Host 'Allow the temporary setup exception? [y/N]') -notmatch '^(?i)y(es)?$') {
        throw 'Setup recovery was declined; Windows security settings were not changed.'
    }
    $state = Join-Path $qlWork 'setup-recovery'
    [IO.Directory]::CreateDirectory($state) | Out-Null
    $helper = Join-Path $state 'repair.ps1'
    [IO.File]::WriteAllText($helper, (Get-QlSetupRepairScript))
    $hash = $script:qlVerifiedHashes[$Setup]
    if ($hash -notmatch '^[0-9a-fA-F]{64}$') { throw 'Setup recovery requires a verified release checksum.' }
    $parent = [Diagnostics.Process]::GetCurrentProcess()
    try { $ticks = $parent.StartTime.Ticks } finally { $parent.Dispose() }
    $repairArguments = '-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $helper +
        '" -SetupPath "' + $Setup + '" -ExpectedHash ' + $hash + ' -StatePath "' + $state +
        '" -ParentId ' + $PID + ' -ParentStartTicks ' + $ticks
    $repair = $null
    try {
        $repair = Start-Process -FilePath (Get-QlNativePowerShell) -ArgumentList $repairArguments -Verb RunAs -PassThru -ErrorAction Stop
        $deadline = (Get-Date).AddSeconds(30)
        while (-not (Test-Path -LiteralPath (Join-Path $state 'ready.json'))) {
            if (Test-Path -LiteralPath (Join-Path $state 'result.json')) {
                $result = Get-Content -LiteralPath (Join-Path $state 'result.json') -Raw | ConvertFrom-Json
                throw "Setup recovery failed: $($result.error)"
            }
            if ($repair.HasExited -or (Get-Date) -ge $deadline) { throw 'Windows did not complete setup recovery.' }
            Start-Sleep -Milliseconds 100
        }
        # Only the security helper elevates; the original user starts the per-user setup.
        return (Start-Process -FilePath $Setup -ArgumentList $Arguments -Wait -PassThru -ErrorAction Stop)
    } finally {
        [IO.File]::WriteAllText((Join-Path $state 'done'), '')
        if ($null -ne $repair) {
            try {
                if (-not $repair.WaitForExit(30000)) { throw 'The setup recovery helper did not finish cleanup.' }
                if (-not (Test-Path -LiteralPath (Join-Path $state 'result.json'))) { throw 'Setup recovery cleanup could not be verified.' }
                $result = Get-Content -LiteralPath (Join-Path $state 'result.json') -Raw | ConvertFrom-Json
                if ($result.error) { throw $result.error }
            } catch {
                $script:qlKeepWork = $true
                Write-Warning "Setup recovery needs attention: $($_.Exception.Message) Recovery files: $state"
                throw
            } finally { $repair.Dispose() }
        }
    }
}

function Start-QlSetup([string]$Setup, [string]$InstallDirectory, [bool]$Quiet) {
    # NSIS consumes the whole unquoted /D value, including spaces; /D must be last.
    $arguments = "/S /D=$InstallDirectory"
    $since = (Get-Date).AddSeconds(-1)
    try { return (Start-Process -FilePath $Setup -ArgumentList $arguments -Wait -PassThru -ErrorAction Stop) } catch {
        $failure = $_
        $exception = $_.Exception
        $denied = $false
        while ($null -ne $exception) {
            if (($exception -is [ComponentModel.Win32Exception] -and $exception.NativeErrorCode -eq 5) -or
                $exception -is [UnauthorizedAccessException]) { $denied = $true }
            $exception = $exception.InnerException
        }
        if (-not $denied) { throw }
        $asr = $false
        for ($attempt = 0; $attempt -lt 3 -and -not $asr; $attempt++) {
            if ($attempt -gt 0) { Start-Sleep -Milliseconds 250 }
            $asr = Test-QlSetupAsrBlock $Setup $since
        }
        if (-not $asr) {
            throw "Windows denied access to the verified setup: $Setup. Check Windows Security Protection history or your device administrator's application policy. No confirmed Defender ASR block was found, so security settings were not changed. Windows reported: $($failure.Exception.Message)"
        }
        if ($Quiet) {
            throw "Defender ASR blocked the verified setup: $Setup. Run the installer in an interactive terminal to approve a temporary setup exception, or ask your device administrator to allow the published QualityLayer setup."
        }
        return (Invoke-QlSetupRepair $Setup $arguments)
    }
}

try {
    if (-not $Version) {
        $qlReleases = Invoke-RestMethod -Uri $qlReleaseApi
        $qlRelease = $qlReleases | Where-Object {
            -not $_.draft -and $_.tag_name -match '^v12\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$' -and
            ($qlChannel -eq 'beta' -or (-not $_.prerelease -and $_.tag_name -notmatch '-')) -and
            ($_.assets.name -contains (& $qlWanted $_.tag_name))
        } | Select-Object -First 1
        if (-not $qlRelease) { throw "No QualityLayer 12 release carries $(& $qlWanted 'v12')." }
        $Version = $qlRelease.tag_name
    }
    $Version = $Version -replace '^v', ''
    if ($Version -notmatch '^12\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw "Invalid QualityLayer version: $Version" }
    $qlBase = "$qlReleaseBase/download/v$Version"
    $qlQuiet = $NonInteractive -or [Console]::IsInputRedirected
    $qlArguments = @('install')
    if ($qlQuiet) { $qlArguments += '--non-interactive' }

    if ($CliOnly) {
        Write-Host "QualityLayer $Version - Windows $qlCpu, command line only"
        $qlBinary = Join-Path $qlWork 'qualitylayer.exe'
        Write-Host "Downloading QualityLayer $Version ($qlAsset)"
        Save-Verified $qlAsset $qlBinary
        Write-Host 'Checksum verified (SHA-256)'
        $qlRun = $qlArguments + '--cli-only'
        & $qlBinary @qlRun
        if ($LASTEXITCODE -ne 0) { throw "QualityLayer install failed (exit $LASTEXITCODE)." }
    } else {
        Write-Host "QualityLayer $Version - Windows $qlCpu, with a screen"
        $qlPackage = "QualityLayer-$Version-$qlCpu-setup.exe"
        $qlSetup = Join-Path $qlWork 'setup.exe'
        Write-Host "Downloading the QualityLayer App $Version ($qlPackage)"
        Save-Verified $qlPackage $qlSetup
        Write-Host 'Checksum verified (SHA-256)'
        $qlLocal = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path (Join-Path $qlHome 'AppData') 'Local' }
        $qlApp = Join-Path (Join-Path $qlLocal 'Programs') 'QualityLayer'
        $qlSetupRun = Start-QlSetup $qlSetup $qlApp $qlQuiet
        if ($qlSetupRun.ExitCode -ne 0) { throw "The QualityLayer App's setup failed (exit $($qlSetupRun.ExitCode))." }
        $qlCli = Join-Path $qlApp 'qualitylayer-cli.exe'
        if (-not (Test-Path -LiteralPath $qlCli -PathType Leaf)) { throw "The App's command line is missing: $qlCli" }
        Write-Host 'Installed the QualityLayer App for this user'
        # The NSIS package is run silently here, so an interactive bootstrap performs its optional
        # ASR check before invoking a CLI that Defender might otherwise prevent from starting.
        $qlRepair = Join-Path $qlApp 'QualityLayer-Windows-Repair.ps1'
        if (-not $qlQuiet -and (Test-Path -LiteralPath $qlRepair -PathType Leaf)) {
            $qlPowerShell = Get-QlNativePowerShell
            # A separate process keeps -WindowStyle Hidden from hiding the caller's console.
            $qlRepairArguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $qlRepair + '" -Automatic'
            $qlRepairRun = Start-Process -FilePath $qlPowerShell -ArgumentList $qlRepairArguments -WindowStyle Hidden -Wait -PassThru
            if ($qlRepairRun.ExitCode -ne 0) {
                Write-Warning 'Windows security repair did not finish. Use QualityLayer - Repair Windows launch from the Start menu to retry.'
            }
        }
        $qlRun = $qlArguments + @('--app', $qlApp)
        & $qlCli @qlRun
        if ($LASTEXITCODE -ne 0) { throw "QualityLayer install failed (exit $LASTEXITCODE)." }
        # On a terminal the App opens at once to finish setting up; an unattended run opens nothing.
        if (-not $qlQuiet) {
            Write-Host 'Opening the QualityLayer App...'
            Start-Process -FilePath (Join-Path $qlApp 'QualityLayer.exe')
        }
    }
    $qlBinDir = Join-Path $qlHome '.qualitylayer\bin'
    # Current terminal only; the installer prints the command to add to a PowerShell profile.
    if (($env:Path -split ';') -notcontains $qlBinDir) { $env:Path = "$qlBinDir;$env:Path" }
} finally {
    if (-not $script:qlKeepWork) { Remove-Item -LiteralPath $qlWork -Recurse -Force -ErrorAction SilentlyContinue }
}
