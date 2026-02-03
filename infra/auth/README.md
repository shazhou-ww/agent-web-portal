# AWP Shared Auth Infrastructure

Shared Cognito User Pool for all AWP applications.

## Features

- Single Cognito User Pool for unified user identity
- Google Sign-In support
- Microsoft Sign-In support
- Exports values for other stacks to reference

## Deployment

1. Configure environment variables in root `.env`:

```bash
COGNITO_DOMAIN=awp-auth           # Required, globally unique
GOOGLE_CLIENT_ID=xxx              # Optional
GOOGLE_CLIENT_SECRET=xxx          # Optional
MICROSOFT_CLIENT_ID=xxx           # Optional
MICROSOFT_CLIENT_SECRET=xxx       # Optional
```

1. Deploy:

```bash
cd infra/auth
bun run deploy
```

1. Configure OAuth redirect URIs in Google/Microsoft console:

```
https://<COGNITO_DOMAIN>.auth.us-east-1.amazoncognito.com/oauth2/idpresponse
```

## Exported Values

Other CloudFormation stacks can reference these values:

| Export Name | Description |
|-------------|-------------|
| `awp-auth-UserPoolId` | Cognito User Pool ID |
| `awp-auth-UserPoolArn` | Cognito User Pool ARN |
| `awp-auth-CognitoDomainPrefix` | Cognito domain prefix |
| `awp-auth-CognitoHostedUiUrl` | Full Hosted UI URL |
| `awp-auth-HasGoogleIdP` | "true" if Google configured |
| `awp-auth-HasMicrosoftIdP` | "true" if Microsoft configured |

## Usage in Other Stacks

Reference the shared User Pool in your application's `template.yaml`:

```yaml
Parameters:
  AuthStackName:
    Type: String
    Default: "awp-auth"

Resources:
  MyUserPoolClient:
    Type: AWS::Cognito::UserPoolClient
    Properties:
      UserPoolId: !ImportValue 
        Fn::Sub: "${AuthStackName}-UserPoolId"
      # ... your client config
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    awp-auth (this stack)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  User Pool  │  │  Google IdP │  │  Microsoft IdP      │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│                           │                                 │
│                    Exports Values                           │
└───────────────────────────┼─────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
   ┌─────────┐        ┌──────────┐       ┌────────────┐
   │  casfa  │        │ img-ws   │       │  other app │
   │ Client  │        │ Client   │       │  Client    │
   └─────────┘        └──────────┘       └────────────┘
```
