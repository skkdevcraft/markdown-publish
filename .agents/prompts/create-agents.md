---                                                                                                                   
description: Create AGENTS.md
---

Review this project thoroughly and create an `AGENTS.md` at the repository root that will serve as the onboarding and development guide for future coding agents.

**Do not modify application/source code.** Your job is to inspect and document the existing project.
Before writing `AGENTS.md`, explore the repository and determine:
1. **Project overview**
   * What this project does
   * What the major components/modules are
   * How the pieces fit together
2. **Tech stack**
   * Languages
   * Frameworks and libraries
   * Runtime(s)
   * Package managers
   * Build tools
   * Database/storage
   * Infrastructure/deployment technologies where relevant
   * Important configuration files
3. **Repository structure**
   * Explain the important top-level directories and files
   * Identify where the main application code lives
   * Identify tests, scripts, configuration, generated code, migrations, etc.
   * Don't document every file; focus on locations an agent will actually need to know
4. **Entry points and architecture**
   * Identify the application entry point(s)
   * Identify CLI/API/web/server entry points where applicable
   * Explain the high-level execution/data flow
   * Identify important boundaries between modules/services
5. **Development workflow**
   * How to install dependencies
   * How to configure the development environment
   * Required environment variables or configuration
   * How to start/run the project locally
   * How to build it
   * How to run it in development/watch mode
   * Any required supporting services
6. **Testing**
   * Identify the test framework(s)
   * How to run the full test suite
   * How to run a specific test/file/package if possible
   * Unit/integration/e2e test locations
   * Any test setup or fixtures that agents need to understand
7. **Code quality**
   * Linting
   * Formatting
   * Type checking
   * Static analysis
   * Pre-commit hooks or CI checks
   * Give the actual commands used by the project
8. **Important conventions**
   * Infer conventions from the existing code and configuration
   * Naming/file organization conventions
   * Architectural patterns
   * Error handling
   * Dependency injection/state management/API patterns, where applicable
   * Do not invent conventions that aren't supported by the repository
9. **CI/CD and validation**
   * Inspect CI workflows and determine what checks are actually required
   * Document the commands an agent should run before considering a change complete
10. **Gotchas**
    * Non-obvious setup requirements
    * Common pitfalls
    * Generated files that should not be edited manually
    * Commands that must be run from a particular directory
    * Anything else that would cause an agent unfamiliar with the project to make a wrong assumption

**Important investigation rules:**

* Read the relevant configuration files, package manifests, scripts, CI configuration, README/docs, and presentative source files before writing the document.
* Prefer commands and facts verified from the repository over assumptions.
* If something cannot be determined, explicitly say so rather than guessing.
* Do not blindly copy the README; synthesize the information from the actual codebase.
* Keep the resulting `AGENTS.md` concise enough to be useful to an agent. It should be a practical operating manual, t a comprehensive codebase description.
* Include exact commands wherever possible.

Finally, review the `AGENTS.md` you created and verify that every command and important claim is supported by the repository. Do not make any source-code changes.

For each major workflow, prioritize actionable instructions for an agent: **where to look, what command to run, what it should expect, and what to check if it fails.**