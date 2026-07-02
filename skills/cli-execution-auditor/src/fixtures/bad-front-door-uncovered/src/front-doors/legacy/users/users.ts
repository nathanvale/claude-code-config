#!/usr/bin/env bun
// Nested shippable front door with no command-contract.ts. The auditor should
// attribute this uncovered surface to legacy/users, not just legacy.

process.stdout.write("legacy users clean\n");
process.exit(0);
