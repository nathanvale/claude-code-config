---
name: flight-search
description: Search for flights using agent-browser and Google Flights. Use when the user wants to find, compare, or choose flights for a trip.
argument-hint: <origin> <destination> [date]
disable-model-invocation: true
---

# Flight Search

Search for flights using agent-browser with Google Flights, compare options, and optionally help the user narrow down the best flight using a "work backwards from constraint" technique.

## Quick Start

1. Gather trip details (origin, destination, dates, passengers)
2. Search Google Flights with agent-browser
3. Present all options in a reference table
4. Optionally apply the backwards constraint technique to recommend a flight

## Process

### Step 1: Gather Details

Ask the user for anything not already provided:

- **Origin city/airport**
- **Destination city/airport**
- **Date(s)** -- one-way or return
- **Number of passengers**
- **Preferences** -- time of day, airline, budget, nonstop only, etc.

### Step 2: Search Google Flights

Use agent-browser to search Google Flights. This is the proven approach -- airline direct sites (Jetstar, Virgin Australia, etc.) typically block headless browsers.

```bash
# Open Google Flights with pre-filled query
agent-browser open "https://www.google.com/travel/flights?q=flights+from+ORIGIN+to+DESTINATION+on+YYYY-MM-DD"

# Get flight results from the accessibility snapshot
agent-browser snapshot -i
```

The snapshot returns interactive elements including flight links with full details: departure time, arrival time, airline, stops, duration, and round-trip price.

Parse all flight options from the snapshot output. If there are more results, use:

```bash
agent-browser click @eN  # "View more flights" button
agent-browser snapshot -i
```

Close the browser when done:

```bash
agent-browser close
```

Repeat for each leg (outbound and return) as separate searches.

### Step 3: Present Results

Show all flights in a markdown table, sorted by departure time:

```
| Depart | Arrive | Airline | Stops | Duration | Price (RT) |
|--------|--------|---------|-------|----------|------------|
| 6:25 AM | 9:45 AM | Jetstar | Nonstop | 3h 20m | $540 |
```

Note that Google Flights prices are estimates and will change. Include the search date.

### Step 4: Narrow Down (Optional)

If the user has a real-world constraint (e.g., "arrive before dark", "home by dinner", "need to catch a ferry"), offer the **backwards constraint technique**:

1. **Find the hard constraint** -- look up the actual data (sunset time, event start, check-in deadline, etc.) using WebSearch or WebFetch
2. **Work backwards step by step** -- subtract each leg of the journey from the constraint time:
   - Ground transport from airport to destination (or destination to airport)
   - Bags and car rental pickup/return time (~30-45 min)
   - A delay buffer (suggest 1-2 hours, let user choose)
3. **Calculate the cutoff** -- the latest acceptable landing time
4. **Filter the table** -- highlight which flights make the cutoff and which don't
5. **Recommend** -- the best value flight that comfortably fits

Present the backwards logic as a simple table so the user can follow and adjust:

```
| Step | Time | Notes |
|------|------|-------|
| Hard constraint | 5:58 PM | Sunset at destination |
| Arrive destination | 3:58 PM | 2hr before constraint |
| Leave airport | 1:58 PM | After 2hr drive |
| Land by | 1:13 PM | After 45min bags/car |
| With 1hr buffer | 12:15 PM | Latest comfortable landing |
```

If the user doesn't have a specific constraint, just present the full table and let them choose.

### Step 5: Confirm Selection

When the user picks a flight, summarize the selection and note:

- The flight is **not yet booked** -- the user must book directly with the airline or through a booking site
- Google Flights links can redirect to the airline's booking page in a real browser
- Budget airlines (Jetstar, etc.) charge extra for checked bags and seat selection -- flag this
- Note the number of passengers for total price awareness

## Known Limitations

- **Airline direct sites block headless browsers** -- Jetstar returns HTTP2 protocol errors, Virgin Australia's booking form doesn't work well with accessibility snapshots. Google Flights is the reliable workaround.
- **Prices are estimates** -- Google Flights round-trip prices change frequently. Always note the search date.
- **Cannot book flights** -- this skill finds and compares flights only. The user handles the actual booking.

## Done When

- [ ] All legs searched and results captured
- [ ] Full flight table(s) presented to the user
- [ ] Backwards constraint applied if user had one
- [ ] User has selected their preferred flight(s)
- [ ] Booking notes provided (not yet booked, bag fees, passenger count)
