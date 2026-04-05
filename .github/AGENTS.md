---
name: IRC Hispano Custom Agents
description: "Specialized agents for common IRC Hispano project tasks"
---

# IRC Hispano Custom Agents

This file defines specialized agents for specific project workflows. Use `/` in chat to invoke them.

## Available Agents

### /diagnose-project
**Purpose**: Quick health check of the project  
**What it does**:
- Checks if dependencies are installed
- Verifies key files exist and are readable
- Runs server startup to catch immediate errors
- Reports on project structure and configuration

**Use when**: You suspect something is broken or need a quick status check

### /feature-plan
**Purpose**: Plan a new feature or big task  
**What it does**:
- Asks you to describe the feature
- Breaks it down into sub-tasks
- Identifies affected modules (IRC, UI, files, security)
- Creates a step-by-step implementation plan

**Use when**: Before starting a feature, optimization, or refactor

### /debug-irc-issue
**Purpose**: Troubleshoot IRC connection/protocol problems  
**What it does**:
- Checks lib/irc.js for obvious issues
- Verifies KiwiIRC proxy configuration
- Reviews Socket.IO event handling
- Suggests logs/debugging steps

**Use when**: Can't connect, messages not sending, unexpected disconnects

### /test-end-to-end
**Purpose**: Validate a complete workflow works  
**What it does**:
- Starts server
- Attempts connection via Socket.IO
- Tests message send/receive
- Tests optional file upload
- Reports results

**Use when**: After implementing a feature, before deploying

### /optimize-perf
**Purpose**: Identify and fix performance issues  
**What it does**:
- Reviews hot paths in lib/irc.js and app.js
- Checks for memory leaks (timers, listeners, buffers)
- Suggests optimization strategies
- Implements highest-impact fixes

**Use when**: Noticing slowness, reconnection lag, or memory growth

## How to Use These

1. Type `/` in the chat to see the list
2. Select the agent you need
3. Follow the prompts and provide information
4. The agent will guide you through the task

## Creating Your Own Agent

If you need a custom agent for a repeated task:
1. Create `.github/agents/your-task.agent.md`
2. Define what the agent should do in its description
3. Add detailed steps/instructions in the body
4. Use it with `/your-task` in chat
