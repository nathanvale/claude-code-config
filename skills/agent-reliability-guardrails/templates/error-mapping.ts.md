# Template: Error Code to Agent Hint Mapping

```ts
type AgentHint = {
  action: string
  retryable: boolean
  errorFamily: 'auth' | 'scope' | 'network' | 'rate_limit' | 'server' | 'validation' | 'conflict' | 'runtime' | 'interrupted'
  confidence?: 'high' | 'medium' | 'low'
  blocking?: boolean
  recommendedDelayMs?: number
  suggestedFallbacks?: string[]
  safeToRetrySameInput?: boolean
  idempotencyRisk?: 'none' | 'low' | 'high'
}

export const ERROR_CODE_ACTIONS: Record<string, AgentHint> = {
  E_USAGE: {
    action: 'FIX_ARGS',
    retryable: false,
    errorFamily: 'validation',
    confidence: 'high',
    blocking: true,
    idempotencyRisk: 'none',
    suggestedFallbacks: ['fix_args', 'show_help'],
  },
  E_RATE_LIMITED: {
    action: 'WAIT_AND_RETRY',
    retryable: true,
    errorFamily: 'rate_limit',
    confidence: 'high',
    blocking: true,
    recommendedDelayMs: 30000,
    safeToRetrySameInput: true,
    idempotencyRisk: 'none',
    suggestedFallbacks: ['wait_and_retry'],
  },
  E_RUNTIME: {
    action: 'ESCALATE',
    retryable: false,
    errorFamily: 'runtime',
    confidence: 'low',
    blocking: true,
    idempotencyRisk: 'high',
    suggestedFallbacks: ['escalate'],
  },
}
```
