// Shell integration: print a `wtree` function that shadows the binary so
// `wtree new` / `wtree cd` can change the caller's directory (a child
// process never can; that's why stdout is data-only). Everything else
// falls through to `command wtree`.

const POSIX = `# wtree shell integration (bash/zsh): wtree new / wtree cd change directory.
# The path is still printed, so cd "$(wtree new x)" and scripts keep working.
wtree() {
  case "$1" in
    new|cd)
      local _sub _dir
      _sub="$1"; shift
      [ "$_sub" = cd ] && _sub=path
      _dir="$(command wtree "$_sub" "$@")" || return $?
      [ -n "$_dir" ] && cd "$_dir" && printf '%s\\n' "$_dir"
      ;;
    *) command wtree "$@" ;;
  esac
}
`

const FISH = `# wtree shell integration (fish): wtree new / wtree cd change directory.
function wtree
    if contains -- "$argv[1]" new cd
        set -l sub $argv[1]
        set -e argv[1]
        test "$sub" = cd; and set sub path
        set -l dir (command wtree $sub $argv)
        set -l st $status
        test $st -ne 0; and return $st
        test -n "$dir"; and cd $dir; and echo $dir
    else
        command wtree $argv
    end
end
`

const POWERSHELL = `# wtree shell integration (PowerShell): wtree new / wtree cd change directory.
function wtree {
  $app = Get-Command -Name wtree -CommandType Application | Select-Object -First 1
  if (-not $app) { Write-Error 'wtree: binary not found on PATH'; return }
  if ($args.Count -gt 0 -and @('new', 'cd') -contains $args[0]) {
    $sub = if ($args[0] -eq 'cd') { 'path' } else { 'new' }
    $rest = @($args | Select-Object -Skip 1)
    $dir = & $app $sub @rest
    if ($LASTEXITCODE -eq 0 -and $dir) { Set-Location "$dir"; "$dir" }
  } else {
    & $app @args
  }
}
`

const SHELLS = { bash: POSIX, zsh: POSIX, fish: FISH, powershell: POWERSHELL, pwsh: POWERSHELL }

export function shellInit(shell) {
  if (!shell || !Object.hasOwn(SHELLS, shell)) {
    throw new Error(`shell-init needs a shell: bash | zsh | fish | powershell`)
  }
  return SHELLS[shell]
}
