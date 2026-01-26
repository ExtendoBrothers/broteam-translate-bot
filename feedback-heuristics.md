# Manual Feedback Heuristics

This file contains heuristics for manually adding feedback to posted tweets. These rules are derived from user-provided feedback patterns and can be used to automate or guide feedback addition when manually ordered.

## General Rules

- **Rating Scale**: 1-5, where 1 is not funny at all, 5 is extremely funny.
- **Best Source Selection**: Choose the source that best captures humor through absurdity, repetition, misinterpretation, or contextual twist.
- **Notes**: Include brief explanations for why a translation is funny or not.

## Specific Heuristics

### What Makes Posts Funnier (Overall Better Results)
- Full sentences, coherent phrases, especially questions, shouts (including all caps as long as they are full words).
- Set up-punchline structure is strongly preferred.
- Ideal subjects: references to politics, references to crime, references to games, extreme opinions, imaginary conversations with others, indignance, gregariousness, irony, juxtaposed statements, self-deprecation, self-doubt, questioning reality, references to race, color, ethnicity, countries (especially Canada), anything Canadian, anything sexual (both direct and remotely), anatomy, etc.
- Anything related to current events, gamergate, social justice, Trump, leftism, rightism, autism, incels especially.

### What Makes Results Less Funny
- Single-word posts.
- Incoherent sentences.
- Results too close to the original (repeating words verbatim).
- Syntactical nonsense.
- Garbage.
- **Foreign language words/phrases** - reduce coherence and increase incomprehensibility, even if they create juxtaposition.

### Broteampill-Specific Humor Suggestions
- Exaggerated masculinity and bro culture: references to gym, protein, beer, gaming, pickup lines.
- Absurd "bro science" logic, over-the-top confidence or insecurity.
- "Chad" vs "incel" dynamics, redpilled takes.
- Humor from failure in bro pursuits, like bad dates or gym fails.

### Patterns Observed from Input Tweets
- Gaming/streaming culture humor (MDickie references, "where the girls are", streaming announcements).
- Dark/edgy humor: theft, ugliness ratings, dictator references, "molested games".
- Complete semantic breakdown: repetitive nonsense that degrades into gibberish (percentage spam, "cent" loops, binary numbers, unicode artifacts).
- Mistranslations creating unintentional philosophy or profound-sounding nonsense.
- **Foreign language fragments mixed with English** - previously valued for juxtaposition, now penalized for reducing coherence and increasing incomprehensibility.
- Technical gibberish or encoding errors that become comedic.
- Maniacal repetition of self-assurance followed by contradiction.

### Example Heuristic
- If a translation involves maniacal repetition of a phrase, rate higher (e.g., 4-5) as it builds absurdity and self-contradiction.
- Prefer translations that tell a "story" over single words or bland statements.

### Additional Refinements from User Feedback
- Repetition works best when it's a COMPLETE PHRASE being repeated, not just single words or fragments.
- "Dirty" interpretations (sexual innuendo, crude references) are highly valued.
- References to girls/women in absurd or inappropriate contexts add humor.
- Screaming/exclamation/pain can be funny but needs payoff - setup without punchline disappoints.
- Self-contradiction (e.g., repeated self-assurance followed by "what's going on?") is strong.
- Phrases that suggest "big dangerous plans" or exaggerated stakes are funnier.
- "Would have been funny because of X" indicates missed opportunities - prioritize those elements.
- **Foreign language words reduce coherence** - penalize translations that include foreign language elements as they decrease comprehensibility and overall quality.

### Patterns from Analyzed User Feedback
- **Setup-Punchline Structure**: Highly preferred. Examples: "No power today / Free Sunday", "About us - they are close - sleep" (threatening/spooky).
- **Implied Racism/Controversy**: "Subjects of Guides... Brown. Brown," - implied racism adds humor.
- **Contradictions**: "Nice crime", "celebrating illness", "98 perverts", "You're 98, you're sick!"
- **Complete Coherent Sentences Over Fragments**: Even if absurd, coherent beats fragmented gibberish.
- **Mysterious/Vague Threats**: "They are close... sleep", indignance, extreme negativity.
- **Sexual/Crude References**: "Teen anal", "big girl", "fat whore", "big man", addressing someone as "goddess and offering them a woman".
- **Absurd Questions**: "What happened to debtors?", "Disney never goes to kids?", "What a life of Dubai?"
- **Never Pick Results Identical to Input**: Extremely low rating - must transform the original.
- **Foreign Language Mixing**: Now penalized - reduces coherence and increases incomprehensibility, even if it creates juxtaposition.
- **Maniacal Phrases**: "USA! Teen Anal", cheerful violence "Woo let's kill the boy".
- **Contradicting Emotions**: Most funny, especially when extreme.
- **Imaginary Conversations/Addressing Others**: "calling china buddy", "My beautiful wife", implied conversations.

