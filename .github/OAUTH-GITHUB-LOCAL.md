GITHUB OAuth local configuration

Status: Credentials written to local .env but NOT committed (file is ignored by .gitignore).

Env keys set locally:
- GITHUB_CLIENT_ID
- GITHUB_CLIENT_SECRET

Notes:
- .env is ignored in this repo; credentials were applied locally to enable OAuth runtime verification only.
- Do NOT push these secrets to a public repository.

Redirect URIs to register in GitHub OAuth App (register at https://github.com/settings/developers):
- Production (recommended): https://app.ooplix.com/oauth/github/callback
- Local dev (for verification): http://localhost:5050/oauth/github/callback

Recommended OAuth scopes to request:
- read:user
- repo
- read:org

Next steps performed locally:
1. scripts/check-startup-env.cjs run and reported PASS for required env variables.
2. Backend is ready to accept OAuth callbacks at /oauth/github/callback once the server is started.

To complete verification (action required):
- Open the following authorization URL in a browser (replace redirect_uri if you registered a different one):

  https://github.com/login/oauth/authorize?client_id=Ov23liWakUpOp6wqVfYP&redirect_uri=http://localhost:5050/oauth/github/callback&scope=read:user%20repo%20read:org

- Authorize the app, then return here and paste the full callback URL (the browser will be redirected) so the assistant can continue with token exchange and validation.

If you want the assistant to start the server and perform the callback handling automatically, reply 'Yes' to allow starting the backend server now.
