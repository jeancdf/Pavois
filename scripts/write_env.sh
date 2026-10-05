#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: write_env.sh <env-file> <VAR>..." >&2
  exit 1
fi

file=$1
shift
names=()
for name in "$@"; do
  if [[ -n ${!name-} ]]; then
    names+=("$name")
  fi
done
[[ ${#names[@]} -gt 0 ]] || exit 0

umask 077
touch "$file"
pattern="^($(IFS='|'; echo "${names[*]}"))="
tmp=$(mktemp "$(dirname "$file")/.env.XXXXXX")
trap 'rm -f -- "$tmp"' EXIT

grep -Ev "$pattern" "$file" > "$tmp" || true
for name in "${names[@]}"; do
  printf '%s=%s\n' "$name" "${!name}" >> "$tmp"
done

chmod 600 "$tmp"
mv -f -- "$tmp" "$file"
trap - EXIT
