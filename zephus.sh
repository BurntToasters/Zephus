#!/bin/sh
# Flatpak launcher for Zephus. Enables Wayland when available and falls back to X11.
exec zypak-wrapper /app/zephus/zephus "$@"
