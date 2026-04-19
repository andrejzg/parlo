interface AuthorizePageParams {
  clientName?: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  error?: string;
}

export function renderAuthorizePage(params: AuthorizePageParams): string {
  const {
    clientName,
    clientId,
    redirectUri,
    state,
    codeChallenge,
    codeChallengeMethod,
    error,
  } = params;

  const displayName = clientName || "An application";
  const escapedError = error
    ? error.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connect to Parlo</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700&family=Inter:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', sans-serif;
      background: hsl(225 20% 6%);
      color: hsl(0 0% 92%);
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      width: 100%;
      max-width: 400px;
      background: hsl(225 18% 10%);
      border: 1px solid hsl(225 15% 18%);
      border-radius: 16px;
      padding: 40px 32px;
    }
    .logo {
      font-family: 'Syne', sans-serif;
      font-weight: 700;
      font-size: 28px;
      color: hsl(22 95% 62%);
      margin-bottom: 8px;
    }
    h1 {
      font-family: 'Syne', sans-serif;
      font-weight: 600;
      font-size: 22px;
      margin-bottom: 8px;
    }
    .subtitle {
      font-size: 14px;
      color: hsl(0 0% 60%);
      margin-bottom: 32px;
      line-height: 1.5;
    }
    .error {
      background: hsl(0 60% 20%);
      border: 1px solid hsl(0 50% 35%);
      color: hsl(0 80% 80%);
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 14px;
      margin-bottom: 24px;
    }
    .divider {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 24px 0;
      color: hsl(0 0% 40%);
      font-size: 13px;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: hsl(225 15% 18%);
    }
    label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 8px;
      color: hsl(0 0% 75%);
    }
    input[type="text"] {
      width: 100%;
      padding: 12px 16px;
      background: hsl(225 20% 6%);
      border: 1px solid hsl(225 15% 22%);
      border-radius: 8px;
      color: hsl(0 0% 92%);
      font-size: 15px;
      font-family: 'Inter', sans-serif;
      outline: none;
      transition: border-color 0.15s;
    }
    input[type="text"]::placeholder { color: hsl(0 0% 35%); }
    input[type="text"]:focus { border-color: hsl(22 95% 62%); }
    .btn {
      display: block;
      width: 100%;
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      font-family: 'Inter', sans-serif;
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.9; }
    .btn-primary {
      background: hsl(22 95% 62%);
      color: hsl(225 20% 6%);
      margin-top: 16px;
    }
    .btn-secondary {
      background: hsl(225 15% 18%);
      color: hsl(0 0% 80%);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">parlo</div>
    <h1>Connect to Parlo</h1>
    <p class="subtitle">${displayName} wants to access your Parlo account.</p>

    ${escapedError ? `<div class="error">${escapedError}</div>` : ""}

    <form method="POST" action="/authorize">
      <input type="hidden" name="client_id" value="${clientId}" />
      <input type="hidden" name="redirect_uri" value="${redirectUri}" />
      <input type="hidden" name="state" value="${state}" />
      <input type="hidden" name="code_challenge" value="${codeChallenge}" />
      <input type="hidden" name="code_challenge_method" value="${codeChallengeMethod}" />

      <label for="api_key">Enter your existing API key</label>
      <input type="text" id="api_key" name="api_key" placeholder="pk_..." autocomplete="off" spellcheck="false" />
      <button type="submit" name="action" value="enter_key" class="btn btn-primary">Connect</button>

      <div class="divider">or</div>

      <button type="submit" name="action" value="create_new" class="btn btn-secondary">Create new account</button>
    </form>
  </div>
</body>
</html>`;
}
