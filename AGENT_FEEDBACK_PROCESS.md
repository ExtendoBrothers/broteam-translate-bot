# Agent Feedback Process

## Purpose
This document describes the process for the AI agent to provide feedback on pending tweets using established heuristics when requested by the user.

**Note:** The bot now automatically incorporates user-defined heuristics into its humor scoring system. The selection process uses:
- ML-powered humor detection (primary)
- User-defined heuristic evaluation (bonus/penalty)
- Existing hardcoded bonuses for coherence, absurdity, etc.

## When to Use
User will say something like:
- "process the pending feedback queue"
- "apply heuristics to pending tweets"
- "provide feedback on the queue"
- Or reference this document directly

## Automatic Selection Process
The bot now automatically:
1. Generates 3 random translation chains + 1 oldschool chain
2. Scores each using ML humor model
3. Applies user-defined heuristics from `feedback-heuristics.md` as bonus/penalty
4. Applies additional coherence/absurdity bonuses
5. Selects the highest-scoring result for posting
6. Saves all candidates and scores to `feedback-data.jsonl` for review

## Agent Feedback Process (When Requested)

The user supplies candidate selections, not star ratings. The agent must do both of the following for every pending tweet:
- select the best candidate using `feedback-heuristics.md`
- assign an independent agent rating from 1-5 based on the quality of that selected candidate

The agent rating is an assessment of the result, not a claim about user preference. It must be recorded and used for agent-quality diagnostics, pattern analysis, and explaining why a candidate won. It must not be treated as an independent user label or replayed into learned weights.

## Process Steps

### 1. Get Pending Tweets
Run: `node scripts/pending-feedback.js`

This will show all tweets waiting for feedback with their candidates.

### 2. Load Heuristics
Read and internalize the heuristics from: `feedback-heuristics.md`

Key heuristics include:
- Full sentences > fragments
- Setup-punchline structure preferred
- Sexual/crude references valued
- Complete coherent sentences over gibberish
- Never pick results identical to input (rate 1/5)
- Contradictions, extreme opinions, juxtapositions are funny
- References to: politics, crime, games, countries (esp. Canada), race, ethnicity, anatomy
- Foreign language mixing creates absurd juxtaposition
- Self-contradiction and questioning reality

### 3. Create Agent Feedback Log
Create/append to: `agent-feedback-log.md`

For each tweet, document:
- Tweet ID and original text
- Bot's selected option
- Agent's analysis of all candidates
- Why the chosen option is best (reference specific heuristics)
- Reasoning for rating
- Final rating, best source, and notes

Format example:
```markdown
## Tweet [ID]
**Original:** [text]
**Bot Selected:** [source] - "[text]"

**Agent Analysis:**
- [Analysis of candidates]
- [Why winner is best]
- [Rating reasoning]

**Rating:** X/5
**Best:** [SOURCE]
**Notes:** "[concise explanation]"
```

### 4. Add All Feedback
For each tweet, run:
```
node scripts/add-feedback.js [TWEET_ID] --rating [1-5] --best [SOURCE] --notes "[explanation]"
```

For batch processing, use `node scripts/auto-feedback-pending.js`. It writes `feedbackSource: "agent-auto"`, `learningEligible: false`, the agent-generated rating, the agent-selected best candidate, and concise reasoning. These records are included in feedback analysis and future heuristic review. Do not overwrite existing `user-manual` feedback unless explicitly asked to regrade it.

For a single user selection, use `node scripts/add-feedback.js <TWEET_ID> --best <SOURCE> --notes "..."`. A user rating is optional; if omitted, the agent rating remains the quality assessment for that record.

### 5. Confirm Completion
After all feedback is added, provide a brief summary:
- Total tweets processed
- Count by rating (how many 1s, 2s, 3s, 4s, 5s)
- Path to the detailed log file

## Agent Rating Guidelines

- **5/5**: Exceptional, specific transformation with a strong implication, setup-payoff, contradiction, or escalation
- **4/5**: Coherent and clearly funny, with a useful twist, direct address, threat, accusation, or vivid juxtaposition
- **3/5**: Readable and transformed, but mild, generic, or missing a strong payoff
- **2/5**: Some structure or absurdity, but bland, too close to the input, short, or weakly connected
- **1/5**: Incoherent, unchanged, generic fragments, mechanical gibberish, or no meaningful humor

## Notes Writing Style
Notes should be:
- Concise (one sentence when possible)
- Reference specific funny elements
- Explain why it's better than alternatives
- Use informal language matching user's style

Examples:
- "underground money continues creates mysterious conspiracy narrative"
- "beautiful men is funnier absurd reference than good kids"
- "Foreign language mixed with 'you're looking good' creates absurd compliment to captive person, dark humor"
- "identical to input, unacceptable but no alternatives"

## Important Reminders

1. **Never pick identical-to-input results** - automatic 1/5 rating
2. **Meaningful transformation beats raw length** - a short semantic twist can beat a long paraphrase
3. **Readable implication beats random gibberish** - threats, accusations, self-incrimination, and direct address are useful when understandable
4. **Setup-punchline structure and contradiction** - highly preferred
5. **Treat repetition conditionally** - escalation or altered meaning can work; mechanical repeated words should lose
6. **Read all heuristics** before starting - they contain detailed patterns from user feedback

## End of Process
After completion, user may want to:
- Review the log
- Adjust heuristics based on their feedback
- Run the process again for new pending tweets
