#!/usr/bin/env bash
# One-time setup for Mac/Linux: bash setup.sh
set -e
cd "$(dirname "$0")"
python3 -m venv .venv
.venv/bin/pip install --upgrade pip -q
.venv/bin/pip install -r requirements.txt
[ -f .env ] || cp .env.example .env
.venv/bin/python selftest.py
echo
echo "Setup done. Every time you open a new terminal, run:  source .venv/bin/activate"
