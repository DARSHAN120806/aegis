#!/bin/sh
set -eu
umask 077
# Passwords are hex/token secrets without whitespace or quotes, validated before config generation.
case "$REDIS_PASSWORD" in *[!a-zA-Z0-9_-]*|'') exit 1;; esac
cat > /tmp/redis.conf <<EOF
port 0
tls-port 6379
tls-cert-file /run/tls/redis.crt
tls-key-file /run/tls/redis.key
tls-ca-cert-file /run/tls/ca.crt
tls-auth-clients no
requirepass $REDIS_PASSWORD
save ""
appendonly no
maxmemory 192mb
maxmemory-policy noeviction
EOF
exec redis-server /tmp/redis.conf
