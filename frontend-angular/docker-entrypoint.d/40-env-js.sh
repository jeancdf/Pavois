#!/bin/sh
set -eu

envsubst '${PAVOIS_API_URL} ${PAVOIS_WS_BASE_URL}' \
  < /usr/share/nginx/html/env.template.js \
  > /tmp/env.js
