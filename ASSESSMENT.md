# Senior QA Engineer technical exercise

## Scenario

The enclosed event-registration application is a release candidate. The team would like your assessment of its quality and release readiness.

The application allows guests to register for a free event. Places are limited. Once the event is full, additional guests join a waiting list. A confirmed guest can cancel using a unique link in their confirmation message; the next waiting guest should then receive the available place. For this standalone exercise, messages appear in the application's test inbox rather than being sent through an email service.

## Your task

Spend approximately 60 minutes assessing the release candidate. Completeness is not expected. Please make deliberate choices, prioritise the most important risks and show us how you think.

- Explore the application as a black-box system, using the supplied requirements and API documentation.
- Implement at least one executable browser-based Playwright test and at least one executable direct API test, using TypeScript.
- Record the most important defects or risks you identify, with sufficient evidence for another team member to reproduce and understand them.
- Make an explicit recommendation: release, release with accepted risks, or do not release. Explain why.
- Record requirement questions, assumptions, deliberate omissions and what you would test next.
- You may inspect the source code to support your investigation, although the discussion will focus primarily on black-box testing.

## Optional evidence

You may include accessibility, security, performance, responsive or additional browser coverage where it supports your priorities. These are not mandatory additions, and we do not expect comprehensive coverage within the suggested time.

## Product expectations

- The registration form collects name, email, organisation, dietary requirements, accessibility needs and optional marketing consent.
- A guest receives either a confirmed place or a waiting-list position, depending on capacity.
- Cancellation should release a place and promote the next eligible waiting guest.
- The target is WCAG 2.2 AA.
- The service supports Chrome/Chromium, Edge, desktop Safari and iPhone Safari. You are not expected to test every environment, but please explain your browser and device choices.
- The public API is described in the supplied OpenAPI documentation.

## Submission

Open a pull request against the supplied repository. Include:

- Your Playwright tests and any small supporting test utilities.
- A concise `TEST-ASSESSMENT.md` containing your approach, findings, release recommendation, assumptions or questions, and next steps.
- A short AI-use note naming the tool or tools, describing what assistance you requested, and explaining how you verified or changed the output. A full prompt transcript is not required.
- Clear instructions for running your tests if these differ from `npm test`.

## Use of AI

We expect you to use AI tools where they help. You remain responsible for the submission. During the interview, we will ask how you validated generated code, assertions, test data and conclusions.

## What we value

- Sound risk-based judgement and meaningful coverage beyond the happy path.
- Readable, reliable automation that proves useful behaviour rather than merely exercising the interface.
- Clear defect communication, evidence and proportionate severity.
- Awareness of user experience, accessibility, privacy, security, performance and compatibility.
- Honest trade-offs and constructive questions where requirements are unclear.
