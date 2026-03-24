# Confluence Skill Examples

## Basic Usage

```
/confluence POS-3044
```
Fetches title from JIRA, asks for reviewer, creates page under default GMS Technical Plans parent.

## With Title

```
/confluence POS-3044 Distributor-Specific Handling for Bulk Print Orders
```
Uses provided title, skips JIRA title fetch.

## Custom Parent Page

```
/confluence POS-3044 --parent 13808602239
```
Creates page directly under Architecture - Projects instead of GMS Technical Plans.

## Real Example: POS-3044

**Input:** `/confluence POS-3044 Bulk Print - Distributor Specific Handling`

**What happened:**
1. Resolved ticket: POS-3044
2. Title: "POS-3044: Bulk Print - Distributor Specific Handling — Technical Plan"
3. Reviewer: June Xu
4. Parent: Gift Card (GMS) Technical Plans (15317172325)
5. Created page with 4-phase technical plan
6. Added JIRA comment linking to page

**Output:**
```
Page created: https://bunnings.atlassian.net/wiki/spaces/TDM/pages/15316746363
JIRA comment added to POS-3044
Created tech plan for POS-3044 under Gift Card (GMS) Technical Plans
```

## Notes

- The plan content must already exist in the conversation context before invoking this skill
- If you haven't discussed the plan yet, generate it first (e.g., via `/kickoff` or manual discussion)
- The skill transforms conversation context into Confluence storage format HTML
- JIRA comments use the `jira` CLI, not curl
