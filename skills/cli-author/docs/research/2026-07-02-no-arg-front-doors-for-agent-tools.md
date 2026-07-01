# No-Arg Front Doors For Agent Tools, 2026-07

Purpose: capture newsroom research for `cli-author` guidance on no-argument CLI behavior in stateful agent and skill tools.

## Scope

- Window: 2026-06-01 to 2026-07-01.
- Method: `newsroom-investigate` with WOTS community scan, Firecrawl web search, Context7 framework-doc checks, and official OpenAI docs verification.
- Query: `CLI default command UX agent tools`.
- WOTS artifact: `/tmp/wots-cli-default-command-ux-agent-tools-4fe1/report.md`.
- Target question: what people are doing for no-arg front doors for skill-like agent tools.

## Bottom Line

- Generic CLI frameworks still bias toward help on no args.
- Stateful agent tools are drifting toward command-center front doors.
- Agent-tool front doors work best when they answer what exists, what changed, and what to do next.
- `skill-feedback` has enough repo-local state to justify a no-arg dashboard.
- The dashboard should launch human commands before diagnostics.

## Community Signal

WOTS returned 10 Reddit posts, 18 X posts, 0 YouTube videos, and 3 web fallback pages.
Reddit returned WOTS relevance scores but no raw upvote or comment counts.
X returned concrete engagement: 10,231 likes and 1,458 reposts across 18 posts.

Patterns:

- **Skill managers.** Community posts describe CLIs for installing, managing, or querying skills across Claude, Codex, Cursor, Windsurf, and related tools.
- **Proof gates.** Posts highlight CLIs that force verification before an agent can claim completion.
- **Security sweepers.** Agent-specific CLI tools expose local state and safe remediation paths.
- **Command centers.** AI-agent command center posts frame the default surface as a control plane, not only a help page.
- **Agent-native CLI design.** Community language is moving from UX to AX: discoverable commands, structured output, bounded context, and repair hints for agents.

High-signal community sources:

- [Centralized Skill Management for Multiple Claude Agents with `skillm` CLI](https://www.reddit.com/r/ClaudeAI/comments/1u5yy9j/workflow_centralized_skill_management_for/)
- [Proof-Gated AI Agent Completion: A CLI Tool to Verify Test Runs Before 'Done'](https://www.reddit.com/r/ClaudeWorkflows/comments/1uefiu4/workflow_proofgated_ai_agent_completion_a_cli/)
- [Skill for building agent-native CLIs](https://www.reddit.com/r/AI_Agents/comments/1tii60t/skill_for_building_agentnative_clis/)
- [cli tools are back and its not nostalgia, agents just cant click buttons](https://www.reddit.com/r/node/comments/1spwgau/cli_tools_are_back_and_its_not_nostalgia_agents/)
- [AI CLI command center](https://www.reddit.com/r/commandline/comments/1qxdn2f/showcase_i_built_a_command_center_for_ai_cli/)
- [Teneo CLI agent-querying post](https://x.com/teneo_protocol/status/2067648649820012738) - 1,061 likes, 706 reposts.
- [Claude Platform CLI post](https://x.com/ClaudeDevs/status/2061877343078244459) - 7,016 likes, 554 reposts.
- [UI Skills CLI post](https://x.com/Ibelick/status/2066877763672256755) - 729 likes, 44 reposts.

Treat community posts as pressure signals, not authority.

## Verified Signals

- [OpenAI Agent Skills docs](https://developers.openai.com/codex/skills) say skills are available in Codex CLI, IDE extension, and Codex app.
- OpenAI docs describe explicit skill invocation through `/skills` or `$skill`, and implicit invocation when a task matches the skill description.
- Context7 verified Click docs: Click automatically generates help pages, and a group invoked without a subcommand displays its help page by default unless `invoke_without_command=True` changes behavior.
- Context7 verified Typer docs: `typer.Typer(no_args_is_help=True)` displays help when no arguments are given.
- Context7 verified Cobra docs: Cobra initializes default help command and help flag behavior during execution or help/usage handling.

Supplemental Firecrawl check on 2026-07-02 for `stateful CLI no arguments dashboard command center default command help UX` returned mostly generic argument/help guidance. It did not change the design conclusion: public framework defaults still bias to help, while stateful agent-tool dashboard guidance remains an adjacent pattern rather than a mature official CLI category.

## Design Impact For `cli-author`

- Preserve help-on-no-args as the default for stateless CLIs or CLIs with no obvious current state.
- Prefer a dashboard on no args when the CLI owns meaningful state, recent activity, health, or a work queue.
- Keep the no-arg dashboard small enough to act as a launcher, not a report dump.
- Put the top 3-5 useful next commands on the first screen.
- Demote diagnostics unless the tool is broken, unsafe, unauthenticated, or unreadable.
- Show diagnostic commands in an advanced block, not as the primary path.
- Use no-arg state gates:
  - Empty state -> show getting-started help.
  - Populated state -> show dashboard and command launcher.
  - Unsafe or unreadable state -> show repair path.
  - Destructive work available -> show preview command, not execute.

## Implication For `skill-feedback`

`skill-feedback` should keep no-arg as a dashboard because it has repo-local inbox state.
The current product issue is not that no-arg shows a dashboard; it is that the dashboard routes to internal correlation repair before human value.

Recommended shape:

```text
skill-feedback

Reports: 255 primary, 552 low-signal
Newest: <timestamp>
Top signals: <short human summary>

Next:
  reports   browse recent reports
  usage     see skills being used
  queue     see what to improve next
  report X  open one useful report

Diagnostics:
  health | review | correlate | purge
```

The no-arg command should answer:

- Show me the reports.
- Show me what skills are used.
- Show me what to improve next.
- Show me diagnostics only when I ask or the inbox is broken.

## Caveats

- WOTS Reddit results lacked raw upvote and comment counts.
- The fact-checker subagent timed out; verification was completed directly with official OpenAI docs and Context7.
- The research found adjacent patterns, not a mature category exactly matching `skill-feedback`.
