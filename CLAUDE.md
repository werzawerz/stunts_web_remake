# Stunts web remake

Browser remake of the 1990 DOS game Stunts (Vite + TypeScript + Three.js, Supabase leaderboard).
Plan: MVP = one car, one tile track (road, corners, ramp, loop) loaded from TRK, lap timing, online leaderboard, deployed.

Before working, load the relevant project skills:
- `stunts-project-conventions` — architecture, determinism rules, commands, DB, deploy
- `stunts-track-format` — TRK file spec and tile codes
- `stunts-game-reference` — how the original game plays

Only our own assets — never bundle original Stunts files or copy restunts code.
