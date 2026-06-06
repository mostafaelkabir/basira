# SysGo Rules

## Core Concept
SysGo is a goal-driven task system.

## Rules
- Every task MUST be linked to a goal
- A task CANNOT be completed without proof
- Proof can be: image, link, or text

## Backend
- Use FastAPI
- Use clean modular structure
- Use PostgreSQL (but allow SQLite for dev)

## Coding Standards
- Keep code simple and readable
- Do not overengineer
- Add basic validation

## System Architecture

Entities:
- Goal
- Task
- Proof
- ExecutionLog

Rules:
- Task must belong to Goal
- Task cannot complete without Proof
- ExecutionLog must be recorded on completion

Flow:
Task → Proof → ExecutionLog → Complete