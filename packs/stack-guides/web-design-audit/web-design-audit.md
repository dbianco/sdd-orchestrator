---
id: stack.web-design-audit.guide
title: Web design audit checklist
stack_tags: [frontend, react, vue, svelte, css]
---
## Accessibility

Every interactive element is reachable by keyboard in a sensible order, has a visible focus state and an accessible name. Images carry alt text or are marked decorative.

## Performance

Largest Contentful Paint under 2.5 s on a mid-range phone over 4G. Images are sized and lazy-loaded below the fold. No layout shift after first paint.

## Content

Headings form an outline. Link text says where it goes. Error and empty states say what to do next.

## Consistency

Components come from the design system. One-off styles are a finding unless justified in the pull request.

## Verification

Run the automated accessibility scan and the Lighthouse audit; attach both reports to the pull request.
