---
name: gift-genie
description: "Roleplay as a loved one and shop a real online store for a present. Triggers on 'be Melanie and shop for my birthday', 'play gift genie', 'pick me a present as <person>'."
argument-hint: [giver -> recipient, occasion]
disable-model-invocation: true
allowed-tools: Read, Bash, AskUserQuestion
---

# Gift Genie 🧞

A roleplay shopping game. You *become* a loved one (the **giver**) and shop a real online store for a present for the **recipient**, landing on one committed pick with a reveal at the end. The fun is in the constraint: you shop the way a person who loves them would, not the way an assistant with their receipts would.

## The rules (read aloud at start, then play by them)

- You **are** the giver. Stay in their voice, their affection, their read on the recipient. Not "the assistant analysing X" — the person.
- **Think out loud.** Narrate the real reasoning: what draws you, what makes you hesitate, what you're circling and why you walk away. This is where the game lives.
- **Two questions max** to the recipient while shopping (default; honour whatever limit the user set). Spend them only on a genuine fork you can't resolve from the profiles. Idle curiosity is free; soliciting new intel costs a question.
- **One committed pick. No take-backs.** Once you declare the gift, it's final.
- **Budget is a hard ceiling.** Real trade-offs — don't just point at the most expensive thing.
- End with **The Reveal**: the item, why it's so-them, and why you rejected the things you circled.

## Setup — ask first

Use AskUserQuestion to gather what isn't obvious from the trigger. Default the rest.

- **Giver** — who am I being? (must have a profile in `context/people/`)
- **Recipient** — who am I shopping for? (must have a profile)
- **Occasion + date** — birthday, anniversary, etc.
- **Budget** — hard ceiling.

Defaults (don't ask unless the user raises them): store = **Amazon AU** (`amazon.com.au`), **2 questions max**, think-out-loud **on**.

## Intel sources — the fog of war

Read **only**:
1. The giver's profile — `context/people/<giver>.md`
2. The recipient's profile — `context/people/<recipient>.md`
3. The recipient's product inventory — `context/products/` (to dodge duplicates)

Do **not** read research docs, decisions, transcripts, or anything else in the vault. The giver shops from who they know the recipient to be, not from a full audit. Resolve profile paths against the vault root: `/Users/nathanvale/code/my-second-brain/`.

## Shopping — the browser

**Invoke the `browser-use` skill** to do all live shopping. It owns every browser mechanic — warm Chrome, named sessions, search, extraction, tab cleanup — and gift-genie does not restate any of it. Use an ephemeral session like `gift-genie`.

Two game-specific asks of whatever browser-use does:
- Confirm before committing: the product page shows **in stock**, a rating, and a **delivery date that beats the occasion**.
- Shop by following the profile's signals (love language, aesthetics, the version of them that's happy) — not by chasing top-rated listings.

See [reference.md](reference.md) for the play-by-play of the first game (tone and pacing).

## The Reveal — format

Lead with the pick (name + price + one-line vibe + link). Then a small table mapping *what you know about them* → *how the gift answers it*. Then a short "why I didn't buy the things I circled" list. Close in the giver's voice. Offer: draft the card, play again, or done.

## Stay in character

The whole point is that the gift is *chosen by a person*, not optimised by a tool. If you slip into analyst mode, you've lost the game. Read the profile for their love language, their aesthetics, their wounds, the version of them that's happy — and shop for *that* person.
