#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${1:?Application root is required}"
ARCHIVE_PATH="${2:?Archive path is required}"
NODE_BIN_DIR="${3:?Node binary directory is required}"
RELEASE_ID="${4:?Release ID is required}"

if [[ ! "$APP_ROOT" =~ ^/var/www/vhosts/[A-Za-z0-9.-]+/[A-Za-z0-9.-]+$ ]]; then
  echo "Refusing unsafe application root: $APP_ROOT" >&2
  exit 1
fi

if [[ ! "$RELEASE_ID" =~ ^[0-9a-f]{40}-[0-9]+$ ]]; then
  echo "Invalid release ID: $RELEASE_ID" >&2
  exit 1
fi

if [[ ! -x "$NODE_BIN_DIR/node" || ! -x "$NODE_BIN_DIR/npm" ]]; then
  echo "Node.js was not found in $NODE_BIN_DIR" >&2
  exit 1
fi

if [[ ! -f "$ARCHIVE_PATH" ]]; then
  echo "Deployment archive was not found: $ARCHIVE_PATH" >&2
  exit 1
fi

mkdir -p "$APP_ROOT/.releases"

if [[ ! -f "$APP_ROOT/.env" ]]; then
  echo "Create $APP_ROOT/.env before the first deployment." >&2
  exit 1
fi

RELEASE_DIR="$APP_ROOT/.releases/$RELEASE_ID"
if [[ -e "$RELEASE_DIR" ]]; then
  echo "Release already exists: $RELEASE_DIR" >&2
  exit 1
fi

mkdir "$RELEASE_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$RELEASE_DIR"
install -m 600 "$APP_ROOT/.env" "$RELEASE_DIR/.env"

export PATH="$NODE_BIN_DIR:$PATH"
export NODE_ENV=production

cd "$RELEASE_DIR"
npm ci --include=dev
npm run db:generate
npm run build
npm run db:deploy
npm prune --omit=dev

rsync -a --delete \
  --exclude='.env' \
  --exclude='.node-version' \
  --exclude='.php-ini' \
  --exclude='.php-version' \
  --exclude='.releases/' \
  --exclude='tmp/' \
  "$RELEASE_DIR/" "$APP_ROOT/"

mkdir -p "$APP_ROOT/tmp"
touch "$APP_ROOT/tmp/restart.txt"

echo "Deployment completed: $RELEASE_ID"
