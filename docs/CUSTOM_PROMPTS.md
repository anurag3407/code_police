## Customizing AI Review Prompts

Code-Police allows you to tailor your AI code reviews to meet the unique standards and requirements of your project. By defining custom rules, you can ensure that the AI focuses on what matters most to your team.

## Why Customize Prompts?

Every codebase is different. You might want to:

- ​Enforce specific design patterns (e.g., "Always use functional components").
- Prioritize security standards beyond standard checks.
- Adopt project-specific naming conventions.

## How it works

Custom rules are injected into the analysis prompt in `src/lib/agents/code-police/analyzer.ts` as HIGH PRIORITY constraints. The AI is instructed to flag any violations of these rules as HIGH severity issues.

## Implementation

Rules are processed via the `formatCustomRulesSection` function and passed to the Gemini model during the `analyzeCode` execution.

## How to Add Custom Rules

You can configure your rules directly through your project settings. Once defined, these rules are treated as High Priority constraints during every AI code review.

## Writing Effective Rules

​To get the most relevant feedback from the AI, follow these tips:

- ​Be Specific: Instead of saying "write better code," state exactly what you expect (e.g., "Use TypeScript interfaces for all component props").
- ​Be Actionable: Ensure the rule gives the AI a clear direction on what to check for or avoid.
- Keep it Concise: Simple, direct instructions lead to more accurate AI analysis.

## What to Expect

Once you add a rule:

- ​High-Priority Analysis: The AI will scan your code specifically looking for violations of your rule.
- ​Clear Reporting: Any violation will be flagged as High Severity in your Pull Request comments, making it easy for you to identify and fix.
- ​Actionable Fixes: The AI will provide an explanation and a suggested code fix for any custom rule violation it finds.
