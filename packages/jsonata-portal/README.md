# JSONata Portal

A Lambda-based Agent Web Portal that provides JSONata expression evaluation capabilities.

## Overview

This package provides an AWS Lambda-based AWP with:
- **1 Tool**: `jsonata_eval` - Evaluate JSONata expressions against JSON input
- **2 Skills**: 
  - `automata-transition` - Finite automaton state transition calculations
  - `statistics` - Statistical calculations on record lists

## Structure

```
jsonata-portal/
├── src/
│   ├── handler.ts      # Lambda handler entry point
│   └── test.ts         # Local test script
├── skills/
│   ├── automata-transition/
│   │   └── SKILL.md    # Automata transition skill
│   └── statistics/
│       └── SKILL.md    # Statistics skill
├── template.yaml       # SAM template
├── package.json
└── README.md
```

## Development

### Install Dependencies

```bash
bun install
```

### Run Tests

```bash
bun run test
```

### Type Check

```bash
bun run typecheck
```

## Local Development with SAM

### Prerequisites

- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
- Docker (for local Lambda emulation)

### Build

```bash
bun run sam:build
```

### Start Local API

```bash
bun run sam:local
```

This starts a local API Gateway at `http://localhost:3000`.

### Test Endpoints

```bash
# Initialize
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'

# List Tools
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# List Skills
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"skills/list"}'

# Call jsonata_eval
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":4,
    "method":"tools/call",
    "params":{
      "name":"jsonata_eval",
      "arguments":{
        "expression":"$sum(values)",
        "input":{"values":[1,2,3,4,5]}
      }
    }
  }'
```

### Invoke Function Directly

```bash
bun run sam:invoke --event events/test.json
```

## Deployment

### First-time Deployment

```bash
bun run sam:deploy
```

This will guide you through the deployment process interactively.

### Subsequent Deployments

```bash
sam deploy
```

### Upload Skills to S3

After deployment, upload skills to the S3 bucket:

```bash
# Get the bucket name from stack outputs
SKILLS_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name jsonata-portal \
  --query 'Stacks[0].Outputs[?OutputKey==`SkillsBucketName`].OutputValue' \
  --output text)

# Upload skills using the AWS CLI tool
cd ../aws-cli
bun run bin/awp.ts upload --folder ../jsonata-portal/skills --bucket $SKILLS_BUCKET
```

## Tool: jsonata_eval

### Input Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `expression` | string | Yes | JSONata expression to evaluate |
| `input` | any | Yes | JSON input data to evaluate against |
| `bindings` | object | No | Optional variable bindings |

### Output Schema

| Field | Type | Description |
|-------|------|-------------|
| `result` | any | The evaluation result |
| `success` | boolean | Whether evaluation succeeded |
| `error` | string | Error message if failed |

### Example

```json
{
  "expression": "$sum(orders.amount)",
  "input": {
    "orders": [
      { "amount": 100 },
      { "amount": 200 },
      { "amount": 300 }
    ]
  }
}
```

**Result:**

```json
{
  "result": 600,
  "success": true
}
```

## Skills

### automata-transition

Use JSONata to compute finite automaton state transitions:
- Traffic light state machines
- DFA/NFA simulation
- State sequence processing

See [skills/automata-transition/SKILL.md](skills/automata-transition/SKILL.md)

### statistics

Use JSONata for statistical calculations:
- Sum, average, min, max, count
- Group by and aggregate
- Percentiles and standard deviation
- Time series analysis

See [skills/statistics/SKILL.md](skills/statistics/SKILL.md)

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SKILLS_BUCKET` | S3 bucket for skills storage | (required for skill download) |
| `AWS_REGION` | AWS region | `us-east-1` |

## JSONata Quick Reference

| Function | Description |
|----------|-------------|
| `$sum(array)` | Sum of numeric values |
| `$average(array)` | Arithmetic mean |
| `$count(array)` | Number of items |
| `$min(array)` | Minimum value |
| `$max(array)` | Maximum value |
| `$sort(array)` | Sort array |
| `$distinct(array)` | Unique values |
| `$lookup(obj, key)` | Safe property lookup |
| `$reduce(array, fn, init)` | Reduce array |
| `$map(array, fn)` | Transform elements |

For more, see [JSONata Documentation](https://docs.jsonata.org/).

## License

MIT
