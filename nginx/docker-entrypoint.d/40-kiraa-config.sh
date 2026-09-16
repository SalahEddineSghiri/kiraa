#!/bin/sh
set -eu

case "${TLS_ENABLED:-false}" in
  true|false) ;;
  *) echo "TLS_ENABLED must be true or false" >&2; exit 1 ;;
esac

if [ "${TLS_ENABLED:-false}" = "true" ]; then
  : "${TLS_CERT_FILE:=/etc/nginx/certs/fullchain.pem}"
  : "${TLS_KEY_FILE:=/etc/nginx/certs/privkey.pem}"
  # Restrict paths to characters safe in both sed replacement and nginx config.
  case "${TLS_CERT_FILE}${TLS_KEY_FILE}" in
    *[!a-zA-Z0-9_./-]*) echo "Unsupported character in TLS file path" >&2; exit 1 ;;
  esac
  test -r "${TLS_CERT_FILE}" || { echo "TLS certificate not readable: ${TLS_CERT_FILE}" >&2; exit 1; }
  test -r "${TLS_KEY_FILE}" || { echo "TLS private key not readable: ${TLS_KEY_FILE}" >&2; exit 1; }
  sed -e "s|__TLS_CERT_FILE__|${TLS_CERT_FILE}|g" -e "s|__TLS_KEY_FILE__|${TLS_KEY_FILE}|g" /etc/nginx/templates/kiraa.https.conf > /etc/nginx/conf.d/kiraa.conf
else
  cp /etc/nginx/templates/kiraa.http.conf /etc/nginx/conf.d/kiraa.conf
fi

nginx -t
