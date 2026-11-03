export interface PageInfo {
  title: string;
  summary: string;
  actions: string[];
  tips?: string[];
}

export const PAGE_INFO: Record<string, PageInfo> = {
  overview: {
    title: 'Overview',
    summary: 'A one-screen health check: where every feature stands, what needs a human, and whether the process is paying off.',
    actions: [
      'Read the status tiles: active, blocked and archived features.',
      'Follow the amber banner to review memory proposals that agents suggested.',
      'Check "Is the process paying off?": how often phase moves pass the gate on the first try, problems caught before review, and how long approvals wait.',
      'See where the time goes: time per phase and per track, how much of it is spec work, and how much was lost to rework.',
      'Check the right-sizing card: small changes that went through a full track and could have used the light path.',
      'See which gate checks block the most work, and what the knowledge base holds.',
    ],
    tips: ['Pick a project in the sidebar to scope every number on this page.', 'Press Ctrl/⌘+K to jump anywhere.'],
  },
  week: {
    title: 'My week',
    summary: 'What you moved through the flow recently and the problems the gates caught for you before they reached review.',
    actions: [
      'Switch between the last 7 and 30 days.',
      'Pick another person to see their activity (it defaults to you).',
      'Read "Caught before review": each blocker comes with a plain-language fix.',
      'See what you shipped, what is still in progress, and how long your approval requests waited.',
    ],
    tips: ['A blocker caught here is feedback you would otherwise have received in code review.'],
  },
  apps: {
    title: 'Apps & Features',
    summary: 'Browse each app\'s features and the requirement traceability matrix.',
    actions: [
      'Choose an app on the left (or use the Project picker in the sidebar).',
      'Search features, filter by status, and click a column header to sort.',
      'Open a feature to see its phase history: every gate result, who approved, and each finding with how to fix it.',
      'Use the traceability table to check which requirement is covered by which evidence, then Export CSV for audits.',
    ],
    tips: ['"Covered" means the requirement id appears in the evidence sent when leaving verify.'],
  },
  work: {
    title: 'Work',
    summary: 'Every task the orchestrator routed, and what became of it: the framework it chose, the feature it started, and the commits recorded.',
    actions: [
      'Filter by date (or use the quick ranges) and press Apply; search by task, ticket or app; sort any column.',
      'Open a row to see why a framework was chosen (rule and reasons), the files touched and every commit.',
      'Jump from a routed task to its feature.',
      'Export the list as CSV.',
    ],
    tips: ['"feature · not started" means a task was routed but no one called start_feature yet.'],
  },
  approvals: {
    title: 'Approvals',
    summary: 'Phase moves that wait for a human decision before an agent may continue.',
    actions: [
      'Open a request to read the submitted artifacts, evidence, requirement ids and any warnings.',
      'Approve (with an optional comment) or reject (a reason is required).',
      'Watch the number badge in the sidebar for new requests; set SDD_NOTIFY_WEBHOOK_URL on the server to be pinged in chat.',
    ],
    tips: ['Deciding needs a personal token with the approver scope. The shared admin token is read-only so every decision names a person.'],
  },
  proposals: {
    title: 'Proposals',
    summary: 'Memory (decisions, ADRs, incidents, constraints) that agents propose for the knowledge base.',
    actions: [
      'Filter by status; click a column header to sort.',
      'Click Review to read the proposed text.',
      'Accept it into the knowledge base or reject it with a reason (approver token needed).',
      'Export the list as CSV.',
    ],
    tips: ['Accepted proposals are indexed and show up in future context packs for that app.'],
  },
  drift: {
    title: 'Spec drift',
    summary: 'Archived specs whose files were changed again afterwards, so the accepted spec may no longer describe the code.',
    actions: [
      'Start with "likely stale": someone changed these files through work routed without a feature, so no spec was updated.',
      '"Review" means only other features touched the files; their own specs probably cover it, but check the original still fits.',
      'Open a row to see each file and the commits that changed it, then open the feature to read its spec history.',
      'Export the list as CSV for a documentation review.',
    ],
    tips: ['Lockfiles are ignored. A flagged spec is a prompt to re-read it, not proof it is wrong.'],
  },
  flow: {
    title: 'Flow',
    summary: 'How features move between phases, and where gates stop them.',
    actions: [
      'Read the matrix: rows are the phase a feature left, columns the phase it moved to.',
      'Green cells passed; the redder a cell, the larger the share of failed attempts.',
      'Hover a cell for the exact counts.',
      'Use the summary line to find the transition that fails most.',
    ],
    tips: ['A hot cell on one edge usually points to a template or gate that needs clearer guidance.'],
  },
};
