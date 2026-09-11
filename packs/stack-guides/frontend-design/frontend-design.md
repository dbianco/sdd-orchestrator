---
id: stack.frontend-design.guide
title: Frontend design guide
stack_tags: [react, vue, svelte, frontend, css]
---
## Hierarchy

One primary action per screen. Headline, supporting text and controls follow a consistent scale; spacing comes from a fixed scale (4, 8, 16, 24, 32).

## Colour and contrast

Text contrast meets WCAG AA (4.5:1 body, 3:1 large text). Colour never carries meaning alone; pair it with an icon or label.

## Motion

Motion communicates state change and lasts under 200 ms for feedback, under 400 ms for transitions. Respect `prefers-reduced-motion`.

## Forms

Labels are visible, errors appear next to the field with a fix, and the submit button states what happens. Never clear a form on error.

## Responsiveness

Layouts are fluid between breakpoints. Wide content scrolls inside its container; the page never scrolls horizontally.
