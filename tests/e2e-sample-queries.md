# LegiScan MCP Server - E2E Sample Queries

These queries mirror the AutoSkeleton analysis pipeline from April 2025.
Use these to verify the MCP server functions correctly.

---

## 1. Session Discovery (Find available sessions)

**Tool:** `legiscan_get_session_list`

```json
{
  "state": "CA"
}
```

**Expected:** Returns session objects with `session_id`, `year_start`, `year_end`, `name`

---

## 2. Bill Search by Keyword (Like scorecard extraction)

**Tool:** `legiscan_search`

```json
{
  "query": "housing",
  "state": "CA",
  "year": 2
}
```

**Expected:** Returns `searchresult.summary` with count + paginated bill results with `bill_id`, `relevance`, `title`

---

## 3. Bill Search by Bill Number (Stage 2 workflow)

**Tool:** `legiscan_search`

```json
{
  "query": "AB 1234",
  "state": "CA",
  "year": 1
}
```

**Expected:** Returns matching bills with `bill_id` for detailed lookup

---

## 4. Get Bill Details (Stage 3 enrichment)

**Tool:** `legiscan_get_bill`

```json
{
  "bill_id": 1234567
}
```

*Note: Replace with actual bill_id from search results*

**Expected:** Full bill object with:
- `sponsors[]` (with `people_id`)
- `history[]` (actions)
- `votes[]` (with `roll_call_id`)
- `texts[]` (with `doc_id` for text retrieval)

---

## 5. Get Roll Call Votes (Stage 4 salience)

**Tool:** `legiscan_get_roll_call`

```json
{
  "roll_call_id": 3456789
}
```

*Note: Replace with actual roll_call_id from bill.votes[]*

**Expected:** Returns:
- `yea`, `nay`, `nv`, `absent` counts
- `votes[]` with individual legislator votes (`people_id`, `vote_id`, `vote_text`)

---

## 6. Get Legislator Info (Party break detection)

**Tool:** `legiscan_get_person`

```json
{
  "people_id": 12345
}
```

*Note: Replace with actual people_id from sponsors or roll call votes*

**Expected:** Returns `party`, `role`, `district`, `name`, external IDs

---

## 7. Get All Session Legislators

**Tool:** `legiscan_get_session_people`

```json
{
  "session_id": 2024
}
```

*Note: Replace with actual session_id from getSessionList*

**Expected:** Returns list of all active legislators with `people_id`, `party`, `role`

---

## 8. Get Primary-Authored Bills

**Tool:** `legiscan_get_primary_authored`

```json
{
  "people_id": 12345,
  "state": "CA"
}
```

**Expected:** Returns only bills where this legislator is the primary author

---

## Complete Workflow Test Sequence

This mirrors the AutoSkeleton pipeline stages:

### Step 1: Find a session
```
legiscan_get_session_list { "state": "PA" }
```
*Extract a `session_id` for Pennsylvania*

### Step 2: Search for a specific bill
```
legiscan_search { "query": "HB 1437", "state": "PA", "year": 2023 }
```
*Get the `bill_id` from results*

### Step 3: Fetch full bill details
```
legiscan_get_bill { "bill_id": <from_step_2> }
```
*Extract `texts[0].doc_id`, `votes[0].roll_call_id`, `sponsors[0].people_id`*

### Step 4: Fetch roll call for vote analysis
```
legiscan_get_roll_call { "roll_call_id": <from_step_3> }
```
*Analyze `yea`/`nay` margin, individual votes by party*

### Step 5: Fetch legislator party info
```
legiscan_get_person { "people_id": <from_step_3_or_5> }
```
*Compare legislator `party` against roll call majority for party break detection*

---

## Real Data Examples (Use for actual testing)

### California 2024 Session
```json
// 1. Get sessions
{ "tool": "legiscan_get_session_list", "args": { "state": "CA" } }

// 2. Search current housing bills
{ "tool": "legiscan_search", "args": { "query": "housing affordability", "state": "CA", "year": 2 } }
```

### Federal Congress
```json
// Search federal bills
{ "tool": "legiscan_search", "args": { "query": "infrastructure", "state": "US", "year": 2 } }
```
