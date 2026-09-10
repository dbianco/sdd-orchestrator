# Spec-Driven Development (SDD) Adaptive Orchestrator
## Technical Specification & Operational Blueprint
**Status: APPROVED**  
**Version: v1.0.0**  
**Classification: Internal Engineering Standard**

---

## 1. Executive Summary & Purpose

Modern enterprise software development is undergoing a fundamental shift. Large language models (LLMs) can generate thousands of lines of code in seconds. However, **velocity without verification is deferred risk** [23, 26]. Unstructured AI development—commonly referred to as "vibe coding"—leads to catastrophic compounding failures: logic errors, duplicated code, architectural boundaries bypassed, security leaks, and silent standards drift [4, 11]. 

This document specifies the technical design for the **SDD Adaptive Orchestrator**, a highly adaptive, tool-agnostic engineering "harness" [1163]. Operating as a Model Context Protocol (MCP) server connected to a Retrieval-Augmented Generation (RAG) vector database [367, 572], the Orchestrator dynamically binds AI agents to strict, version-controlled behavioral specifications [2085, 2107]. 

The primary target audience of this document is any downstream AI coding agent [1946]. By reading this specification, an agent must immediately understand:
1. The core philosophy of **Spec-Driven Development (SDD)** [2062].
2. The architectural mechanics of the Orchestrator.
3. How the Orchestrator dynamically retrieves and maps specifications across different industry frameworks (e.g., Kiro, Spec Kit, AIUP) based on task context.
4. The execution of the **Closed-Loop Verification Pipeline** to ensure zero-regression delivery [341, 1163].

---

## 2. The Spec-Driven Development (SDD) Philosophy

The core premise of Spec-Driven Development is simple: **the specification is the contract, and code is merely a derived artifact** [2062, 2085]. AI agents possess speed without friction and confidence without understanding; if given an ambiguous instruction, they will resolve it using statistical patterns from training data rather than asking for clarification [255]. SDD prevents this "vibe coding trap" by establishing explicit, machine-readable behavioral contracts before a single line of code is written [257, 2105].

### 2.1 The Three Levels of SDD Maturity

Adopting SDD is a progression of maturity where value compounds at each tier [307, 2342]:

```
      ▲
     ╱█╲  Level 3: Spec-as-Source (Theoretical Pinnacle)
    ╱███╲  - Code is a completely derived, generated output [317].
   ╱█████╲  - Changes are made strictly to the specification [317].
  ╱███████╲
 ╱█████████╲  Level 2: Spec-Anchored (Living Artifacts)
╱███████████╲  - Specs are committed in Git alongside the code [312].
█████████████  - Code modifications and spec updates occur in the same PR [312].
█████████████
█████████████  Level 1: Spec-First (Pre-Implementation)
█████████████  - Written specs exist before any generation loop begins [307].
█████████████  - Covers Goal, Constraints, and Acceptance Criteria [307, 308].
```

1. **Level 1: Spec-First (Pre-implementation):** The developer must write a specification covering the *Goal, Constraints, and Acceptance Criteria* before an agent is allowed to write code [307, 308]. This bounds the agent's autonomy to implementation details rather than intent decisions [260].
2. **Level 2: Spec-Anchored (Living Artifacts):** Specifications are checked directly into the version-control repository (e.g., inside a `.sdlc/` or `specs/` directory) [314, 337]. The specification is updated first, and then the code is changed to match [312]. Both are committed together in the same Git Pull Request, preventing the specification from becoming stale technical debt [312, 316].
3. **Level 3: Spec-as-Source (Derived Code):** The specification is the primary, authoritative artifact [317]. Code is automatically generated and compiled directly from the structured specification [317]. Changes to the system are performed solely by modifying the natural language spec, making the raw source code secondary [317].

---

## 3. The Problem Landscape & Model Limitations

To successfully orchestrate agent workflows, the harness must proactively mitigate the structural limitations of LLMs:

