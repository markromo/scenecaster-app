#!/bin/bash
# Entry point for the full multi-run stress-test session. Wraps the ENTIRE
# session (not just one run) in caffeinate so the Mac can't sleep during the
# gaps between runs either, not just during active playback.
set -e
cd "$(dirname "$0")"

caffeinate -dimsu -w $$ &

node harness.js --run-all "$@"
