---
id: stack.react.guide
title: React engineering guide
stack_tags: [react, typescript]
---
## Components

Function components only. One component per file, named export matching the file name. Props are typed with an interface; avoid `any` and avoid spreading unknown props onto DOM elements.

## State and effects

Keep state as close to where it is used as possible. Derive values instead of storing them. Effects synchronise with external systems only; data fetching goes through a query library with caching and cancellation, not raw effects.

## Data loading and errors

Every async view has loading, empty and error states. Errors surface to an error boundary with a retry action; they are never swallowed.

## Testing

Test with React Testing Library through the DOM the user sees: roles, labels and text. Do not test implementation details such as hook call order.

## Performance

Measure before memoising. Split bundles at route boundaries. Large lists virtualise above 200 rows.