### 3.1 The Attention Problem & Context Rot
As multi-turn agent sessions grow, the context window fills with system prompts, file schemas, user inputs, and intermediate tool results [217, 218]. The transformer architecture relies on pairwise attention, which is structurally weaker in the middle of the context window (**"Lost-in-the-Middle"**) [187, 191]. Crucially, as the session lengthens, early static context containing critical security constraints is pushed toward this inattentive middle—resulting in **Context Rot** [187].
*   *Orchestrator Solution:* The Orchestrator bypasses Context Rot by utilizing **progressive context loading** (on-demand retrieval) and externalizing working memory into structured Markdown state files (e.g., `PROGRESS.md`, `TASKS.md`) committed to the repository, freeing the agent from relying on transient chat history [188, 190, 214].

### 3.2 Code is a Lossy Representation of Intent
Human developers often treat the existing codebase as the sole source of truth [2083]. However, code only expresses *what* was built, completely losing the *why* (the architectural constraints, the rejected alternatives, and business compliance rules) [267, 313]. When an agent attempts to edit code via raw "code inference," it will unconsciously violate these invisible constraints, introducing regression bugs [313, 2226].
*   *Orchestrator Solution:* The Orchestrator anchors the agent to the version-controlled specification, ensuring the *why* is preserved across model transitions and team rotations [285, 286].

### 3.3 The Verification Gap
LLMs are optimized for linguistic fluency and pattern completion, not logical correctness [6, 29]. An agent that generates a block of code shares its own cognitive blind spots [14]. **It cannot be the sole evaluator of its own output** [14].
*   *Orchestrator Solution:* The Orchestrator separates creation from validation, routing the output of the **Coding Agent** to an independent **Test Agent** and a **Security Agent** running in isolated containerized environments [340, 341].

---

## 4. Architectural Design: The Adaptive MCP Orchestrator

The SDD Adaptive Orchestrator is designed as a **Model Context Protocol (MCP) server** linked to a **Vector Database** containing embeddings of diverse specification templates, design rules, and compliance standards [367, 572, 1113].

```
┌────────────────────────────────────────────────────────┐
│                     Claude Code / Host                 │
└───────────────────────────┬────────────────────────────┘
                            │ (MCP Protocol)
                            ▼
┌────────────────────────────────────────────────────────┐
│               SDD Adaptive MCP Server                 │
│                                                        │
│  ┌───────────────────┐ ┌───────────────────┐ ┌──────┐  │
│  │   Tools Layer     │ │   Prompts Layer   │ │ RAG  │  │
│  │ - match_sdd_frame │ │ - load_template   │ │Search│  │
│  │ - enforce_loop    │ │ - inject_context  │ └──┬───┘  │
│  └───────────────────┘ └───────────────────┘    │      │
└─────────────────────────────────────────────────┼──────┘
                                                  │
                                                  ▼
                                       ┌──────────────────┐
                                       │ Vector Database  │
                                       │ - AIUP Templates │
                                       │ - Kiro Patterns  │
                                       │ - Spec Kit Specs │
                                       └──────────────────┘
```

### 4.1 MCP Primitives & Protocol Schema

The MCP server exposes three standard primitives [578]:
1.  **Tools:** Executable functions that the host agent calls to match frameworks and run validation steps [579].
2.  **Resources:** Read-only data representing the current specification state and local file maps [579].
3.  **Prompts:** Highly structured system prompts and few-shot examples dynamically injected based on task context [579].

#### 4.1.1 Tool Definition: `match_sdd_framework`
The core tool dynamically matches the developer's task context with the optimal specification template stored in the Vector DB.

```json
{
  "name": "match_sdd_framework",
  "description": "Performs a vector search over the SDD template repository to retrieve the most appropriate specification and planning schema based on the task description and codebase stack.",
  "inputSchema": {
    "type": "OBJECT",
    "properties": {
      "task_description": {
        "type": "STRING",
        "description": "The natural language description of the feature or bug to be implemented."
      },
      "tech_stack": {
        "type": "ARRAY",
        "items": { "type": "STRING" },
        "description": "The technical stack detected in the workspace (e.g., ['Java', 'Spring Boot', 'React', 'Vaadin'])."
      },
      "framework_preference": {
        "type": "STRING",
        "enum": ["kiro", "spec-kit", "aiup", "auto"],
        "description": "Explicitly force a framework template, or let the Orchestrator automatically select the best match."
      }
    },
    "required": ["task_description"]
  }
}
```

