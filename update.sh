#!/usr/bin/env bash
# Stick Havoc: pull the latest version. ./update.sh
# Any changes you've made to the files are set aside first and put back after;
# if one of them clashes with the update, nothing is lost: it says what to do.
set -euo pipefail
cd "$(dirname "$0")"

for tool in git npm; do
    if ! command -v "$tool" > /dev/null 2>&1; then
        echo "update.sh needs $tool (the README's Host a game section says how to get it)."
        exit 1
    fi
done
if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    echo "This copy wasn't cloned with git, so it can't update itself."
    echo "Get a fresh one: git clone https://github.com/MehulK-techie/stick-havoc.git"
    exit 1
fi
branch=$(git branch --show-current)
if [ "$branch" != "main" ]; then
    echo "You're on the branch '$branch'. Updates come to 'main':"
    echo "  git switch main && ./update.sh"
    exit 1
fi

echo "🔄 Updating Stick Havoc..."
# set your changes aside under a name of our own, and only if there are any
# (a bare 'git stash pop' after nothing was stashed would pop an older stash)
stashed=false
if ! git diff --quiet || ! git diff --cached --quiet; then
    git stash push --quiet --message "update.sh: your changes before updating"
    stashed=true
    echo "   (your changes are set aside while it updates)"
fi

if ! git pull --rebase --quiet origin main; then
    echo "❌ The update couldn't be applied: is this computer online? ('git status' shows anything in the way)"
    if [ "$stashed" = true ]; then
        git rebase --abort > /dev/null 2>&1 || true
        git stash pop --quiet && echo "   Your changes are back as they were."
    fi
    exit 1
fi

if [ "$stashed" = true ]; then
    ref=$(git stash list --format='%gd %gs' | awk '/update.sh: your changes before updating/ { print $1; exit }')
    if [ -n "$ref" ] && ! git stash pop --quiet "$ref"; then
        echo "⚠️  Updated, but some of your own changes clash with it."
        echo "   The files marked 'both modified' in 'git status' need a look; your version is"
        echo "   kept safe in the stash ('git stash list') until you 'git stash drop' it."
        exit 1
    fi
fi

npm install --no-audit --no-fund --silent
echo "✅ Update complete! Run ./run.sh to play."
