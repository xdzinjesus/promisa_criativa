#!/usr/bin/env bash
# Garante o comando gsd-sdk (usado pelos workflows do GSD) em sessões novas.
# Instala em segundo plano para não atrasar o início da sessão. Versão fixada.
command -v gsd-sdk >/dev/null 2>&1 && exit 0
command -v npm >/dev/null 2>&1 || exit 0
nohup npm install -g get-shit-done-cc@1.42.3 --silent >/dev/null 2>&1 &
exit 0