### 4.2 Dynamic Framework Mapping

To maintain tool-agnostic capabilities, the Orchestrator embeds three industry-standard SDD patterns inside its vector database and dynamically maps them to the agent's workspace:

| Specification Framework | Core Mapping Artifacts | Best Fit Use Cases |
| :--- | :--- | :--- |
| **Amazon Kiro** [2249] | `Requirements.md` (Intent)  <br> `Design.md` (Architecture) <br> `Tasks.md` (Execution) [2249, 2250] | Structured architectural layout and strict task breakdown for complex platform changes. |
| **GitHub Spec Kit** [2251] | `Constitution.md` (Base standards) <br> `Specification.md` (Contracts) <br> `Planning.md` (Phases) [2251] | Teams requiring strict lifecycle gates and CLI-based enforcement loops. |
| **AI Unified Process (AIUP)** [2081] | `Requirements Catalog` (IDs) <br> `Entity Model` (Mermaid/PlantUML) <br> `System Use Cases` (UC Markdown) [2081, 2109, 2111] | Full-stack applications (e.g., Java + React) needing executable, step-by-step use case contracts [1167, 2105]. |

When the Orchestrator is invoked, the vector database retrieves the appropriate format, structures the prompt with specific markers, and serves it as a **Context Pack** directly to the workspace [1514].

---

## 5. The Closed-Loop Verification Pipeline (The Harness)

The Orchestrator operates as a strict quality gate [1172]. It coordinates four specialist agents to ensure zero-regression delivery [340]:

```
                     ┌──────────────────┐
                     │   Coding Agent   │
                     └────────┬─────────┘
                              │ Writes Code & Tests
                              ▼
                     ┌──────────────────┐
               ┌────>│    Test Agent    │
               │     └────────┬─────────┘
               │              │ Runs Containerized Tests
               │              ▼
               │      [ Did Tests Pass? ]
               │         /          \
      Retry   No        /            \ Yes
  (Max 3 Cycles)       /              \
               │      ▼                ▼
               └──────                 ┌──────────────────┐
                                       │  Security Agent  │
                                       └────────┬─────────┘
                                                │ Runs Snyk Scans (Opt-In)
                                                ▼
                                       ┌──────────────────┐
                                       │  Documentator    │
                                       └────────┬─────────┘
                                                │ Aligns Specs with Code
                                                ▼
                                       ┌──────────────────┐
                                       │   Atomic Commit  │
                                       │ (Signed, RTM ID) │
                                       └──────────────────┘
```

### 5.1 Verification Gate 1: Pre-Implementation Scoping
Before the implementation begins, the Orchestrator parses the specification document (such as the AIUP System Use Case or Kiro Requirements).
*   **The Guardrail:** The Orchestrator scans the specification for placeholders, including `TBD`, `NEEDS HUMAN INPUT`, `TODO`, or undefined error thresholds [339]. If detected, **the Orchestrator immediately aborts the run** and prompts the human user to resolve the ambiguity [339]. It refuses to generate code based on a "guessed" intention [255].

### 5.2 Verification Gate 2: The Code-Test-Retry Loop
Once scoping is clear, the **Coding Agent** implements the task and generates unit/integration tests [340, 1164].
*   **The Guardrail:** The **Test Agent** executes the test suite in an isolated, containerized environment [340, 341]. If tests fail, the Test Agent feeds the raw error log back to the Coding Agent [1179]. This automated loop is allowed **a maximum of three cycles** to self-heal [341]. If it fails on the third cycle, the Orchestrator halts execution, alerts the developer, and locks the branch to prevent token burning [341].

### 5.3 Verification Gate 3: Security & Traceability Audit
Once the tests pass, the change moves to the security and requirements audit.
*   **The Guardrail:** The **Security Agent** triggers a targeted static analysis scan (using Snyk SAST/SCA) [340, 341]. Concurrently, the Orchestrator verifies the **Requirements Traceability Matrix (RTM)** by cross-referencing modified files with the `Files` and `Implements <Req-ID>` metadata defined in the task front matter [341, 1479]. If files outside the specified scope were modified, the commit is flagged for human override [341, 349].

