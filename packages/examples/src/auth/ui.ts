/**
 * Auth Page HTML Templates
 *
 * Simple HTML templates for the AWP auth flow.
 * In production, replace with your own authentication system.
 */

/**
 * Generate the login page HTML
 */
export function getAuthPageHtml(error?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AWP Authorization</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      padding: 40px;
      width: 100%;
      max-width: 400px;
    }
    h1 {
      color: #333;
      font-size: 24px;
      margin-bottom: 8px;
      text-align: center;
    }
    .subtitle {
      color: #666;
      font-size: 14px;
      text-align: center;
      margin-bottom: 30px;
    }
    .verification-code {
      background: #f0f4ff;
      border: 2px dashed #667eea;
      border-radius: 8px;
      padding: 16px;
      text-align: center;
      margin-bottom: 24px;
    }
    .verification-code label {
      display: block;
      color: #666;
      font-size: 12px;
      margin-bottom: 8px;
    }
    .verification-code .code {
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 28px;
      font-weight: bold;
      color: #667eea;
      letter-spacing: 4px;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      color: #333;
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 6px;
    }
    input[type="text"], input[type="password"] {
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 16px;
      transition: border-color 0.2s;
    }
    input:focus {
      outline: none;
      border-color: #667eea;
    }
    button {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }
    .error {
      background: #fff0f0;
      border: 1px solid #ffcdd2;
      color: #c62828;
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 14px;
    }
    .test-users {
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid #eee;
    }
    .test-users h3 {
      color: #666;
      font-size: 12px;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .test-users code {
      display: block;
      background: #f5f5f5;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 13px;
      margin-bottom: 4px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorize Application</h1>
    <p class="subtitle">Enter your credentials to authorize the MCP client</p>
    
    <div class="verification-code">
      <label>Verification Code from Client</label>
      <div class="code" id="display-code">---</div>
    </div>
    
    ${error ? `<div class="error">${error}</div>` : ""}
    
    <form method="POST" action="/auth/login">
      <input type="hidden" name="verification_code" id="verification_code" value="">
      <input type="hidden" name="pubkey" id="pubkey" value="">
      
      <div class="form-group">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" required autocomplete="username">
      </div>
      
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required autocomplete="current-password">
      </div>
      
      <button type="submit">Authorize</button>
    </form>
    
    <div class="test-users">
      <h3>Test Accounts</h3>
      <code>test / test123</code>
      <code>admin / admin123</code>
      <code>demo / demo</code>
    </div>
  </div>
  
  <script>
    // Parse URL parameters
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code') || '';
    const pubkey = params.get('pubkey') || '';
    
    document.getElementById('display-code').textContent = code || '---';
    document.getElementById('verification_code').value = code;
    document.getElementById('pubkey').value = pubkey;
  </script>
</body>
</html>`;
}

/**
 * Generate the success page HTML
 */
export function getAuthSuccessHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorization Complete</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      padding: 60px 40px;
      width: 100%;
      max-width: 400px;
      text-align: center;
    }
    .checkmark {
      width: 80px;
      height: 80px;
      background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
    }
    .checkmark svg {
      width: 40px;
      height: 40px;
      stroke: white;
      stroke-width: 3;
      fill: none;
    }
    h1 {
      color: #333;
      font-size: 24px;
      margin-bottom: 12px;
    }
    p {
      color: #666;
      font-size: 16px;
      line-height: 1.5;
    }
    .note {
      margin-top: 24px;
      padding: 16px;
      background: #f0fdf4;
      border-radius: 8px;
      color: #166534;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="checkmark">
      <svg viewBox="0 0 24 24">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </div>
    <h1>Authorization Complete!</h1>
    <p>The MCP client has been authorized. You can close this window and return to your application.</p>
    <div class="note">
      The client is now polling for authorization status and will automatically detect this approval.
    </div>
  </div>
</body>
</html>`;
}
