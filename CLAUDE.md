# Stunts web remake

Browser remake of the 1990 DOS game Stunts (Vite + TypeScript + Three.js, Supabase leaderboard).
Plan: MVP = one car, one tile track (road, corners, ramp, loop) loaded from TRK, lap timing, online leaderboard, deployed.

Before working, load the relevant project skills:
- `stunts-project-conventions` — architecture, determinism rules, commands, DB, deploy
- `stunts-track-format` — TRK file spec and tile codes
- `stunts-game-reference` — how the original game plays

Original Stunts files: `public/original/` holds exactly the files the game reads at runtime, published
with the site by the owner's decision (2026-10-18). Add a file there only when the game starts
loading it; never commit the rest of `original_game/`. Never copy restunts code (read it for facts only).

Deploy: every push to `main` builds and publishes to GitHub Pages (`.github/workflows/deploy.yml`,
site under `/stunts_web_remake/`). `.env.production` holds the public Supabase client settings.