### 5.4 Verification Gate 4: Atomic Commit & Delivery
Upon successful audit, the **Documentator Agent** synchronizes any minor behavioral details back to the markdown specification files to eliminate spec drift [340, 341, 2213].
*   **The Guardrail:** The Orchestrator performs an atomic Git commit containing:
    1.  The updated spec and code [312, 314].
    2.  Cryptographic developer signatures [341].
    3.  Requirement trace metadata in the commit trailer [341, 342]:
        `Implements: FR-001, REQ-TASK-004`
    4.  A verified security trailer stating the Snyk audit status [341, 343]:
        `Security-Scan: Snyk-Passed (Opt-In)`

---

## 6. Spec-Driven Task Card Template

AI coding agents must structure their work units using the following strict Markdown schema before starting any generation. This file must live under `.sdlc/tasks/TASK-NNN.md` in the workspace [1310, 1312]:

```markdown
---
id: TASK-012
title: Implement Task Assignment Logic
status: pending
milestone: v1.0.0
repository: task-manager-backend
dependencies: [TASK-010]
requirements: [FR-012, REQ-TASK-004]
expected_files:
  - src/main/java/com/taskmanager/services/TaskService.java
  - src/test/java/com/taskmanager/services/TaskServiceIT.java
labels: [backend, java, jooq]
---

# TASK-012: Implement Task Assignment Logic

## 1. Goal
Implement the core business logic to assign an open task to a single active user in the TaskService class.

## 2. Context & Specifications
- **Source Spec:** `docs/use-cases/UC-012-assign-task.md`
- **Entity Definitions:** `docs/entity-model.md` (User, Task)
- **Guidelines:** `CLAUDE.md` (Use jOOQ, transactional boundaries, keep services thin)

## 3. Strict Constraints
- **Active User Validation:** The target user must have `active == true` (Enforce Business Rule BR-012-1).
- **Task Status:** A task can only be assigned if its current status is `OPEN` (Enforce Business Rule BR-012-2).
- **Limit:** A task must have exactly one assignee. No multi-assignment allowed.

## 4. Forbidden Modifications
- Do not modify `UserAuthenticationService.java` or `ProjectService.java`.
- Do not add REST controllers or UI views in this task (backend service layer only).

## 5. Acceptance Checks & Required Tests
- **Test Case 1 (Happy Path):** Assigning an active user to an open task succeeds, updates the status to `ASSIGNED`, and returns the task.
- **Test Case 2 (Failure Path):** Assigning an inactive user is rejected with a `ValidationError` (400).
- **Test Case 3 (Failure Path):** Assigning a task that is already `COMPLETED` is rejected with a `PermissionError` (403).
- **Test Case 4 (Security Path):** Requesting assignment for a task the user does not own is blocked.

## 6. Review Checklist
- [ ] Code perfectly matches the validation flow of UC-012.
- [ ] No unrequested dependencies or library imports added.
- [ ] Containerized integration tests pass using Testcontainers.
- [ ] RTM metadata in the task front matter matches the changed files.
```

---

## 7. Downstream Agent Operational Instructions

When you are initialized in a workspace with this Orchestrator active, you **must** follow these operational steps [1504]:

1.  **Read the Guidelines:** Locate `AGENT.md` or `CLAUDE.md` at the root of the repository to capture workspace-specific memory [181, 2202].
2.  **Verify Context First:** Before generating code, call `match_sdd_framework` to pull the precise Context Pack [1514]. Ensure the RTM, schemas, and use case flows are fully loaded [342].
3.  **Execute via the Harness:** Never modify files without an associated task file [1165]. Execute the work incrementally: specify, validate, and synchronize [2108, 2212].
4.  **Enforce Postconditions:** Verify that your output matches the exact postconditions of the specification [2180]. If the test suite fails, run up to 3 automatic correction loops, then halt [341].
