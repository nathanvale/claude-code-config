---
target_cli: use-storybook/storybook-doctor
status: active
---

# CLI Execution Audit: use-storybook/storybook-doctor

## Truth Stance

- This file is audit state, not canonical CLI instruction.
- Findings derive from lane-contract clause assertions, not free-text review.
- A finding closes only when its clause re-check passes against the post-fix CLI.

## Open Findings

- **station-map** (station) `sig_00d860392a83f6c5` — status: open
  - summary: check.manager_ok_mcp_missing is missing for declared_branch_coverage.
  - recheck: station=check.manager_ok_mcp_missing command=check finding=missing
- **station-map** (station) `sig_03f7427e40c9abea` — status: open
  - summary: commands.discovery_json is missing for declared_branch_coverage.
  - recheck: station=commands.discovery_json command=commands finding=missing
- **station-map** (station) `sig_0c56ffd35a016af3` — status: open
  - summary: check.non_loopback_url is missing for declared_branch_coverage.
  - recheck: station=check.non_loopback_url command=check finding=missing
- **station-map** (station) `sig_274aa3e99cd8540b` — status: open
  - summary: check.no_storybook_config is missing for declared_branch_coverage.
  - recheck: station=check.no_storybook_config command=check finding=missing
- **station-map** (station) `sig_2e0a2a84ea4c2815` — status: open
  - summary: check.mcp_tools_ready is missing for declared_branch_coverage.
  - recheck: station=check.mcp_tools_ready command=check finding=missing
- **station-map** (station) `sig_2e972e58e556ec1e` — status: open
  - summary: check.no_mcp_addon_config is missing for declared_branch_coverage.
  - recheck: station=check.no_mcp_addon_config command=check finding=missing
- **station-map** (station) `sig_312feb5c64a6a74c` — status: open
  - summary: check.invalid_repo is missing for declared_branch_coverage.
  - recheck: station=check.invalid_repo command=check finding=missing
- **station-map** (station) `sig_50983a453861fe6c` — status: open
  - summary: check.no_live_session is missing for declared_branch_coverage.
  - recheck: station=check.no_live_session command=check finding=missing
- **station-map** (station) `sig_67001248e6f4b765` — status: open
  - summary: check.no_storybook_dependency is missing for declared_branch_coverage.
  - recheck: station=check.no_storybook_dependency command=check finding=missing
- **station-map** (station) `sig_6b42905bbded26ce` — status: open
  - summary: check.help_top_level is missing for declared_branch_coverage.
  - recheck: station=check.help_top_level command=check finding=missing
- **station-map** (station) `sig_74368a1f8a626e90` — status: open
  - summary: deep.local_storybook_binary_missing is missing for declared_branch_coverage.
  - recheck: station=deep.local_storybook_binary_missing command=deep finding=missing
- **station-map** (station) `sig_7bf44e5d80cc7417` — status: open
  - summary: deep.storybook_doctor_nonzero is missing for declared_branch_coverage.
  - recheck: station=deep.storybook_doctor_nonzero command=deep finding=missing
- **station-map** (station) `sig_7d937c21d9ec2523` — status: open
  - summary: check.ready is missing for declared_branch_coverage.
  - recheck: station=check.ready command=check finding=missing
- **station-map** (station) `sig_95adbf1cebb92fe4` — status: open
  - summary: check.mcporter_missing_raw_mcp_ready is missing for declared_branch_coverage.
  - recheck: station=check.mcporter_missing_raw_mcp_ready command=check finding=missing
- **station-map** (station) `sig_c62ab5a720343ff3` — status: open
  - summary: deep.ready_with_local_doctor is missing for declared_branch_coverage.
  - recheck: station=deep.ready_with_local_doctor command=deep finding=missing
- **station-map** (station) `sig_cea57a85d375fc99` — status: open
  - summary: check.no_package_json is missing for declared_branch_coverage.
  - recheck: station=check.no_package_json command=check finding=missing
- **station-map** (station) `sig_da56bc9ce45b191d` — status: open
  - summary: check.no_storybook_script is missing for declared_branch_coverage.
  - recheck: station=check.no_storybook_script command=check finding=missing
- **station-map** (station) `sig_e4ff4d91946f493c` — status: open
  - summary: check.version_stdout is missing for declared_branch_coverage.
  - recheck: station=check.version_stdout command=check finding=missing
- **station-map** (station) `sig_e741a32bc62253fa` — status: open
  - summary: check.no_mcp_addon_dependency is missing for declared_branch_coverage.
  - recheck: station=check.no_mcp_addon_dependency command=check finding=missing


## Finding History

- None yet.
