Vercel database setup

This build now saves app data through /api/state instead of relying only on browser local storage.

What was added
1. package.json with @vercel/postgres
2. api/state.js serverless API
3. script.js updated to load and save from the database

How to deploy on Vercel
1. Create a new Vercel project from this folder
2. In the Vercel project dashboard, add Vercel Postgres
3. Redeploy the project

Notes
1. Vercel Postgres injects the required POSTGRES environment variables automatically
2. The app creates the app_state table automatically on first request
3. If the database is empty but the browser already has saved data, that data is pushed into the database once on first load
4. If the database is temporarily unavailable, the app falls back to browser local storage
